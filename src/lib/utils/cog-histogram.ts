/**
 * Streaming histogram + GDAL stats reader for COGs.
 *
 * This module owns the canonical `HISTOGRAM_BINS` constant (128) and a
 * tile-by-tile histogram builder. The streamer fetches tiles from the
 * coarsest overview, bins pixel values into a `Uint32Array` of length
 * `HISTOGRAM_BINS`, and emits a snapshot via `onProgress` after each
 * tile so the UI can fill in the histogram chart incrementally.
 *
 * When GDAL_METADATA `STATISTICS_MINIMUM` / `STATISTICS_MAXIMUM` are
 * present we use them as fixed bin edges (single-pass streaming). When
 * they are absent we fall back to a two-pass scan (min/max first, then
 * bin), in which case progress fires only at the end, bin edges are
 * not stable until the first pass finishes.
 *
 * Runs in workers and on the main thread. No DOM APIs (window,
 * document, DOMParser), no Svelte runes. XML parsing is a tolerant
 * regex over the GDAL_METADATA tag string, not a DOMParser pass.
 */

import type { GeoTIFF as GeoTIFFType, Overview } from '@developmentseed/geotiff';

/** Number of histogram buckets. PR #3 bumps from 64 to 128. */
export const HISTOGRAM_BINS = 128;

/** Per-band GDAL statistics block read from the GDAL_METADATA tag. */
export type GdalBandStats = {
	min: number;
	max: number;
	mean?: number;
	stddev?: number;
};

/** Map of 1-based band index to per-band stats. Empty when absent. */
export type GdalImageStats = Map<number, GdalBandStats>;

/** Snapshot of an in-progress histogram bake. */
export type HistogramSnapshot = {
	/** Bin counts of length `HISTOGRAM_BINS`. */
	bins: Uint32Array;
	/** Lower bin-edge (inclusive). */
	min: number;
	/** Upper bin-edge (exclusive for inner bins, inclusive for the last). */
	max: number;
	/** Tiles binned so far. */
	tilesProcessed: number;
	/** Total tiles the streamer plans to consume, or null if unknown. */
	tilesTotal: number | null;
};

/** Options for {@link streamHistogram}. */
export type StreamHistogramOptions = {
	geotiff: GeoTIFFType;
	/** 1-based band index. */
	bandIndex: number;
	signal: AbortSignal;
	onProgress: (snap: HistogramSnapshot) => void;
	/**
	 * 0-based overview index. When omitted, the lowest-resolution overview
	 * (i.e. the smallest available source, last entry of `geotiff.overviews`)
	 * is used. Falls back to the full-resolution image when `overviews` is
	 * empty.
	 */
	overviewIndex?: number;
	/** Hard upper bound on tiles consumed. Defaults to 32. */
	maxTiles?: number;
};

const DEFAULT_MAX_TILES = 32;

/**
 * Parse per-band stats out of the GDAL_METADATA tag. Tolerant of
 * malformed XML, uses a regex pass over `<Item ...>...</Item>` rather
 * than DOMParser so this can run inside a Web Worker.
 *
 * Prefers the library's pre-parsed `geotiff.storedStats` when present,
 * falls back to scanning the raw `cachedTags.gdalMetadata` string when
 * the library could not parse it but the tag is still present (defensive
 * path, rarely fires with current @developmentseed/geotiff but cheap).
 *
 * Returns an empty Map when no usable per-band ranges are found.
 */
export function readGdalStats(geotiff: GeoTIFFType): GdalImageStats {
	const out: GdalImageStats = new Map();

	const stored = geotiff.storedStats;
	if (stored) {
		for (const [band, stats] of stored) {
			if (stats.min === null || stats.max === null) continue;
			if (!(stats.min < stats.max)) continue;
			const entry: GdalBandStats = { min: stats.min, max: stats.max };
			if (stats.mean !== null && Number.isFinite(stats.mean)) entry.mean = stats.mean;
			if (stats.std !== null && Number.isFinite(stats.std)) entry.stddev = stats.std;
			out.set(band, entry);
		}
		if (out.size > 0) return out;
	}

	// Defensive fallback, parse the raw XML if the library handed us a
	// string but no parsed stats. Most builds will never hit this.
	const rawTags = geotiff.cachedTags as unknown as Record<string, unknown>;
	const xml: unknown = rawTags?.gdalMetadata ?? rawTags?.GdalMetadata ?? rawTags?.GDAL_METADATA;
	if (typeof xml !== 'string' || xml.length === 0) return out;
	parseGdalMetadataXml(xml, out);
	return out;
}

/**
 * Append per-band stats parsed from a GDAL_METADATA XML string. Tolerant
 * regex parser. Handles entries like:
 *   `<Item name="STATISTICS_MINIMUM" sample="0">123.4</Item>`
 * Mean and stddev are picked up from STATISTICS_MEAN / STATISTICS_STDDEV.
 */
