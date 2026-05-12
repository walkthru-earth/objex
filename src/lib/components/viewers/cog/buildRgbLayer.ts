/**
 * Layer-construction dispatch for the unified RGB picker.
 *
 * Decision rule:
 *   - All three RGB channels point to the SAME asset → COGLayer. When a
 *     `preflightGeotiff` is supplied, the per-channel `bandIndex` values are
 *     translated into a `BandConfig` and run through `selectCogPipeline`,
 *     which returns a custom `getTileData` / `renderTile` pair that swaps
 *     bands as requested (the library's COGLayer does not accept a
 *     `bandConfig` prop, only the resolved pipeline). Without a preflight
 *     GeoTIFF the layer falls back to the library default pipeline, which
 *     reads bands 0/1/2 in that order, correct for single-band per-asset
 *     COGs and for the default natural-color order on pre-baked multi-band
 *     visuals.
 *   - Channels point to DIFFERENT assets → MultiCOGLayer with the legacy
 *     `composite: { r, g, b }` keyed on asset keys. MultiCOGLayer reads band 0
 *     of each source, per-channel band index is silently ignored on this path
 *     (library limitation, see spec Known Limitations).
 *
 * `buildRgbLayer` ONLY constructs the layer. It does not add overlays,
 * register cleanup, or touch deck.gl state. Caller owns lifecycle.
 */

import { COGLayer, MultiCOGLayer } from '@developmentseed/deck.gl-geotiff';
import type { DecoderPool, GeoTIFF as GeoTIFFType } from '@developmentseed/geotiff';
import type { EpsgResolver } from '@developmentseed/proj';
import {
	type BandConfig,
	buildBandRenderPipeline,
	type GeoBounds,
	type RescaleConfig,
	selectCogPipeline
} from '../../../utils/cog.js';
import {
	allChannelsBand0,
	type ChannelComposite,
	type CogAsset,
	isSingleAssetComposite
} from '../../../utils/cog-asset.js';

export type RgbLayerKind = 'cog' | 'multicog';

export interface BuildRgbLayerOptions {
	id: string;
	assets: CogAsset[];
	composite: ChannelComposite;
	rescale: RescaleConfig;
	/** href → presigned-or-passthrough URL. */
	resolveHref: (href: string) => Promise<string>;
	pool?: DecoderPool | null;
	epsgResolver: EpsgResolver;
	signal: AbortSignal;
	onLoad?: (info: { kind: RgbLayerKind; bounds?: GeoBounds }) => void;
	/**
	 * Pre-opened GeoTIFF for the single-asset path. When provided, the per-channel
	 * `bandIndex` values from the composite are honored via `selectCogPipeline`,
	 * which inspects the COG's sample format / band count and returns a custom
	 * `getTileData` + `renderTile` pair that swaps bands as requested.
	 *
	 * When omitted, the layer falls back to the library default render pipeline,
	 * which always reads bands 0/1/2 in that order. That is fine for:
	 *   - single-band per-asset COGs (Sentinel-2, Landsat per-band) where every
	 *     `bandIndex` is 0 anyway, OR
	 *   - pre-baked multi-band visuals (NAIP `image`, S2 `visual`) where the
	 *     natural-color preset wants the default band order.
	 */
	preflightGeotiff?: GeoTIFFType | null;
	/**
	 * Resolved nodata value threaded into `buildBandRenderPipeline` for the
	 * multi-asset `MultiCOGLayer` path. `null` (default) disables the nodata
	 * filter so legacy callers preserve their previous behaviour.
	 */
	noDataVal?: number | null;
}

export interface BuiltRgbLayer {
	kind: RgbLayerKind;
	layer: COGLayer | MultiCOGLayer;
}

/**
 * Build the appropriate deck.gl layer for an RGB composite.
 *
 * For single-asset composites the band indices flow through `selectCogPipeline`
 * (when `preflightGeotiff` is provided) into a custom `getTileData` /
 * `renderTile` pair that honors the requested R/G/B band order. Without a
 * preflight GeoTIFF the layer uses the library's default pipeline (bands 0/1/2).
 * For multi-asset composites a warning is logged (once per call) when any
 * non-band-0 index is requested, since MultiCOGLayer cannot honor it today.
 */