function parseGdalMetadataXml(xml: string, out: GdalImageStats): void {
	// `sample` is 0-based in GDAL_METADATA, we expose 1-based to mirror the
	// rest of the codebase and @developmentseed/geotiff's `storedStats`.
	const itemRe = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/g;
	const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
	const partials = new Map<
		number,
		{ min?: number; max?: number; mean?: number; stddev?: number }
	>();

	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex iteration
	while ((m = itemRe.exec(xml)) !== null) {
		const attrs: Record<string, string> = {};
		let a: RegExpExecArray | null;
		attrRe.lastIndex = 0;
		// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex iteration
		while ((a = attrRe.exec(m[1] ?? '')) !== null) attrs[a[1]] = a[2];
		const sampleStr = attrs.sample;
		const nameAttr = attrs.name;
		if (sampleStr === undefined || nameAttr === undefined) continue;
		const sample = Number.parseInt(sampleStr, 10);
		if (!Number.isFinite(sample) || sample < 0) continue;
		const bandIdx = sample + 1;
		const valueStr = (m[2] ?? '').trim();
		const value = Number.parseFloat(valueStr);
		if (!Number.isFinite(value)) continue;
		let p = partials.get(bandIdx);
		if (!p) {
			p = {};
			partials.set(bandIdx, p);
		}
		switch (nameAttr) {
			case 'STATISTICS_MINIMUM':
				p.min = value;
				break;
			case 'STATISTICS_MAXIMUM':
				p.max = value;
				break;
			case 'STATISTICS_MEAN':
				p.mean = value;
				break;
			case 'STATISTICS_STDDEV':
				p.stddev = value;
				break;
			default:
				break;
		}
	}

	for (const [band, p] of partials) {
		if (p.min === undefined || p.max === undefined) continue;
		if (!(p.min < p.max)) continue;
		const entry: GdalBandStats = { min: p.min, max: p.max };
		if (p.mean !== undefined) entry.mean = p.mean;
		if (p.stddev !== undefined) entry.stddev = p.stddev;
		out.set(band, entry);
	}
}

// Loose shape used by `iterBand` so we accept either layout of `RasterArray`
// without leaning on the heavy `RasterArray` union import at the call site.
type RasterArrayLike = {
	count: number;
	layout: 'band-separate' | 'pixel-interleaved';
	bands?: ArrayLike<number>[];
	data?: ArrayLike<number>;
};

/**
 * Iterate band `b` (0-based) of a `RasterArray`, layout-agnostic. Yields
 * raw sample values in row-major order without copying.
 */
function* iterBand(arr: RasterArrayLike, b: number): Generator<number> {
	if (arr.layout === 'band-separate') {
		const data = arr.bands?.[b];
		if (!data) return;
		const len = data.length;
		for (let i = 0; i < len; i++) yield data[i] as number;
	} else {
		const data = arr.data;
		if (!data) return;
		const stride: number = arr.count ?? 1;
		const len = data.length;
		for (let i = b; i < len; i += stride) yield data[i] as number;
	}
}

/**
 * Pick which tiles of the chosen overview to read. Below the cap we read
 * every tile (exact min/max plus every-pixel histogram), above the cap we
 * fall back to a 3x3 spatial sample (corners + edge midpoints + center,
 * deduplicated) so a COG without a deep overview pyramid does not trigger
 * a multi-GB scan.
 */
function pickSampleCoords(
	tileCount: { x: number; y: number },
	cap: number
): Array<[number, number]> {
	if (tileCount.x <= 0 || tileCount.y <= 0) return [];
	if (tileCount.x * tileCount.y <= cap) {
		const out: Array<[number, number]> = [];
		for (let y = 0; y < tileCount.y; y++) {
			for (let x = 0; x < tileCount.x; x++) out.push([x, y]);
		}
		return out;
	}
	const xs = Array.from(new Set([0, Math.floor(tileCount.x / 2), tileCount.x - 1])).filter(
		(n) => n >= 0 && n < tileCount.x
	);
	const ys = Array.from(new Set([0, Math.floor(tileCount.y / 2), tileCount.y - 1])).filter(
		(n) => n >= 0 && n < tileCount.y
	);
	const out: Array<[number, number]> = [];
	for (const y of ys) {
		for (const x of xs) out.push([x, y]);
	}
	return out;
}

/** Resolve the source IFD for histogram sampling. */
function resolveSource(
	geotiff: GeoTIFFType,
	overviewIndex: number | undefined
): GeoTIFFType | Overview {
	const ovs = geotiff.overviews ?? [];
	if (typeof overviewIndex === 'number') {
		if (overviewIndex >= 0 && overviewIndex < ovs.length) return ovs[overviewIndex];
	}
	// Default, lowest-resolution overview (smallest source).
	if (ovs.length > 0) return ovs[ovs.length - 1];
	return geotiff;
}

/**
 * Stream a 128-bin histogram for a single band. Fires `onProgress` after
 * each tile so the UI can fill in the chart incrementally, the snapshots
 * share no buffer references between calls (each `bins` is a fresh
 * `Uint32Array`).
 *
 * Algorithm:
 *  - With GDAL priors, one pass, known bin edges, progressive snapshots.
 *  - Without priors, two passes, pass 1 finds min/max across all
 *    selected tiles, pass 2 bins into 128 buckets. Snapshots fire
 *    per-cached-tile in pass 2 so the UI still sees the histogram fill
 *    in on the no-priors path, bin edges aren't stable during pass 1.
 *
 * Honors `signal.aborted` between every tile fetch and after each bin
 * pass. Throws no error on abort, returns silently with whatever
 * partial snapshot the caller already received.
 */
export async function streamHistogram(opts: StreamHistogramOptions): Promise<void> {
	const { geotiff, bandIndex, signal, onProgress } = opts;
	const maxTiles = opts.maxTiles ?? DEFAULT_MAX_TILES;
	if (bandIndex < 1) return;

	const source = resolveSource(geotiff, opts.overviewIndex);
	const tileCount = source.tileCount;
	const coords = pickSampleCoords(tileCount, maxTiles);
	if (coords.length === 0) return;

	const nodata = geotiff.nodata;
	const priors = readGdalStats(geotiff);
	const prior = priors.get(bandIndex);

	if (prior) {
		await streamWithPriors({
			source,
			coords,
			bandIdx0: bandIndex - 1,
			min: prior.min,
			max: prior.max,
			nodata,
			signal,
			onProgress
		});
		return;
	}

	await streamTwoPass({
		source,
		coords,
		bandIdx0: bandIndex - 1,
		nodata,
		signal,
		onProgress
	});
}

type StreamCtx = {
	source: GeoTIFFType | Overview;
	coords: Array<[number, number]>;
	bandIdx0: number;
	nodata: number | null;
	signal: AbortSignal;
	onProgress: (snap: HistogramSnapshot) => void;
};

async function streamWithPriors(ctx: StreamCtx & { min: number; max: number }): Promise<void> {
	const { source, coords, bandIdx0, min, max, nodata, signal, onProgress } = ctx;
	const range = max - min;
	if (!(range > 0)) return;
	const scale = HISTOGRAM_BINS / range;

	const bins = new Uint32Array(HISTOGRAM_BINS);
	const total = coords.length;
	for (let i = 0; i < total; i++) {
		if (signal.aborted) return;
		const [x, y] = coords[i];
		let tile: { array: unknown };
		try {
			tile = await source.fetchTile(x, y, { signal });
		} catch {
			// Honor abort, but also tolerate edge-tile fetch failures.
			if (signal.aborted) return;
			continue;
		}
		if (signal.aborted) return;
		const arr = tile.array as unknown as RasterArrayLike;
		if (bandIdx0 < 0 || bandIdx0 >= arr.count) return;
		for (const v of iterBand(arr, bandIdx0)) {
			if (nodata !== null && v === nodata) continue;
			if (!Number.isFinite(v)) continue;
			let idx = Math.floor((v - min) * scale);
			if (idx < 0) idx = 0;
			else if (idx >= HISTOGRAM_BINS) idx = HISTOGRAM_BINS - 1;
			bins[idx]++;
		}
		// Fresh snapshot each emit so subscribers can hold refs without
		// risk of mutation.
		onProgress({
			bins: new Uint32Array(bins),
			min,
			max,
			tilesProcessed: i + 1,
			tilesTotal: total
		});
	}
}

async function streamTwoPass(ctx: StreamCtx): Promise<void> {
	const { source, coords, bandIdx0, nodata, signal, onProgress } = ctx;

	// Pass 1, min/max. Cache the decoded tiles so pass 2 doesn't refetch.
	const decoded: RasterArrayLike[] = [];
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	let any = false;
	for (let i = 0; i < coords.length; i++) {
		if (signal.aborted) return;
		const [x, y] = coords[i];
		try {
			const tile = await source.fetchTile(x, y, { signal });
			const arr = tile.array as unknown as RasterArrayLike;
			if (bandIdx0 < 0 || bandIdx0 >= arr.count) return;
			decoded.push(arr);
			for (const v of iterBand(arr, bandIdx0)) {
				if (nodata !== null && v === nodata) continue;
				if (!Number.isFinite(v)) continue;
				if (v < min) min = v;
				if (v > max) max = v;
				any = true;
			}
		} catch {
			if (signal.aborted) return;
		}
	}
	if (signal.aborted) return;
	if (!any || !(min < max)) return;

	// Pass 2, bin. Emits an incremental snapshot per cached tile so the
	// UI sees the histogram fill in even on the no-priors path.
	const range = max - min;
	const scale = HISTOGRAM_BINS / range;
	const bins = new Uint32Array(HISTOGRAM_BINS);
	const total = decoded.length;
	for (let i = 0; i < total; i++) {
		if (signal.aborted) return;
		const arr = decoded[i];
		for (const v of iterBand(arr, bandIdx0)) {
			if (nodata !== null && v === nodata) continue;
			if (!Number.isFinite(v)) continue;
			let idx = Math.floor((v - min) * scale);
			if (idx < 0) idx = 0;
			else if (idx >= HISTOGRAM_BINS) idx = HISTOGRAM_BINS - 1;
			bins[idx]++;
		}
		onProgress({
			bins: new Uint32Array(bins),
			min,
			max,
			tilesProcessed: i + 1,
			tilesTotal: total
		});
	}
}