export async function buildRgbLayer(opts: BuildRgbLayerOptions): Promise<BuiltRgbLayer> {
	const assetByKey = new Map(opts.assets.map((a) => [a.key, a]));
	const c = opts.composite;

	console.debug('[buildRgbLayer]', {
		id: opts.id,
		composite: c,
		single: isSingleAssetComposite(c),
		assetKeys: opts.assets.map((a) => a.key),
		hasPreflightGeotiff: !!opts.preflightGeotiff
	});

	if (isSingleAssetComposite(c)) {
		const asset = assetByKey.get(c.r.assetKey);
		if (!asset) throw new Error(`unknown asset key: ${c.r.assetKey}`);
		const url = await opts.resolveHref(asset.href);
		if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
		const onGeoTIFFLoad = (_g: unknown, info: { geographicBounds: GeoBounds }) => {
			opts.onLoad?.({
				kind: 'cog',
				bounds: info.geographicBounds
			});
		};
		// Branch on whether we have a pre-opened GeoTIFF.
		//   - Present: build a per-channel BandConfig from the composite, hand
		//     it to selectCogPipeline (which inspects sampleFormat / bandCount)
		//     and spread the resolved {getTileData?, renderTile?} into COGLayer.
		//     This is the only path that honors a non-default per-channel
		//     bandIndex on a single-asset multi-band COG (e.g. NAIP NIR-R-G).
		//   - Absent: fall back to the library's default render pipeline. Bands
		//     0/1/2 are read in that order, which is correct for single-band
		//     per-asset COGs (every bandIndex is 0 anyway) and for the default
		//     natural-color order on pre-baked multi-band visuals.
		if (opts.preflightGeotiff) {
			const bandConfig: BandConfig = {
				mode: 'rgb',
				rBand: c.r.bandIndex,
				gBand: c.g.bandIndex,
				bBand: c.b.bandIndex,
				band: 0,
				colorRamp: 'viridis'
			};
			console.debug('[buildRgbLayer] cog single-asset with preflight', {
				id: opts.id,
				bandConfig,
				url
			});
			const pipeline = selectCogPipeline(opts.preflightGeotiff, {
				bandConfig,
				rescale: opts.rescale
			});
			const layer = new COGLayer({
				id: opts.id,
				geotiff: url,
				...pipeline,
				pool: opts.pool ?? undefined,
				epsgResolver: opts.epsgResolver,
				signal: opts.signal,
				onGeoTIFFLoad
			});
			return { kind: 'cog', layer };
		}
		console.debug('[buildRgbLayer] cog single-asset (library default pipeline)', {
			id: opts.id,
			url
		});
		// Fallback: no preflight GeoTIFF supplied. COGLayer's typed prop surface
		// does not include `renderPipeline` (only `getTileData` + `renderTile`),
		// so we cannot apply the band render pipeline statically here. Without
		// a preflight to feed `selectCogPipeline`, we have no way to inspect
		// sample format / band count up front, so we let the library infer its
		// own pipeline from the GeoTIFF metadata at load time. Bands 0/1/2 are
		// read in that order, which is correct for single-band per-asset COGs
		// (every bandIndex is 0 anyway) and for the default natural-color order
		// on pre-baked multi-band visuals (NAIP `image`, S2 `visual`).
		const layer = new COGLayer({
			id: opts.id,
			geotiff: url,
			pool: opts.pool ?? undefined,
			epsgResolver: opts.epsgResolver,
			signal: opts.signal,
			onGeoTIFFLoad
		});
		return { kind: 'cog', layer };
	}

	if (!allChannelsBand0(c)) {
		// Library limitation: MultiCOGLayer always reads band 0. Surface a
		// console warning once per call so the consumer sees that the user's
		// per-channel band index was dropped.
		console.warn(
			'[buildRgbLayer] multi-asset composite with non-band-0 indices, band index ignored on multi-asset path'
		);
	}

	const sources: Record<string, { url: string }> = {};
	for (const ref of [c.r, c.g, c.b, c.a].filter((x): x is NonNullable<typeof c.a> => Boolean(x))) {
		if (sources[ref.assetKey]) continue;
		const asset = assetByKey.get(ref.assetKey);
		if (!asset) {
			console.warn('[buildRgbLayer] missing asset for ref', ref);
			continue;
		}
		const url = await opts.resolveHref(asset.href);
		if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
		sources[ref.assetKey] = { url };
	}

	const compositeSpec: { r: string; g: string; b: string; a?: string } = {
		r: c.r.assetKey,
		g: c.g.assetKey,
		b: c.b.assetKey
	};
	if (c.a && sources[c.a.assetKey]) compositeSpec.a = c.a.assetKey;

	console.debug('[buildRgbLayer] multicog sources resolved', {
		sourceKeys: Object.keys(sources),
		composite: compositeSpec,
		urls: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.url]))
	});

	const layer = new MultiCOGLayer({
		id: opts.id,
		sources,
		composite: compositeSpec,
		renderPipeline: buildBandRenderPipeline({
			noDataVal: opts.noDataVal ?? null,
			rescale: { ...opts.rescale }
		}),
		pool: opts.pool ?? undefined,
		epsgResolver: opts.epsgResolver,
		signal: opts.signal,
		onGeoTIFFLoad: (_tiffs, info) => {
			console.debug('[buildRgbLayer] MultiCOG onGeoTIFFLoad', {
				id: opts.id,
				bounds: info.geographicBounds
			});
			opts.onLoad?.({
				kind: 'multicog',
				bounds: info.geographicBounds
			});
		}
	});
	return { kind: 'multicog', layer };
}
