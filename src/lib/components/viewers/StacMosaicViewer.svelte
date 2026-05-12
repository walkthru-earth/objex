<script lang="ts">
import { GeoJsonLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { COGLayer, MosaicLayer, MultiCOGLayer } from '@developmentseed/deck.gl-geotiff';
import { DecoderPool, GeoTIFF } from '@developmentseed/geotiff';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '../../i18n/index.svelte.js';
import { createStacSourceForTab } from '../../query/stac-source-factory.js';
import { getAdapter } from '../../storage/index.js';
import { buildProviderBaseUrl, type ProviderId } from '../../storage/providers.js';
import { connectionStore } from '../../stores/connections.svelte.js';
import { settings } from '../../stores/settings.svelte.js';
import { tabResources } from '../../stores/tab-resources.svelte.js';
import type { Tab } from '../../types.js';
import {
	applyPreset,
	availablePresets,
	compositeFromUrl,
	compositeToUrl,
	PRESETS,
	presetMatchesComposite
} from '../../utils/channel-composite.js';
import { resolveCloudUrl } from '../../utils/cloud-url.js';
import {
	type BandConfig,
	buildBandRenderPipeline,
	buildDataTypeLabel,
	buildHistogramFromGeotiff,
	type CustomTileData,
	clampBounds,
	cleanupNativeBitmap,
	createEpsgResolver,
	DEFAULT_NODATA_CONFIG,
	DEFAULT_RESCALE,
	defaultBandConfig,
	fitCogBounds,
	HISTOGRAM_BIN_COUNT,
	loadGeoTIFF,
	mapResolutionMetersPerPixel,
	type NodataConfig,
	normalizeCogGeotiff,
	type PixelValue,
	percentileFromHistogram,
	type RescaleConfig,
	readGdalNodata,
	readPixelAtLngLat,
	resolveNodata,
	resolveProj4Def,
	selectCogPipeline,
	selectOverviewForResolution
} from '../../utils/cog.js';
import {
	type ChannelComposite,
	type CogAsset,
	extractCogAssets,
	isSingleAssetComposite,
	pickNaturalColorComposite
} from '../../utils/cog-asset.js';
import { isAbortError } from '../../utils/error.js';
import { formatFileSize } from '../../utils/format.js';
import { LruCache } from '../../utils/lru.js';
import { attachPixelInspector } from '../../utils/map-pixel-inspect.js';
import {
	buildMosaicSourceMeta,
	classifyStac,
	extractMosaicAssets,
	type MosaicSourceMeta,
	pickCogAssetHref,
	type RasterBandAsset,
	type StacRoutableKind,
	spatialCellKey
} from '../../utils/stac.js';
import {
	applyFacets,
	buildFacets,
	emptyFacetState,
	extractItemView,
	type FacetState,
	hasActiveFilters,
	type StacItemView
} from '../../utils/stac-facets.js';
import type { StacSource } from '../../utils/stac-source.js';
import { smokeTestHref } from '../../utils/storage-smoketest.js';
import { buildHttpsUrlAsync } from '../../utils/url.js';
import { getUrlViewParams, updateUrlViewParams } from '../../utils/url-state.js';
import CogControls from './CogControls.svelte';
import PixelInspectorPanel, { type PixelInspectorRow } from './cog/PixelInspectorPanel.svelte';
import MapContainer from './map/MapContainer.svelte';
import StacDatetimeBar from './stac/StacDatetimeBar.svelte';
import StacFilterPanel from './stac/StacFilterPanel.svelte';
import StacItemInspector from './stac/StacItemInspector.svelte';
import StacItemStrip from './stac/StacItemStrip.svelte';

let { tab, classified }: { tab: Tab; classified?: StacRoutableKind } = $props();

// ─── UI / status state ─────────────────────────────────────────────
let loading = $state(true);
let error = $state<string | null>(null);
let showControls = $state(false);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();

// ─── Render-pipeline state ─────────────────────────────────────────
let bandConfig = $state<BandConfig | null>(null);
let histogram = $state.raw<Uint32Array | null>(null);
let rescale = $state<RescaleConfig>({ ...DEFAULT_RESCALE });
let detectedBandCount = $state<number>(3);
let detectedDataType = $state<string>('');
let probedBandCount = false;
// On the multi-asset path (per-item MultiCOGLayer mosaic) the per-tile baker
// in `cog.ts` is bypassed, so `recordSourceHistogram` never receives bins and
// `aggregateSources()` keeps `histogram = null`. Fall back to a one-shot bake
// from the smallest overview of the first committed item's R-channel COG.
// Tracks `${rAssetKey}:${firstViewId}` so a preset / R-channel swap or a fresh
// viewport rebakes; `userTouchedRescale` gates the auto-contrast reseed.
let multiHistogramKey: string | null = null;
let userTouchedRescale = false;
// User-facing nodata override (Auto/Value/Off). `autoNodata` is the GDAL_NODATA
// value read from the first probed source's geotiff; Auto mode resolves to it
// via `resolveNodata()` at layer-build time.
let nodataConfig = $state<NodataConfig>({ ...DEFAULT_NODATA_CONFIG });
let autoNodata = $state<number | null>(null);
// ─── Asset picker (mosaic uses ONE COG per item) ──────────────────
// `availableAssets` is seeded from the first item that arrives so the user
// can pick which STAC asset (`visual` / `red` / `nir` / ...) drives the
// mosaic. `mosaicAssetKey` may be null until the first batch lands; while
// null, `buildMosaicSourceMeta(item, undefined)` falls back to the default
// `pickCogAssetHref` order (`visual` → `image` → `data` → `rendered_preview`
// → first tiff). Changing the key swaps every committed source's `href` in
// place via re-deriving from the cached `StacItemView.raw`, no viewport
// re-query needed.
let availableAssets = $state.raw<RasterBandAsset[]>([]);
let mosaicAssetKey = $state<string | null>(null);

// Unified RGB picker state (parallel to availableAssets / mosaicAssetKey for
// the single-asset path). `composite.r.assetKey` is mirrored into the
// `mosaicAssetKey` machinery so the existing buildMosaicSourceMeta path keeps
// working until the multi-asset path lands.
let cogAssets = $state.raw<CogAsset[]>([]);
let composite = $state.raw<ChannelComposite | null>(null);
let activePresetId = $state<string>('');

const presetsForMosaic = $derived(availablePresets(cogAssets));

// ─── Pixel inspection ──────────────────────────────────────────────
let pixelValue = $state<PixelValue | null>(null);
let pixelSourceId = $state<string | null>(null);
let inspecting = $state(false);
let detachInspector: (() => void) | null = null;

// ─── Caches ────────────────────────────────────────────────────────
// Bounded so panning does not grow memory forever. Sized larger than the
// inner TileLayer's tile cache so a pan-back to a previously-visited bbox
// finds COG headers + presigned URLs ready instead of paying a header
// re-fetch. Each entry is small (~16 KB IFD per geotiff, a string per
// presign), so 256 entries fits in well under 50 MB. Tile pixel bytes are
// still bounded by `MosaicLayer.maxCacheSize` (kept smaller because decoded
// tiles are 1-4 MB each). Histograms are evicted in `onTileUnload` because
// they reflect visible state, not data; the geotiff / presign / resolved
// caches are NOT evicted on tile-unload anymore so pan-back is fast.
const SOURCE_CACHE_MAX = 256;
const TILE_CACHE_MAX = 64;
let geotiffCache = new LruCache<string, Promise<GeoTIFF>>({ max: SOURCE_CACHE_MAX });
let presignCache = new LruCache<string, Promise<string>>({ max: SOURCE_CACHE_MAX });
// Parallel cache of resolved presigned URLs, keyed by the original href. The
// multi-asset mosaic path needs a synchronous href→url lookup so the per-item
// MultiCOGLayer derivation can attach all 3 channel URLs in one render tick;
// `presignCache` only stores the in-flight `Promise<string>`. Populated in
// `presignHref` once the promise resolves. Bounded LRU (cap matches
// `presignCache`) so non-COG hrefs from `StacItemStrip` thumbnails and
// `StacItemInspector` asset table cannot grow without bound (those entries
// are not iterated by the `commitSources()` itemsRemoved diff, which only
// walks `extractCogAssets`). `commitSources()` still evicts COG asset
// entries promptly on item drop / asset swap / viewer reset / teardown so
// memory tracks the rendered set rather than waiting for LRU pressure.
let resolvedHrefByOriginal = new LruCache<string, string>({ max: SOURCE_CACHE_MAX });
let sourceHrefById = new Map<string, string>();
// Surface only the first distinct getSource decode failure per viewer
// lifetime (e.g. CORS, unsupported COG flavour, presign rejection). Reset on
// tab reset alongside the rest of the per-source state.
let sourceErrorLogged = false;
// Per-source visible-tile histograms, summed across sources in `aggregate`.
let sourceHistograms = new Map<string, Uint32Array>();
// Dedup `onTileError` log floods. deck.gl's TileLayer retries a failed source
// for every visible tile that overlaps it; on `ERR_INSUFFICIENT_RESOURCES`
// (Chrome renderer URL-request budget exhaustion) the same href fires once
// per tile per pan. Logging once per source per session is enough to surface
// the failure without flooding the console.
const loggedTileErrors = new Set<string>();
function logTileErrorOnce(sourceId: string, err: unknown) {
	if (loggedTileErrors.has(sourceId)) return;
	loggedTileErrors.add(sourceId);
	console.error(`[StacMosaic] tile error on source "${sourceId}":`, err);
}

// ─── Lifecycle controllers ─────────────────────────────────────────
// `abortController` is viewer-lifetime (only torn down on tab close / reset)
// so in-flight COG range fetches keep painting cached tiles across panning.
// `hydrationController` is per-pan: aborts only the STAC link-walk / API
// pagination so a viewport reload does not cascade into the COG layer.
let abortController = new AbortController();
let hydrationController = new AbortController();
let mapRef: maplibregl.Map | null = null;
let overlayRef: MapboxOverlay | null = null;
let loadGen = 0;
// Tracks the currently-running loadMosaic. reloadViewport awaits this after
// aborting so a rapid pan can't stack 5+ DuckDB queryStream calls in the worker
// (DuckDB-WASM cancelSent is best-effort at polling boundaries — meanwhile
// each in-flight scan keeps its STRUCT result buffers alive on the WASM heap,
// which OOMs at ~3.1 GiB on stac-geoparquet rows with deep `assets`/`links`).
let inflightLoad: Promise<void> | null = null;

// ─── Ingestion buffer ──────────────────────────────────────────────
// Mutated freely as STAC batches arrive. NOT consumed by the renderer.
// `commitSources()` is the single transition point that promotes this
// buffer to the `committed*` render state.
let itemsRef = $state.raw<MosaicSourceMeta[]>([]);
let itemViewsRef = $state.raw<StacItemView[]>([]);

// ─── Render state (single source of truth) ─────────────────────────
// Everything deck.gl ever sees flows through these three signals plus the
// pure $derived chain below. There is no imperative `pushLayers` /
// `currentMosaicLayer` path. That removes the lifecycle race that used to
// re-present finalized COGLayer instances to the layer tree (the
// `assert9(!this.internalState)` deck.gl assertion at Layer._initialize).
let committedSources = $state.raw<MosaicSourceMeta[]>([]);
let committedViews = $state.raw<StacItemView[]>([]);
// Bumped on inputs that must invalidate the inner TileLayer's tile cache
// (band/rescale/pipeline change). Sources changes already invalidate via
// the content hash baked into `mosaicId`.
let pipelineGen = $state(0);

// ─── Discovery / streaming ─────────────────────────────────────────
type SourceKind = 'api' | 'parquet' | 'static';
let kind = $state<SourceKind>('static');
const isViewportMode = $derived(kind !== 'static');
let moveHandlerRef: (() => void) | null = null;
let moveDebounceTimer: number | null = null;
const VIEWPORT_DEBOUNCE_MS = 350;
const VIEWPORT_PAGE_LIMIT = 250;
let itemLimit = $state<number>(settings.mosaicItemLimit);
const LATEST_KEEP_PER_CELL = 3;
const dedupeLatest = true;
let hasFittedOnce = false;

// ─── Item interaction ──────────────────────────────────────────────
let hoveredId = $state<string | null>(null);
let selectedId = $state<string | null>(null);
let showFootprints = $state(false);
let showStrip = $state(true);
let filterState = $state<FacetState>(emptyFacetState());
// Datetime histogram + slider bounds are derived from `committedViews`, which
// is already bbox-scoped to the current viewport in `api` and `parquet` modes
// because those sources push `bbox` down (STAC API `?bbox=` and DuckDB
// `ST_Intersects(geometry, ST_MakeEnvelope(...))` respectively). When the user
// pans, `reloadViewport()` re-queries and the histogram rebuilds from the new
// bbox's items, so the date controls always reflect "what's available here".
//
// `static` mode walks the full advertised tree without bbox push-down, so the
// histogram covers the whole catalog — including items outside the current
// view. We deliberately do NOT bbox-clip `committedViews` client-side before
// faceting in static mode for this initial release: static catalogs are the
// minority path, and a client-side clip would diverge the histogram from the
// rendered footprint set (which is also un-clipped in static mode). Revisit
// if static-mode usage grows.
const facets = $derived(buildFacets(committedViews as StacItemView[]));
const filteredViews = $derived(applyFacets(committedViews as StacItemView[], filterState));

// Zoom-aware source culling. `MosaicTileset2D.getTileIndices` searches the
// full map viewport bbox and returns every overlapping source as a deck.gl
// "tile", which fires our `getSource` and opens the COG header (range
// requests for IFDs). At low zoom over a global mosaic that wastes hundreds
// of header fetches on COGs that span fewer than a few screen pixels and
// won't contribute meaningful pixels at that zoom anyway. Cull sources whose
// projected on-screen footprint is below `ZOOM_CULL_MIN_PIXELS`. The cull is
// binned by integer zoom so within a zoom level the source list (and the
// inner Flatbush + TileLayer cache) stays stable across pans, and only zoom
// transitions force a MosaicLayer rebuild.
const ZOOM_CULL_MIN_PIXELS = 4;
let mapZoomBin = $state<number | null>(null);
function sourcePixelSize(bbox: [number, number, number, number], zoom: number): number {
	const [w, s, e, n] = bbox;
	const lat = (n + s) / 2;
	const cosLat = Math.cos((lat * Math.PI) / 180);
	if (!Number.isFinite(cosLat) || cosLat <= 0) return Number.POSITIVE_INFINITY;
	const widthMeters = (e - w) * 111320 * cosLat;
	const heightMeters = (n - s) * 111320;
	const mpp = (156543.03392 * cosLat) / 2 ** zoom;
	if (!Number.isFinite(mpp) || mpp <= 0) return Number.POSITIVE_INFINITY;
	return Math.min(widthMeters / mpp, heightMeters / mpp);
}
const culledSources = $derived.by(() => {
	const z = mapZoomBin;
	if (z == null || committedSources.length === 0) return committedSources;
	const out: MosaicSourceMeta[] = [];
	for (const s of committedSources) {
		if (sourcePixelSize(s.bbox, z) >= ZOOM_CULL_MIN_PIXELS) out.push(s);
	}
	// If the cull would empty the mosaic (every source is sub-pixel), keep the
	// raw set so the user sees something rather than nothing — they're zoomed
	// way out and a single fetch is acceptable.
	return out.length > 0 ? out : committedSources;
});
const filteredItems = $derived.by(() => {
	if (!hasActiveFilters(filterState)) return culledSources;
	const allowed = new Set(filteredViews.map((v) => v.id));
	return culledSources.filter((it) => allowed.has(it.id));
});
const filtersActive = $derived(hasActiveFilters(filterState));
const sourceCount = $derived(committedSources.length);

// ─── Explain / cost-preview stats (Info panel) ─────────────────────
// Inspired by lazycogs `da.lazycogs.explain()` — a lightweight read-cost
// breakdown that does NOT issue any new network requests. Distinct asset
// keys come from cached `StacItemView.raw.assets`. Center overlap counts
// how many committed source bboxes contain the current viewport center.
// Tile bytes per item is a best-effort estimate from the first cached
// GeoTIFF's IFD (tileWidth × tileHeight × bandCount × bytesPerSample);
// returns null on failure so the UI can show a dash.
function bboxesIntersect(
	a: [number, number, number, number],
	b: [number, number, number, number]
): boolean {
	return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}
const distinctAssetKeys = $derived.by(() => {
	const set = new Set<string>();
	for (const v of committedViews as StacItemView[]) {
		const assets = v.raw?.assets;
		if (!assets) continue;
		for (const k of Object.keys(assets)) set.add(k);
	}
	return set.size;
});
let mapCenterTick = $state(0);
const centerOverlapCount = $derived.by(() => {
	// touch the tick so panning re-evaluates
	mapCenterTick;
	if (!mapRef) return 0;
	try {
		const c = mapRef.getCenter();
		const lng = c.lng;
		const lat = c.lat;
		const point: [number, number, number, number] = [lng, lat, lng, lat];
		let n = 0;
		for (const s of committedSources) {
			if (bboxesIntersect(s.bbox, point)) n++;
		}
		return n;
	} catch {
		return 0;
	}
});
const estimatedTileBytes = $derived.by(() => {
	try {
		// Find any resolved GeoTIFF in the cache and probe its IFD tags.
		// `geotiffCache` stores `Promise<GeoTIFF>`; we need a settled value,
		// so peek by racing with a resolved-marker. To stay sync, we rely on
		// the fact that probedBandCount only flips after a GeoTIFF resolved;
		// look up an entry by iterating committedSources and reading the
		// promise's settled value via `.then` is not synchronous, so instead
		// we recompute from the detected band count + a typical tile size
		// (256x256) and a bytesPerSample inferred from `detectedDataType`.
		if (!probedBandCount || committedSources.length === 0) return null;
		const bandCount = detectedBandCount;
		const dt = detectedDataType.toLowerCase();
		let bytesPerSample = 1;
		if (dt.includes('16')) bytesPerSample = 2;
		else if (dt.includes('32')) bytesPerSample = 4;
		else if (dt.includes('64')) bytesPerSample = 8;
		const tileW = 256;
		const tileH = 256;
		return tileW * tileH * bandCount * bytesPerSample;
	} catch {
		return null;
	}
});
const timeSpan = $derived.by(() => {
	let minT = Number.POSITIVE_INFINITY;
	let maxT = Number.NEGATIVE_INFINITY;
	let minIso: string | null = null;
	let maxIso: string | null = null;
	for (const v of committedViews as StacItemView[]) {
		const iso = v.datetime ?? v.endDatetime;
		if (!iso) continue;
		const t = Date.parse(iso);
		if (!Number.isFinite(t)) continue;
		if (t < minT) {
			minT = t;
			minIso = iso;
		}
		if (t > maxT) {
			maxT = t;
			maxIso = iso;
		}
	}
	if (!minIso || !maxIso) return null;
	return { start: minIso.slice(0, 10), end: maxIso.slice(0, 10) };
});

// ─── Stage HUD ─────────────────────────────────────────────────────
type Stage = 'idle' | 'classify' | 'fetch' | 'index' | 'render' | 'done' | 'error';
let stage = $state<Stage>('idle');
let stageFetched = $state(0);
let stageHinted = $state<number | null>(null);
let lastRefreshAt = $state<number | null>(null);
let stageMessage = $state<string | null>(null);
let showFilters = $state(false);
// Storage smoke-test result for the first representative COG. Inspired by
// lazycogs `_smoketest_store`: a one-byte ranged GET surfaces auth / CORS /
// presign failures at viewer load instead of waiting for the inner TileLayer
// to fail mid-render. Only set when probe fails, so the HUD stays quiet on
// the happy path. Cleared on every `loadMosaic()` retry.
let smokeWarning = $state<string | null>(null);
let smokeProbed = false;

let pool: DecoderPool | null = new DecoderPool();
const epsgResolver = createEpsgResolver();

// ─── Layer derivation (THE renderer) ───────────────────────────────
// The full deck.gl layer set is a pure function of (committedSources,
// bandConfig, rescale, pipelineGen, showFootprints, hoveredId, selectedId,
// filterState). Whenever any of these change, `layers` re-derives with a
// fresh layer instance and the single $effect below propagates it through
// `MapboxOverlay.setProps`. Layer identity is content-hashed so deck.gl
// reconciles in-place when content is unchanged and cleanly remounts when
// content changes — never reusing a finalized instance.
function hashSources(items: ReadonlyArray<MosaicSourceMeta>): string {
	if (items.length === 0) return '0';
	return `${items.length}-${items[0].id}-${items[items.length - 1].id}`;
}
// Composite signature is embedded in every mosaic / multi-cog layer id so any
// band-or-asset swap forces deck.gl to unmount the stale layer and mount a
// fresh one with freshly resolved sources. Without this, `setComposite` only
// updates `composite` state — `setMosaicAssetKey` early-returns when only the
// band index changed (single-asset path), and `setComposite` does not call
// `bumpPipeline` for the multi-asset path, so the layer id stays the same and
// deck.gl reconciles in-place over an internal source map opened under the
// previous composite.
function compositeSignature(c: ChannelComposite | null): string {
	if (!c) return 'none';
	return `${c.r.assetKey}.${c.r.bandIndex}-${c.g.assetKey}.${c.g.bandIndex}-${c.b.assetKey}.${c.b.bandIndex}`;
}
const mosaicId = $derived(
	`mosaic-${hashSources(filteredItems)}-c${compositeSignature(composite)}-p${pipelineGen}`
);
const footprintId = $derived(`footprints-${tab.id}`);

const mosaicLayer = $derived.by(() => {
	if (filteredItems.length === 0) return null;
	const sources = $state.snapshot(filteredItems) as MosaicSourceMeta[];
	const bc = bandConfig ? { ...bandConfig } : null;
	const rs = { ...rescale };
	const signal = abortController.signal;
	const gen = pipelineGen;
	// `onTileUnload` is forwarded by our pnpm patch to the inner TileLayer
	// but is not in MosaicLayerProps. `any` widens at the boundary so we
	// can drive Svelte-side cache eviction off deck.gl's tile-unload signal.
	const mosaicProps: any = {
		id: mosaicId,
		sources,
		maxCacheSize: TILE_CACHE_MAX,
		// Cap concurrent COG range fetches the inner TileLayer can fire. With a
		// dense mosaic on a single S3 host (e.g. source.coop) Chrome's per-renderer
		// URL request budget exhausts as `net::ERR_INSUFFICIENT_RESOURCES` once
		// hundreds of sources go in-flight together. 6 matches Chrome's HTTP/1.1
		// per-host concurrency cap; deck.gl forwards `maxRequests` natively (see
		// `dist/mosaic-layer/mosaic-layer.js:15`).
		maxRequests: 6,
		// Coalesce pan/zoom-jitter so we don't fire range fetches that get aborted
		// half a frame later. deck.gl forwards `debounceTime` natively to TileLayer.
		debounceTime: 200,
		onTileUnload: (tile: { index?: { id?: string } } | undefined) => {
			const sid = tile?.index?.id;
			if (typeof sid !== 'string') return;
			// Keep `geotiffCache` / `presignCache` / `sourceHrefById` populated
			// past the tile unload — they are bounded by `SOURCE_CACHE_MAX`
			// (LRU-evicted under pressure) and are tiny per entry. This makes
			// pan-back to a previously-visited bbox skip the COG header
			// re-fetch and the SigV4 re-sign. Histograms reflect visible
			// pixels, not source data, so they are still dropped here.
			if (sourceHistograms.delete(sid)) aggregateSources();
		},
		getSource: async (source: MosaicSourceMeta, opts: { signal?: AbortSignal }) => {
			const cached = geotiffCache.get(source.id);
			if (cached) return cached.catch(() => undefined as unknown as GeoTIFF);
			const promise = (async () => {
				const url = await presignHref(source.href);
				const geotiff = await loadGeoTIFF(url);
				normalizeCogGeotiff(geotiff);
				return geotiff;
			})();
			geotiffCache.set(source.id, promise);
			sourceHrefById.set(source.id, source.href);
			let geotiff: GeoTIFF;
			try {
				geotiff = await promise;
			} catch (err) {
				// Swallow per-source fetch/decode failures so deck.gl's TileLayer
				// gets `data: undefined` (renderSource returns null for it) instead
				// of a rejected promise, which surfaces as "v is null" during the
				// TileLayer update when a mosaic covers hundreds of unreachable
				// sources (e.g. a 302k-item global catalog). Surface only the first
				// distinct error per session so the network panel hints why a
				// mosaic is empty without flooding the console on bad catalogs.
				if (!sourceErrorLogged) {
					sourceErrorLogged = true;
					console.warn('[StacMosaic] getSource failed', {
						id: source.id,
						href: source.href,
						error: err instanceof Error ? err.message : err
					});
				}
				return undefined as unknown as GeoTIFF;
			}
			if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			// Seed band config from the first COG that resolves so the UI and
			// the pipeline match the actual raster (e.g. 4-band NAIP RGB+NIR).
			if (!probedBandCount) {
				probedBandCount = true;
				const count = geotiff.count ?? 3;
				const sf = geotiff.cachedTags.sampleFormat?.[0] ?? 1;
				const bps = geotiff.cachedTags.bitsPerSample?.[0] ?? 8;
				detectedBandCount = count;
				detectedDataType = buildDataTypeLabel(sf, bps);
				// Surface GDAL_NODATA so the CogControls Auto pill / shader filter
				// has a real number before the multi-asset histogram bake fires.
				autoNodata = readGdalNodata(geotiff);
				// Catalogs without `eo:bands` / `raster:bands` / `properties.bands`
				// (e.g. tge-labs/aef: one `data` asset, 64-band Int8 cube) seed
				// `cogAssets` with `bandCount: 1, bandCountKnown: false`, which
				// makes the RGB picker collapse every channel row to "Band 1".
				// Now that we know the real count, patch the asset feeding the
				// mosaic so the picker exposes all bands.
				const probedKey = mosaicAssetKey ?? composite?.r.assetKey ?? cogAssets[0]?.key;
				if (probedKey && cogAssets.length > 0) {
					let changed = false;
					const updated = cogAssets.map((a) => {
						if (a.key !== probedKey) return a;
						if (a.bandCountKnown && a.bandCount === count) return a;
						changed = true;
						return { ...a, bandCount: count, bandCountKnown: true };
					});
					if (changed) {
						cogAssets = updated;
						// If R/G/B all bound to the same asset at band 0 (the
						// fallback `pickNaturalColorComposite` emits when bandCount
						// was unknown/1), spread them across bands 0/1/2 of the
						// now-multi-band asset so the picker shows three distinct
						// band picks instead of three identical "Band 1" rows.
						const cur0 = composite;
						if (
							cur0 &&
							isSingleAssetComposite(cur0) &&
							cur0.r.bandIndex === 0 &&
							cur0.g.bandIndex === 0 &&
							cur0.b.bandIndex === 0 &&
							count >= 2
						) {
							const lim = Math.max(0, count - 1);
							composite = {
								r: { assetKey: cur0.r.assetKey, bandIndex: 0 },
								g: { assetKey: cur0.g.assetKey, bandIndex: Math.min(1, lim) },
								b: { assetKey: cur0.b.assetKey, bandIndex: Math.min(2, lim) }
							};
						}
					}
				}
				const seeded = defaultBandConfig(count, sf);
				// If the user already has a single-asset composite (URL hash, or
				// natural-color default with eo:bands ordering), seed `bandConfig`
				// with those band picks so the first render honors them instead
				// of overwriting with `defaultBandConfig`'s 0/1/2.
				const cur = composite;
				if (cur && isSingleAssetComposite(cur) && seeded.mode === 'rgb') {
					const lim = Math.max(0, count - 1);
					bandConfig = {
						...seeded,
						rBand: Math.min(cur.r.bandIndex, lim),
						gBand: Math.min(cur.g.bandIndex, lim),
						bBand: Math.min(cur.b.bandIndex, lim)
					};
				} else {
					bandConfig = seeded;
				}
			}
			return geotiff;
		},
		renderSource: (source: MosaicSourceMeta, { data }: { data: GeoTIFF | undefined }) => {
			if (!data) return null;
			const customProps = selectCogPipeline(data, { bandConfig: bc, rescale: rs });
			// `onViewportLoad` / `onTileError` are forwarded by our pnpm patch
			// but COGLayer's generated .d.ts does not expose them yet.
			const cogProps: any = {
				id: `cog-${source.id}-p${gen}`,
				geotiff: data,
				pool: pool ?? undefined,
				epsgResolver,
				signal,
				...customProps,
				onViewportLoad: (visibleTiles: unknown) => {
					recordSourceHistogram(
						source.id,
						visibleTiles as ReadonlyArray<{ content?: unknown } | null | undefined>
					);
				},
				onTileError: (err: unknown) => {
					if (isAbortError(err)) return;
					logTileErrorOnce(source.id, err);
				}
			};
			return new COGLayer(cogProps);
		}
	};
	return new MosaicLayer<MosaicSourceMeta, GeoTIFF>(mosaicProps);
});

// Multi-asset mosaic memory ceiling: with N items × 3 distinct assets the
// worst case is 3N COG range-request streams. `mosaicItemLimit` (settings)
// bounds N. If `multiCogLayers.length × 3` exceeds 300 the user gets a
// warning HUD pill (see template).
const multiCogLayers = $derived.by(() => {
	const c = composite;
	if (!c) return [] as MultiCOGLayer[];
	if (isSingleAssetComposite(c)) return [] as MultiCOGLayer[];
	const views = filteredViews;
	if (views.length === 0) return [] as MultiCOGLayer[];
	const out: MultiCOGLayer[] = [];
	const rs = { ...rescale };
	const gen = pipelineGen;
	const resolvedNodata = resolveNodata(nodataConfig, autoNodata);
	// Hoisted: same value for every per-item layer in this derive run. Embedded
	// in every layer id so band/asset swaps remount the layer (see
	// `compositeSignature` doc comment above).
	const compositeKey = compositeSignature(c);
	for (const view of views) {
		const item = view.raw;
		const itemAssets = extractCogAssets(item);
		const sources: Record<string, { url: string }> = {};
		for (const ref of [c.r, c.g, c.b]) {
			if (sources[ref.assetKey]) continue;
			const a = itemAssets.find((x) => x.key === ref.assetKey);
			if (!a) continue;
			// Sync lookup against the resolved-URL map populated by
			// `presignHref`. If the presign hasn't settled yet, schedule it
			// and skip this item this tick — the next render after the
			// promise resolves will include it (the derivation re-runs when
			// `pipelineGen` bumps or filteredViews changes; we also poke
			// the chain via committing on presign resolution where needed).
			const resolved = resolvedHrefByOriginal.get(a.href);
			if (resolved) {
				sources[a.key] = { url: resolved };
			} else {
				presignHref(a.href);
			}
		}
		// Skip items whose 3 channels don't all have resolved URLs yet.
		if (!sources[c.r.assetKey] || !sources[c.g.assetKey] || !sources[c.b.assetKey]) continue;
		// `onTileError` is forwarded by our pnpm patch but is not in the
		// generated MultiCOGLayer .d.ts. Widen at the boundary.
		const layerProps: any = {
			id: `mosaic-multicog-${view.id}-c${compositeKey}-p${gen}`,
			sources,
			composite: { r: c.r.assetKey, g: c.g.assetKey, b: c.b.assetKey },
			renderPipeline: buildBandRenderPipeline({
				noDataVal: resolvedNodata,
				rescale: rs
			}),
			pool: pool ?? undefined,
			epsgResolver,
			// See MosaicLayer note above. The multi-asset path runs N per-item
			// layers, so the aggregate concurrency budget is even tighter —
			// keep `maxRequests` low.
			maxRequests: 6,
			debounceTime: 200,
			onTileError: (err: Error) => {
				if (isAbortError(err)) return;
				logTileErrorOnce(view.id, err);
			}
		};
		out.push(new MultiCOGLayer(layerProps));
	}
	return out;
});

const footprintLayer = $derived.by(() => {
	if (!showFootprints) return null;
	const views = committedViews as StacItemView[];
	if (views.length === 0) return null;
	const allowedIds = new Set(filteredViews.map((v) => v.id));
	const filtersOn = filtersActive;
	type FootprintProps = { id: string };
	type FootprintFeature = {
		type: 'Feature';
		properties: FootprintProps;
		geometry: { type: 'Polygon'; coordinates: number[][][] };
	};
	const features: FootprintFeature[] = [];
	for (const v of views) {
		if (!v.bbox) continue;
		const [w, s, e, n] = v.bbox;
		features.push({
			type: 'Feature',
			properties: { id: v.id },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[w, s],
						[e, s],
						[e, n],
						[w, n],
						[w, s]
					]
				]
			}
		});
	}
	if (features.length === 0) return null;
	const hovered = hoveredId;
	const selected = selectedId;
	type FeatureLike = { properties?: FootprintProps | null };
	return new GeoJsonLayer<FootprintProps>({
		id: footprintId,
		data: { type: 'FeatureCollection', features },
		stroked: true,
		// `filled: true` with a near-transparent fill makes the polygon
		// interior pickable. With `filled: false` deck.gl's hit test only
		// covers the stroke edge, which means clicks inside the box never
		// fire `onClick` and the yellow selection highlight never appears.
		filled: true,
		pickable: true,
		lineWidthUnits: 'pixels',
		// Force a 1-pixel minimum so the outline never anti-aliases away at
		// low zoom — without this, the orange grid disappears when the
		// rendered line falls below a fragment.
		lineWidthMinPixels: 1,
		// `updateTriggers` keeps the GeoJsonLayer instance stable across
		// hover/select/filter changes — only the per-feature accessors
		// re-run, no full data re-tessellation. Cheaper than rebuilding the
		// layer for every mouse move.
		updateTriggers: {
			getLineColor: [hovered, selected, filtersOn, allowedIds.size],
			getLineWidth: [hovered, selected, filtersOn, allowedIds.size],
			getFillColor: [hovered, selected]
		},
		getLineColor: (f: FeatureLike): [number, number, number, number] => {
			const id = f.properties?.id;
			if (id === selected) return [255, 221, 51, 255]; // amber yellow
			if (id === hovered) return [255, 165, 0, 255]; // bright orange
			if (filtersOn && id && !allowedIds.has(id)) return [255, 140, 0, 90]; // dim orange
			return [255, 140, 0, 220]; // orange
		},
		getFillColor: (f: FeatureLike): [number, number, number, number] => {
			const id = f.properties?.id;
			// Selected gets a faint amber wash so it reads as filled; everything
			// else uses alpha=1 (effectively invisible) to keep picking on
			// without altering the visual.
			if (id === selected) return [255, 221, 51, 40];
			if (id === hovered) return [255, 165, 0, 24];
			return [0, 0, 0, 1];
		},
		getLineWidth: (f: FeatureLike): number => {
			const id = f.properties?.id;
			if (id === selected) return 3;
			if (id === hovered) return 2.5;
			if (filtersOn && id && !allowedIds.has(id)) return 0.5;
			return 1.5;
		},
		onHover: (info: { object?: FeatureLike | null }) => {
			const id = info.object?.properties?.id ?? null;
			if (id !== hoveredId) hoveredId = id;
		},
		onClick: (info: { object?: FeatureLike | null }) => {
			const id = info.object?.properties?.id ?? null;
			const next = selectedId === id ? null : id;
			selectedId = next;
			if (next) flyToSelected(next);
		}
	});
});

const layers = $derived.by(() => {
	const out: unknown[] = [];
	const c = composite;
	if (c && isSingleAssetComposite(c) && mosaicLayer) {
		out.push(mosaicLayer);
	} else if (c && !isSingleAssetComposite(c)) {
		out.push(...multiCogLayers);
	} else if (mosaicLayer) {
		// Composite hasn't resolved yet (first batch not seeded). Keep the
		// single-asset MosaicLayer painting the default-href mosaic so the
		// user sees a frame as soon as items arrive.
		out.push(mosaicLayer);
	}
	if (footprintLayer) out.push(footprintLayer);
	return out;
});

// Single push effect: every reactive change funnels here. `layers` MUST be
// read before any early return so Svelte tracks it as a dependency on the
// first run (even when `overlayRef` is still null pre-`onMapReady`).
// Otherwise the effect's dep set comes back empty, the reactive graph
// disconnects, and setProps is never called once the overlay attaches.
$effect(() => {
	const ls = layers;
	if (!overlayRef) return;
	overlayRef.setProps({
		layers: ls as Parameters<typeof overlayRef.setProps>[0]['layers']
	});
});

// ─── Tab lifecycle ─────────────────────────────────────────────────
$effect(() => {
	if (!tab) return;
	tab.id;
	untrack(() => {
		resetViewer();
		if (mapRef) {
			const restart = loadMosaic(mapRef);
			inflightLoad = restart.catch(() => {});
			void restart;
		}
	});
});

function resetViewer(): void {
	abortController.abort();
	abortController = new AbortController();
	hydrationController.abort();
	hydrationController = new AbortController();
	inflightLoad = null;
	teardownViewportReload();
	kind = 'static';
	stage = 'idle';
	stageFetched = 0;
	stageHinted = null;
	stageMessage = null;
	lastRefreshAt = null;
	if (mapRef) cleanupNativeBitmap(mapRef);
	itemsRef = [];
	itemViewsRef = [];
	committedSources = [];
	committedViews = [];
	mapZoomBin = mapRef ? Math.floor(mapRef.getZoom()) : null;
	pipelineGen = 0;
	hoveredId = null;
	selectedId = null;
	filterState = emptyFacetState();
	presignCache = new LruCache<string, Promise<string>>({ max: SOURCE_CACHE_MAX });
	geotiffCache = new LruCache<string, Promise<GeoTIFF>>({ max: SOURCE_CACHE_MAX });
	resolvedHrefByOriginal = new LruCache<string, string>({ max: SOURCE_CACHE_MAX });
	sourceHrefById = new Map();
	sourceHistograms = new Map();
	if (multiCogRebuildHandle !== null) {
		cancelAnimationFrame(multiCogRebuildHandle);
		multiCogRebuildHandle = null;
	}
	loading = true;
	error = null;
	bounds = undefined;
	bandConfig = null;
	histogram = null;
	multiHistogramKey = null;
	userTouchedRescale = false;
	nodataConfig = { ...DEFAULT_NODATA_CONFIG };
	autoNodata = null;
	rescale = { ...DEFAULT_RESCALE };
	hasFittedOnce = false;
	showControls = false;
	showInfo = false;
	detectedBandCount = 3;
	detectedDataType = '';
	probedBandCount = false;
	availableAssets = [];
	mosaicAssetKey = null;
	cogAssets = [];
	composite = null;
	activePresetId = '';
	pixelValue = null;
	pixelSourceId = null;
	inspecting = false;
	if (mapRef) removeClickHandler();
}

/**
 * Atomic transition from the streaming buffer (`itemsRef`/`itemViewsRef`)
 * to the rendered set (`committedSources`/`committedViews`). All layer
 * rebuilds happen as a side effect of these two assignments via the
 * derived chain — there is no separate "schedule rebuild" or "push layers"
 * step.
 *
 * Dedup-by-id is enforced here, NOT at the accept site. The accept-site
 * `seenIds` defends within a single loadMosaic call, but viewport reloads
 * + paginated STAC APIs can still surface the same item.id across batches
 * that the buffer has already mixed (revisits with different cell keys,
 * static catalogs that re-walk overlapping links, API pages that overlap
 * the previous response). The commit boundary is the single chokepoint
 * before the renderer, so deduping here makes correctness independent of
 * how the buffer was built. `MosaicSourceMeta` and `StacItemView` are kept
 * lockstep by index, so the same predicate filters both. Snapshotting via
 * fresh arrays defends against deck.gl seeing a proxied Svelte array
 * (Flatbush's spatial index over a Proxy triggers deep_read on every
 * probe) and gives Svelte's keyed `{#each ... (view.id)}` a unique-by-id
 * list — preventing `each_key_duplicate` even when upstream sources are
 * sloppy.
 */
function commitSources(): void {
	const len = Math.min(itemsRef.length, itemViewsRef.length);
	const seen = new Set<string>();
	const sources: MosaicSourceMeta[] = [];
	const views: StacItemView[] = [];
	for (let i = 0; i < len; i++) {
		const id = itemsRef[i].id;
		if (seen.has(id)) continue;
		seen.add(id);
		sources.push(itemsRef[i]);
		views.push(itemViewsRef[i]);
	}
	// Pan-back caching: items that drop out of `committedViews` no longer
	// have a rendered layer, but their COG headers + presigned URLs stay in
	// the LRU caches so pan-back to the previous bbox does not re-pay the
	// header IFD fetch and the SigV4 re-sign. The caches are bounded by
	// `SOURCE_CACHE_MAX` and are tiny per entry. Aggressive diff-eviction
	// here would defeat that for both the single-asset and multi-asset
	// paths.
	committedSources = sources;
	committedViews = views;
}

/** Bump pipeline generation so the inner TileLayer + per-source COGLayer
 *  trees fully unmount/remount when the GPU pipeline definition changes
 *  (band picker, rescale slider). Same content hash → same overall
 *  MosaicLayer id stem, but the `-pN` suffix forces a clean remount. */
function bumpPipeline(): void {
	pipelineGen++;
}

function removeClickHandler(): void {
	if (detachInspector) {
		detachInspector();
		detachInspector = null;
	}
}

type MosaicProbeResult = { value: PixelValue; sourceId: string };

function setupClickHandler(map: maplibregl.Map): void {
	removeClickHandler();
	detachInspector = attachPixelInspector<MosaicProbeResult>(map, {
		probe: async ({ lng, lat, signal }) => {
			// Click against the rendered set, not the streaming buffer, so the
			// pixel readout matches what the user is actually looking at. Reverse
			// iteration matches MosaicLayer's z-order (last source on top).
			const items = committedSources;
			let hit: MosaicSourceMeta | undefined;
			for (let i = items.length - 1; i >= 0; i--) {
				const [w, s, east, n] = items[i].bbox;
				if (lng >= w && lng <= east && lat >= s && lat <= n) {
					hit = items[i];
					break;
				}
			}
			if (!hit) return null;
			let geotiffPromise = geotiffCache.get(hit.id);
			if (!geotiffPromise) {
				geotiffPromise = (async () => {
					const url = await presignHref(hit.href);
					const g = await loadGeoTIFF(url);
					normalizeCogGeotiff(g);
					return g;
				})();
				geotiffCache.set(hit.id, geotiffPromise);
				sourceHrefById.set(hit.id, hit.href);
			}
			const geotiff = await geotiffPromise;
			const proj4Def = await resolveProj4Def(geotiff.crs, signal);
			// Match the overview that's currently on screen so the pixel readout
			// reflects the visible decimation level. Per-source COGs may have
			// different overview pyramids so the pick happens after the source
			// is resolved.
			const targetRes = mapResolutionMetersPerPixel(map.getZoom(), lat);
			const overview = selectOverviewForResolution(geotiff, targetRes);
			const result = await readPixelAtLngLat(geotiff, lng, lat, proj4Def, pool, signal, {
				overview
			});
			if (!result) return null;
			return { value: result, sourceId: hit.id };
		},
		onStart: () => {
			inspecting = true;
		},
		onResult: (result) => {
			pixelValue = result?.value ?? null;
			pixelSourceId = result?.sourceId ?? null;
			inspecting = false;
		}
	});
}

function onMapReady(map: maplibregl.Map): void {
	mapRef = map;
	// Bump the center-tick so the Explain panel's center-overlap stat
	// re-derives whenever the user pans / zooms. Also update `mapZoomBin`
	// (integer zoom) so `culledSources` re-evaluates only at zoom-level
	// boundaries — within a bin the source list is stable, so micro-pans
	// don't churn the inner TileLayer.
	mapZoomBin = Math.floor(map.getZoom());
	map.on('moveend', () => {
		mapCenterTick++;
		const z = Math.floor(map.getZoom());
		if (z !== mapZoomBin) mapZoomBin = z;
	});
	setupClickHandler(map);
	const overlay = new MapboxOverlay({
		interleaved: false,
		layers: [],
		onError: (err: Error) => {
			if (abortController.signal.aborted) return;
			if (isAbortError(err)) return;
			if (!error) {
				error = err?.message || String(err);
				loading = false;
			}
		}
	});
	overlayRef = overlay;
	map.addControl(overlay as unknown as maplibregl.IControl);
	const initial = loadMosaic(map);
	inflightLoad = initial.catch(() => {});
	void initial;
}

function viewportBbox(map: maplibregl.Map): [number, number, number, number] {
	const b = map.getBounds();
	const c = clampBounds({
		west: b.getWest(),
		south: b.getSouth(),
		east: b.getEast(),
		north: b.getNorth()
	});
	return [c.west, c.south, c.east, c.north];
}

function setupViewportReload(map: maplibregl.Map): void {
	teardownViewportReload();
	moveHandlerRef = () => {
		if (moveDebounceTimer != null) clearTimeout(moveDebounceTimer);
		moveDebounceTimer = window.setTimeout(() => {
			moveDebounceTimer = null;
			if (!mapRef) return;
			void reloadViewport();
		}, VIEWPORT_DEBOUNCE_MS);
	};
	map.on('moveend', moveHandlerRef);
}

function teardownViewportReload(): void {
	if (moveDebounceTimer != null) {
		clearTimeout(moveDebounceTimer);
		moveDebounceTimer = null;
	}
	if (mapRef && moveHandlerRef) {
		mapRef.off('moveend', moveHandlerRef);
		moveHandlerRef = null;
	}
}

async function reloadViewport(): Promise<void> {
	if (!mapRef) return;
	if (hydrationController.signal.aborted === false && stage === 'fetch') {
		stageMessage = t('stac.stageSuperseded');
	}
	hydrationController.abort();
	// Wait for the prior loadMosaic to actually settle before issuing a new
	// one. Without this, the JS-side abort returns instantly but the underlying
	// DuckDB queryStream keeps scanning the parquet (cancelSent is polled at
	// batch boundaries, ~10s for a Philly-sized scan). Stacking these without
	// waiting reproduced the 3.1 GiB OOM from rapid moveend events.
	if (inflightLoad) {
		try {
			await inflightLoad;
		} catch {
			/* prior was aborted or errored — fine, we're starting fresh */
		}
	}
	hydrationController = new AbortController();
	error = null;
	loading = true;
	hasFittedOnce = true;
	const next = loadMosaic(mapRef);
	inflightLoad = next.catch(() => {});
	await next;
}

function extractConnectionKey(href: string): string | null {
	const conn = tab.connectionId ? connectionStore.getById(tab.connectionId) : undefined;
	if (!conn) return null;
	const base = buildProviderBaseUrl(
		conn.provider as ProviderId,
		conn.endpoint,
		conn.bucket,
		conn.region
	).replace(/\/$/, '');
	if (!base) return null;
	const prefix = `${base}/`;
	if (!href.startsWith(prefix)) return null;
	return href.slice(prefix.length);
}

function doPresign(href: string): Promise<string> {
	const normalized = resolveCloudUrl(href);
	if (/^https?:\/\//i.test(normalized)) {
		const key = extractConnectionKey(normalized);
		if (key !== null) {
			return buildHttpsUrlAsync({ ...tab, path: key } as Tab).catch(() => normalized);
		}
		return Promise.resolve(normalized);
	}
	return buildHttpsUrlAsync({ ...tab, path: normalized } as Tab).catch(() => normalized);
}

// Coalesced multi-asset rebuild scheduler. Many presigns can resolve in the
// same tick when a viewport batch lands; bumping `pipelineGen` per resolve
// would rebuild the `$derived multiCogLayers` once per resolution and remount
// every visible MultiCOGLayer mid-pan. Schedule one rebuild per animation
// frame instead so resolutions coalesce into a single re-derive. The handle
// is captured so teardown / asset swap / reset can cancel a pending rAF
// before it writes to `pipelineGen` post-cleanup.
let multiCogRebuildHandle: number | null = null;
function scheduleMultiCogRebuild(): void {
	if (multiCogRebuildHandle !== null) return;
	const c = composite;
	if (!c || isSingleAssetComposite(c)) return;
	multiCogRebuildHandle = requestAnimationFrame(() => {
		multiCogRebuildHandle = null;
		const cur = composite;
		if (!cur || isSingleAssetComposite(cur)) return;
		bumpPipeline();
	});
}

function presignHref(href: string): Promise<string> {
	let cached = presignCache.get(href);
	if (!cached) {
		// Populate `resolvedHrefByOriginal` once the promise settles so the
		// multi-asset MultiCOGLayer derivation can attach URLs synchronously.
		// On the multi-asset path, schedule a coalesced rebuild so items whose
		// 3 channels just became available join the rendered set on the next
		// frame. Cheap on the single-asset path (early return when composite
		// is single-asset).
		cached = doPresign(href).then((url) => {
			const wasNew = !resolvedHrefByOriginal.has(href);
			resolvedHrefByOriginal.set(href, url);
			if (wasNew) scheduleMultiCogRebuild();
			return url;
		});
		presignCache.set(href, cached);
	}
	return cached;
}

function extendBounds(
	current: [number, number, number, number] | null,
	items: MosaicSourceMeta[]
): [number, number, number, number] | null {
	if (items.length === 0) return current;
	let [w, s, e, n] = current ?? items[0].bbox;
	for (const item of items) {
		w = Math.min(w, item.bbox[0]);
		s = Math.min(s, item.bbox[1]);
		e = Math.max(e, item.bbox[2]);
		n = Math.max(n, item.bbox[3]);
	}
	const clamped = clampBounds({ west: w, south: s, east: e, north: n });
	return [clamped.west, clamped.south, clamped.east, clamped.north];
}

function applyFacetsToItems(
	items: import('../../utils/stac.js').StacItem[],
	residual: FacetState
): import('../../utils/stac.js').StacItem[] {
	if (!hasActiveFilters(residual)) return items;
	const views = items.map(extractItemView);
	const allowed = new Set(applyFacets(views, residual).map((v) => v.id));
	return items.filter((it) => allowed.has(String(it.id)));
}

async function loadMosaic(map: maplibregl.Map): Promise<void> {
	const gen = ++loadGen;
	const signal = hydrationController.signal;
	const cellCounts = new Map<string, number>();
	const seenIds = new Set<string>();
	const dedupeByCell = dedupeLatest;
	stage = 'classify';
	stageMessage = null;
	stageFetched = 0;
	stageHinted = null;
	smokeWarning = null;
	smokeProbed = false;
	loggedTileErrors.clear();
	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const ext = (tab.extension ?? '').toLowerCase();

		let classifiedKind: StacRoutableKind;
		if (ext === 'parquet' || ext === 'geoparquet') {
			classifiedKind = {
				kind: 'item-collection',
				fc: { type: 'FeatureCollection', features: [] }
			};
		} else if (classified && classified.kind !== 'none') {
			classifiedKind = classified;
		} else {
			const data = await adapter.read(tab.path, undefined, undefined, signal);
			if (gen !== loadGen || signal.aborted) return;
			const parsed = JSON.parse(new TextDecoder().decode(data));
			classifiedKind = classifyStac(parsed);
		}
		if (classifiedKind.kind === 'none') {
			error = t('map.mosaicEmpty');
			loading = false;
			return;
		}

		const baseHref = await buildHttpsUrlAsync(tab);
		if (gen !== loadGen || signal.aborted) return;

		const source: StacSource = createStacSourceForTab(tab, classifiedKind, {
			adapter,
			urlToKey: extractConnectionKey,
			baseHref,
			connectionId: tab.connectionId ?? ''
		});
		kind = source.capabilities.kind;
		// `api` streams over a viewport-scoped query, `parquet` re-runs the SQL
		// with the new bbox. Both want a moveend listener. `static` walks a
		// fixed advertised tree and never re-queries on pan.
		if (kind === 'static') {
			teardownViewportReload();
		} else {
			setupViewportReload(map);
		}

		const effectiveFilter: FacetState = { ...filterState };

		const apiBacked = kind === 'api';
		stage = 'fetch';
		stageHinted = itemLimit;
		let firstBatch = true;
		let runningBounds: [number, number, number, number] | null = null;
		let fetchedItemCount = 0;
		let acceptedCount = 0;

		for await (const batch of source.query({
			bbox: viewportBbox(map),
			filter: effectiveFilter,
			limit: itemLimit,
			pageSize: VIEWPORT_PAGE_LIMIT,
			signal
		})) {
			if (gen !== loadGen || signal.aborted) return;
			fetchedItemCount += batch.items.length;
			stageFetched = fetchedItemCount;

			const residualFilteredItems = applyFacetsToItems(batch.items, batch.residual);

			// Seed asset picker from the first item with raster assets so the user
			// can flip from `visual` → `red` / `nir` / etc. without a re-query.
			if (availableAssets.length === 0) {
				for (const probe of residualFilteredItems) {
					const probed = extractMosaicAssets(probe);
					if (probed.length > 0) {
						availableAssets = probed;
						if (!mosaicAssetKey) {
							const defaultHref = pickCogAssetHref(probe);
							const matched = probed.find((a) => a.href === defaultHref);
							mosaicAssetKey = matched?.key ?? probed[0].key;
						}
						// Also seed the unified RGB picker state. URL hash takes
						// priority, otherwise natural-color default.
						const nextCogAssets = extractCogAssets(probe);
						cogAssets = nextCogAssets;
						const params = getUrlViewParams();
						const fromUrl = compositeFromUrl(params, nextCogAssets);
						if (fromUrl && isSingleAssetComposite(fromUrl)) {
							composite = fromUrl;
							const presetId = params.get('preset');
							activePresetId = presetId && PRESETS.find((p) => p.id === presetId) ? presetId : '';
						} else {
							const picked = pickNaturalColorComposite(nextCogAssets);
							if (picked) {
								composite = picked.composite;
								activePresetId = picked.source === 'rgb-bands' ? 'natural-color' : '';
							}
						}
						// Mirror composite.r.assetKey into the existing single-asset
						// mosaic state so buildMosaicSourceMeta keeps working.
						if (composite && isSingleAssetComposite(composite)) {
							mosaicAssetKey = composite.r.assetKey;
						}
						break;
					}
				}
			}

			const accepted: MosaicSourceMeta[] = [];
			const acceptedViews: StacItemView[] = [];
			const assetKeyForBuild = mosaicAssetKey ?? undefined;
			for (const item of residualFilteredItems) {
				const normalized = buildMosaicSourceMeta(item, assetKeyForBuild);
				if (!normalized) continue;
				// Same item.id can appear across pagination batches (revisits whose
				// spatialCellKey differs, or static catalogs that re-walk overlapping
				// links). The keyed `{#each ... (view.id)}` in StacItemStrip throws
				// `each_key_duplicate` if we let both through, so dedup by id first.
				if (seenIds.has(normalized.id)) continue;
				if (dedupeByCell) {
					const key = spatialCellKey(item, normalized.bbox);
					const seen = cellCounts.get(key) ?? 0;
					if (seen >= LATEST_KEEP_PER_CELL) continue;
					cellCounts.set(key, seen + 1);
				}
				seenIds.add(normalized.id);
				accepted.push(normalized);
				acceptedViews.push(extractItemView(item));
			}

			if (accepted.length === 0) {
				if (batch.done) break;
				continue;
			}
			acceptedCount += accepted.length;
			for (const src of accepted) presignHref(src.href);

			// Smoke-test a representative COG once per load. lazycogs does this
			// in `_smoketest_store` so credential / CORS issues surface in <1s
			// rather than as opaque "Failed to fetch" messages mid-tile-render.
			// Fire-and-forget: probe runs in parallel with the next batch and
			// writes to `smokeWarning` only on failure. Aborts via the per-pan
			// `hydrationController` so a viewport reload tears down the probe.
			if (!smokeProbed && accepted.length > 0) {
				smokeProbed = true;
				const probeHref = accepted[0].href;
				void (async () => {
					try {
						const url = await presignHref(probeHref);
						const result = await smokeTestHref(url, signal);
						if (gen !== loadGen || signal.aborted) return;
						if (!result.ok) smokeWarning = result.reason;
					} catch (err) {
						if (err instanceof DOMException && err.name === 'AbortError') return;
						if (gen !== loadGen) return;
						smokeWarning = err instanceof Error ? err.message : String(err);
					}
				})();
			}

			// Update the streaming buffer. The renderer is intentionally NOT
			// driven by `itemsRef` — only by `committedSources`. We commit
			// only at strategic boundaries below to control rebuild cadence.
			if (apiBacked && firstBatch) {
				itemsRef = accepted.slice().reverse();
				itemViewsRef = acceptedViews.slice().reverse();
				firstBatch = false;
				// Atomic swap: promote the new viewport's first batch to the
				// renderer immediately so the user sees a frame.
				commitSources();
			} else if (apiBacked) {
				// Trade-off: api streams arrive newest-first via `rel="next"`
				// and a single rebuild per page would churn the inner
				// TileLayer cache mid-pan, restarting every visible COG range
				// fetch. So intermediate pages stay in the buffer and only
				// the first batch + the final flush touch the renderer. The
				// downside is a long-running stream (e.g. 10s for 2000 items)
				// shows only the freshest page until the stream completes.
				// Acceptable because (a) the first page is what the user
				// actually sees at the current zoom, (b) older pages are
				// dimmer revisits that mostly overlap the first, and (c) the
				// final flush is a single declarative re-derive, not a
				// per-page deck.gl rebuild. Static / parquet do not have this
				// constraint and commit per batch below.
				itemsRef = [...accepted.slice().reverse(), ...itemsRef];
				itemViewsRef = [...acceptedViews.slice().reverse(), ...itemViewsRef];
			} else if (kind === 'parquet' && firstBatch) {
				// Parquet re-runs `ST_Intersects(geometry, ST_MakeEnvelope(...))`
				// on every moveend, so the previous viewport's sources are stale.
				// Atomic-swap the new viewport's first (and, for our single-yield
				// parquet source, only) batch so sources don't accumulate across
				// pans, matching the "atomic source swap on viewport reload" rule.
				itemsRef = accepted.slice();
				itemViewsRef = acceptedViews.slice();
				firstBatch = false;
				commitSources();
			} else {
				// Static catalog walk: append in catalog order. Static does not
				// re-run on pan (moveend listener is torn down), so itemsRef
				// always starts empty after resetViewer and per-batch commits
				// are cheap.
				itemsRef = [...itemsRef, ...accepted];
				itemViewsRef = [...itemViewsRef, ...acceptedViews];
				commitSources();
			}

			runningBounds = extendBounds(runningBounds, accepted);
			if (!apiBacked && !hasFittedOnce && runningBounds) {
				bounds = runningBounds;
				fitCogBounds(map, {
					west: runningBounds[0],
					south: runningBounds[1],
					east: runningBounds[2],
					north: runningBounds[3]
				});
				hasFittedOnce = true;
			}

			if (!bandConfig) bandConfig = defaultBandConfig(detectedBandCount, 1);
			loading = false;

			if (batch.done) break;
		}

		if (gen !== loadGen) return;
		if (acceptedCount === 0 && !signal.aborted) {
			if (kind !== 'static') {
				itemsRef = [];
				itemViewsRef = [];
				commitSources();
			}
			if (kind === 'parquet' && fetchedItemCount === 0) {
				error = t('map.mosaicEmptyViewport');
			} else {
				error = fetchedItemCount === 0 ? t('map.mosaicEmpty') : t('map.mosaicNoAssets');
			}
			stage = 'done';
			lastRefreshAt = performance.now();
			loading = false;
			return;
		}
		if (!signal.aborted) {
			stage = 'render';
			// Final flush: promote everything the streaming loop accumulated.
			commitSources();
			stage = 'done';
			lastRefreshAt = performance.now();
		}
	} catch (err) {
		if (gen !== loadGen) return;
		if (signal.aborted) return;
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
		stage = 'error';
		loading = false;
	}
}

function flyToSelected(id: string): void {
	if (!mapRef) return;
	// Read the committed (rendered) set, not the streaming buffer. Items can
	// sit in `itemViewsRef` after being evicted from the renderer; clicking
	// on a footprint that is currently visible must always resolve.
	const view = committedViews.find((v) => v.id === id) ?? itemViewsRef.find((v) => v.id === id);
	if (!view?.bbox) return;
	const [w, s, e, n] = view.bbox;
	fitCogBounds(mapRef, { west: w, south: s, east: e, north: n });
}

const selectedView = $derived(
	selectedId ? (filteredViews.find((v) => v.id === selectedId) ?? null) : null
);

function toggleFootprints(): void {
	showFootprints = !showFootprints;
}

function applyFilterChange(next: FacetState): void {
	const prev = filterState;
	filterState = next;
	// In `api`/`parquet` modes the source's freshness window is capped at
	// `itemLimit` per request, so a residual-only change (e.g. cloud-cover or
	// platform) would otherwise leave the user looking at whichever items
	// happened to land in the original page rather than the freshest matches
	// for the new filter. Trigger a viewport reload on ANY filter change in
	// viewport mode so the source can re-query with the new request. Slice 1
	// push-down stays narrow (bbox + datetime); the new query just gives
	// later slices the chance to widen it without revisiting this site.
	if (isViewportMode && !facetStateEqual(prev, next)) {
		void reloadViewport();
	}
}

/**
 * Shallow structural equality for `FacetState`. Used to skip viewport reloads
 * when a filter callback fires with the same effective state (e.g. the panel
 * re-emits on remount).
 */
function facetStateEqual(a: FacetState, b: FacetState): boolean {
	if (a === b) return true;
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const k of keys) {
		const av = (a as Record<string, unknown>)[k];
		const bv = (b as Record<string, unknown>)[k];
		if (av === bv) continue;
		if (
			av &&
			bv &&
			typeof av === 'object' &&
			typeof bv === 'object' &&
			JSON.stringify(av) === JSON.stringify(bv)
		)
			continue;
		return false;
	}
	return true;
}

function resetFilters(): void {
	if (!hasActiveFilters(filterState)) return;
	applyFilterChange(emptyFacetState());
}

function handleConfigChange(next: BandConfig): void {
	bandConfig = next;
	histogram = null;
	multiHistogramKey = null;
	sourceHistograms.clear();
	bumpPipeline();
}

function syncCompositeToUrl(c: ChannelComposite | null, presetId: string | null): void {
	if (!c) {
		updateUrlViewParams('map', null);
		return;
	}
	updateUrlViewParams('map', compositeToUrl(c, presetId));
}

function setComposite(next: ChannelComposite): void {
	composite = next;
	const matching = PRESETS.find((p) => presetMatchesComposite(p, next, cogAssets));
	activePresetId = matching?.id ?? '';
	syncCompositeToUrl(next, activePresetId || null);

	// Single-asset path: feed the existing setMosaicAssetKey machinery, then
	// mirror per-channel bandIndex into `bandConfig` so `selectCogPipeline`'s
	// RGB branch reads the user's picks. Without this mirror, the picker's
	// per-band dropdown (e.g. Hamilton 4-band NAIP COG: pick band 4 as Red)
	// updates `composite` + URL state but the rendered tiles keep using the
	// default 0/1/2 band order seeded by `defaultBandConfig()`.
	if (isSingleAssetComposite(next)) {
		setMosaicAssetKey(next.r.assetKey);
		if (bandConfig && bandConfig.mode === 'rgb') {
			if (
				bandConfig.rBand !== next.r.bandIndex ||
				bandConfig.gBand !== next.g.bandIndex ||
				bandConfig.bBand !== next.b.bandIndex
			) {
				bandConfig = {
					...bandConfig,
					rBand: next.r.bandIndex,
					gBand: next.g.bandIndex,
					bBand: next.b.bandIndex
				};
				bumpPipeline();
			}
		}
	}
}

function setPreset(id: string): void {
	const preset = PRESETS.find((p) => p.id === id);
	if (!preset) return;
	const next = applyPreset(cogAssets, preset);
	if (!next) return;
	activePresetId = id;
	// New preset = new R-channel = new data distribution. Reset the
	// "user touched the slider" flag so the next bake's p2/p98 reseeds
	// rescale, otherwise switching truecolor → vegetation keeps the
	// previous truecolor's auto-contrast on a band where it doesn't fit.
	userTouchedRescale = false;
	multiHistogramKey = null;
	setComposite(next);
}

/**
 * Swap which STAC asset feeds the mosaic. Re-derives `committedSources` and
 * `itemsRef` from the cached `StacItemView.raw` so the deck.gl layer rebuilds
 * with the new hrefs but the streaming buffer / pagination state stay intact.
 * Resets the band config + per-source histograms because the new asset may
 * have a different band count / sample format (e.g. `visual` 3-band uint8 →
 * `nir` 1-band uint16).
 */
function setMosaicAssetKey(nextKey: string): void {
	if (nextKey === mosaicAssetKey) return;
	mosaicAssetKey = nextKey;
	bandConfig = null;
	probedBandCount = false;
	histogram = null;
	multiHistogramKey = null;
	userTouchedRescale = false;
	sourceHistograms.clear();
	geotiffCache = new LruCache<string, Promise<GeoTIFF>>({ max: SOURCE_CACHE_MAX });
	presignCache = new LruCache<string, Promise<string>>({ max: SOURCE_CACHE_MAX });
	resolvedHrefByOriginal = new LruCache<string, string>({ max: SOURCE_CACHE_MAX });
	sourceHrefById = new Map();
	if (multiCogRebuildHandle !== null) {
		cancelAnimationFrame(multiCogRebuildHandle);
		multiCogRebuildHandle = null;
	}

	const remap = (
		views: ReadonlyArray<StacItemView>
	): {
		sources: MosaicSourceMeta[];
		viewsOut: StacItemView[];
	} => {
		const sources: MosaicSourceMeta[] = [];
		const viewsOut: StacItemView[] = [];
		for (const v of views) {
			const meta = buildMosaicSourceMeta(v.raw, nextKey);
			if (!meta) continue;
			sources.push(meta);
			viewsOut.push(v);
		}
		return { sources, viewsOut };
	};
	const fromBuffer = remap(itemViewsRef);
	itemsRef = fromBuffer.sources;
	itemViewsRef = fromBuffer.viewsOut;
	const fromCommitted = remap(committedViews);
	committedSources = fromCommitted.sources;
	committedViews = fromCommitted.viewsOut;
	bumpPipeline();
}

function recordSourceHistogram(
	sourceId: string,
	visibleTiles: ReadonlyArray<{ content?: unknown } | null | undefined>
): void {
	if (!visibleTiles || visibleTiles.length === 0) {
		if (sourceHistograms.delete(sourceId)) aggregateSources();
		return;
	}
	const summed = new Uint32Array(HISTOGRAM_BIN_COUNT);
	let found = false;
	for (const tile of visibleTiles) {
		const content = tile?.content as
			| { data?: CustomTileData; histogram?: Uint32Array }
			| null
			| undefined;
		const bins = content?.data?.histogram ?? content?.histogram;
		if (!bins || bins.length !== HISTOGRAM_BIN_COUNT) continue;
		for (let i = 0; i < HISTOGRAM_BIN_COUNT; i++) summed[i] += bins[i];
		found = true;
	}
	if (found) sourceHistograms.set(sourceId, summed);
	else sourceHistograms.delete(sourceId);
	aggregateSources();
}

function aggregateSources(): void {
	if (sourceHistograms.size === 0) {
		// Don't clobber a histogram baked by the multi-asset path.
		if (composite && !isSingleAssetComposite(composite) && histogram) return;
		histogram = null;
		return;
	}
	const summed = new Uint32Array(HISTOGRAM_BIN_COUNT);
	for (const bins of sourceHistograms.values()) {
		for (let i = 0; i < HISTOGRAM_BIN_COUNT; i++) summed[i] += bins[i];
	}
	histogram = summed;
}

// Multi-asset bake: pick the first committed item's R-channel COG, build a
// 64-bin histogram from its smallest overview. Keyed on `rAsset:viewId` so a
// preset swap (R asset changes) or a fresh viewport (first view rotates) fires
// a new bake. Also reseeds rescale to p2/p98 when the user has not touched the
// slider, so vegetation / SWIR composites land with auto-contrast instead of
// the previous truecolor's `{0, 0.05}` lingering on uint16 reflectance.
$effect(() => {
	const c = composite;
	const views = committedViews as StacItemView[];
	if (!c || isSingleAssetComposite(c) || views.length === 0) {
		multiHistogramKey = null;
		return;
	}
	const first = views[0];
	const itemAssets = extractCogAssets(first.raw);
	const rAsset = itemAssets.find((a) => a.key === c.r.assetKey);
	if (!rAsset) return;
	const key = `${c.r.assetKey}:${first.id}`;
	if (multiHistogramKey === key) return;
	multiHistogramKey = key;
	const signal = abortController.signal;
	void (async () => {
		try {
			const url = await presignHref(rAsset.href);
			if (signal.aborted || multiHistogramKey !== key) return;
			let promise = geotiffCache.get(rAsset.href);
			if (!promise) {
				promise = (async () => {
					const g = await loadGeoTIFF(url);
					normalizeCogGeotiff(g);
					return g;
				})();
				geotiffCache.set(rAsset.href, promise);
			}
			const geotiff = await promise;
			if (signal.aborted || multiHistogramKey !== key) return;
			const bins = await buildHistogramFromGeotiff(geotiff, signal);
			if (signal.aborted || multiHistogramKey !== key) return;
			if (bins) {
				histogram = bins;
				if (!userTouchedRescale) {
					const lo = percentileFromHistogram(bins, 0.02);
					const hi = percentileFromHistogram(bins, 0.98);
					if (lo !== null && hi !== null && hi > lo) {
						rescale = { min: lo, max: hi };
						bumpPipeline();
					}
				}
			}
		} catch (err) {
			console.warn('[StacMosaicViewer] multi-asset histogram bake failed', { key, err });
		}
	})();
});

function handleRescaleChange(next: RescaleConfig): void {
	rescale = next;
	userTouchedRescale = true;
	bumpPipeline();
}

function handleStripHover(id: string | null): void {
	if (id !== hoveredId) hoveredId = id;
}

function handleStripSelect(id: string | null): void {
	const next = selectedId === id ? null : id;
	selectedId = next;
	if (next) flyToSelected(next);
}

function cleanup(): void {
	abortController.abort();
	hydrationController.abort();
	teardownViewportReload();
	if (mapRef) removeClickHandler();
	if (mapRef && overlayRef) {
		try {
			mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
		} catch {
			/* already removed */
		}
	}
	if (mapRef) cleanupNativeBitmap(mapRef);
	mapRef = null;
	overlayRef = null;
	itemsRef = [];
	itemViewsRef = [];
	committedSources = [];
	committedViews = [];
	presignCache.clear();
	geotiffCache.clear();
	resolvedHrefByOriginal.clear();
	sourceHrefById.clear();
	sourceHistograms.clear();
	sourceErrorLogged = false;
	if (multiCogRebuildHandle !== null) {
		cancelAnimationFrame(multiCogRebuildHandle);
		multiCogRebuildHandle = null;
	}
	const maybeDestroy = pool as unknown as { destroy?: () => void; terminate?: () => void } | null;
	if (maybeDestroy?.destroy) {
		try {
			maybeDestroy.destroy();
		} catch {
			/* ignore */
		}
	} else if (maybeDestroy?.terminate) {
		try {
			maybeDestroy.terminate();
		} catch {
			/* ignore */
		}
	}
	pool = null;
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);
</script>

<div class="relative flex h-full overflow-hidden">
	<div class="flex-1">
		<MapContainer {onMapReady} {bounds} />
	</div>

	<!-- Stage / progress HUD: tells the user *what is happening* so an empty
	     map is never indistinguishable from a still-loading map. -->
	<div
		class="pointer-events-auto absolute left-1/2 top-2 z-10 flex max-w-[min(560px,calc(100%-1rem))] -translate-x-1/2 flex-col gap-1 rounded-md bg-card/90 px-2 py-1.5 text-xs text-card-foreground shadow backdrop-blur-sm"
	>
		<div class="flex items-center gap-2">
			{#if stage === 'classify'}
				<span class="size-1.5 animate-pulse rounded-full bg-amber-500"></span>
				<span class="font-medium">{t('stac.stageClassify')}</span>
			{:else if stage === 'fetch'}
				<span class="size-1.5 animate-pulse rounded-full bg-blue-500"></span>
				<span class="font-medium">{t('stac.stageFetch')}</span>
				<span class="tabular-nums text-muted-foreground">
					{stageFetched}{stageHinted != null ? ` / ${stageHinted}` : ''}
				</span>
			{:else if stage === 'index'}
				<span class="size-1.5 animate-pulse rounded-full bg-violet-500"></span>
				<span class="font-medium">{t('stac.stageIndex')}</span>
			{:else if stage === 'render'}
				<span class="size-1.5 animate-pulse rounded-full bg-cyan-500"></span>
				<span class="font-medium">{t('stac.stageRender')}</span>
			{:else if stage === 'done'}
				<span class="size-1.5 rounded-full bg-emerald-500"></span>
				<span class="font-medium">
					{sourceCount === 0
						? t('stac.stageEmpty')
						: sourceCount === 1
							? t('stac.mosaicSourcesOne', { count: sourceCount })
							: t('stac.mosaicSourcesOther', { count: sourceCount })}
				</span>
			{:else if stage === 'error'}
				<span class="size-1.5 rounded-full bg-red-500"></span>
				<span class="font-medium">{t('stac.stageError')}</span>
			{:else}
				<span class="size-1.5 rounded-full bg-zinc-400"></span>
				<span class="font-medium">{t('stac.stageIdle')}</span>
			{/if}
			<div class="ms-auto flex items-center gap-1">
				{#if isViewportMode}
					<button
						class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
						onclick={() => void reloadViewport()}
						title={t('stac.viewportMode')}
					>
						{t('stac.refresh')}
					</button>
				{/if}
				{#if sourceCount > 0}
					<button
						class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
						class:ring-1={showFootprints}
						class:ring-primary={showFootprints}
						onclick={toggleFootprints}
						title={t('stac.footprintsHint')}
					>
						{t('stac.footprints')}
					</button>
					<button
						class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
						class:ring-1={showStrip}
						class:ring-primary={showStrip}
						onclick={() => (showStrip = !showStrip)}
					>
						{t('stac.strip')}
					</button>
				{/if}
				<button
					class="relative rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
					class:ring-1={showFilters}
					class:ring-primary={showFilters}
					onclick={() => (showFilters = !showFilters)}
				>
					{t('stac.filters')}
					{#if filtersActive}
						<span
							class="absolute -end-0.5 -top-0.5 size-1.5 rounded-full bg-primary"
							title={t('stac.filtersActive')}
						></span>
					{/if}
				</button>
			</div>
		</div>
		{#if stage === 'fetch' && stageHinted}
			<div class="h-1 w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
				<div
					class="h-full bg-blue-500 transition-all"
					style="width: {Math.min(100, (stageFetched / stageHinted) * 100)}%"
				></div>
			</div>
		{:else if stage === 'classify' || stage === 'index' || stage === 'render'}
			<div class="h-1 w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
				<div class="h-full w-1/3 animate-pulse bg-zinc-400"></div>
			</div>
		{/if}
		{#if stageMessage}
			<div class="text-[10px] text-muted-foreground">{stageMessage}</div>
		{/if}
		{#if stage === 'done' && sourceCount === itemLimit}
			<div class="text-[10px] text-amber-600 dark:text-amber-400">
				{t('stac.capReached', { limit: itemLimit })}
			</div>
		{/if}
		{#if lastRefreshAt && stage === 'done'}
			<div class="text-[10px] text-muted-foreground">
				{t('stac.lastRefresh', {
					seconds: Math.max(0, Math.floor((performance.now() - lastRefreshAt) / 1000))
				})}
			</div>
		{/if}
	</div>

	{#if showFilters}
		<StacFilterPanel
			{facets}
			state={filterState}
			onChange={applyFilterChange}
			onClose={() => (showFilters = false)}
			onReset={resetFilters}
			footer={fetchOptionsSnippet}
		/>
	{/if}

	{#snippet fetchOptionsSnippet()}
		<label class="mb-1 flex items-center justify-between gap-2">
			<span class="text-muted-foreground">{t('stac.itemLimit')}</span>
			<input
				type="number"
				min="1"
				step="100"
				value={itemLimit}
				onchange={(e) => {
					const next = Number((e.target as HTMLInputElement).value);
					if (!Number.isFinite(next) || next < 1) return;
					itemLimit = Math.floor(next);
					settings.setMosaicItemLimit(itemLimit);
					if (isViewportMode) void reloadViewport();
				}}
				class="w-24 rounded border border-input bg-background px-1.5 py-0.5 text-xs tabular-nums"
			/>
		</label>
		<div class="text-[10px] text-muted-foreground">{t('stac.itemLimitHint')}</div>
		<div class="mt-2 text-[10px] text-muted-foreground">
			{kind === 'api'
				? t('stac.modeViewportApi')
				: kind === 'parquet'
					? t('stac.modeViewportParquet')
					: t('stac.modeStatic')}
		</div>
	{/snippet}

	<div class="pointer-events-none absolute left-2 top-2 z-10 flex flex-col gap-1">
		{#if error}
			<div class="pointer-events-auto max-w-sm rounded bg-red-900/80 px-2 py-1 text-xs text-red-200">
				{error}
			</div>
		{/if}
		{#if smokeWarning && !error}
			<div
				class="pointer-events-auto max-w-sm rounded bg-amber-900/80 px-2 py-1 text-xs text-amber-100"
				title={t('stac.smokeWarningHint')}
			>
				{t('stac.smokeWarning', { reason: smokeWarning })}
			</div>
		{/if}
		{#if composite && !isSingleAssetComposite(composite) && multiCogLayers.length * 3 > 300}
			<div
				class="pointer-events-auto max-w-sm rounded bg-yellow-900/80 px-2 py-1 text-xs text-yellow-200"
			>
				{t('map.multiCogMosaicHeavy')}
			</div>
		{/if}
	</div>

	{#if sourceCount > 0 && bandConfig}
		<div class="absolute right-2 top-2 z-10 flex gap-1">
			<button
				class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showControls}
				class:ring-primary={showControls}
				onclick={() => {
					showControls = !showControls;
					if (showControls) showInfo = false;
				}}
			>
				{t('cog.style')}
			</button>
			<button
				class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showInfo}
				class:ring-primary={showInfo}
				onclick={() => {
					showInfo = !showInfo;
					if (showInfo) showControls = false;
				}}
			>
				{t('map.info')}
			</button>
		</div>

		{#if showControls && composite}
			<CogControls
				assets={cogAssets}
				{composite}
				onCompositeChange={setComposite}
				presets={presetsForMosaic}
				{activePresetId}
				onPresetChange={setPreset}
				mode={bandConfig?.mode ?? 'rgb'}
				onModeChange={(m) => {
					if (bandConfig) handleConfigChange({ ...bandConfig, mode: m });
				}}
				{bandConfig}
				bandCount={detectedBandCount}
				onBandConfigChange={handleConfigChange}
				{rescale}
				rescaleApplicable={!!bandConfig}
				onRescaleChange={handleRescaleChange}
				{histogram}
				nodata={nodataConfig}
				{autoNodata}
				onNodataChange={(next) => {
					nodataConfig = next;
					bumpPipeline();
				}}
			/>
		{/if}

		{#if showInfo}
			<div
				class="absolute right-2 top-10 z-10 max-h-[70vh] w-64 overflow-auto rounded bg-card/90 p-3 text-xs text-card-foreground backdrop-blur-sm"
			>
				<h3 class="mb-2 font-medium">{t('stac.mosaicInfo')}</h3>
				<dl class="space-y-1.5">
					<dt class="text-muted-foreground">{t('stac.mosaicSourcesLabel')}</dt>
					<dd class="tabular-nums">{sourceCount}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.bands')}</dt>
					<dd>
						{detectedBandCount}{detectedDataType ? ` (${detectedDataType})` : ''}
					</dd>
					{#if bounds}
						<dt class="text-muted-foreground">{t('mapInfo.bounds')}</dt>
						<dd>
							W {bounds[0].toFixed(4)}, S {bounds[1].toFixed(4)}<br />
							E {bounds[2].toFixed(4)}, N {bounds[3].toFixed(4)}
						</dd>
					{/if}
				</dl>

				<h3 class="mb-2 mt-3 font-medium">{t('stac.explainHeading')}</h3>
				<dl class="space-y-1.5">
					<dt class="sr-only">items</dt>
					<dd class="text-muted-foreground">
						{t('stac.explainItems', {
							visible: filteredItems.length,
							total: committedSources.length
						})}
					</dd>
					<dt class="sr-only">assets</dt>
					<dd class="text-muted-foreground">
						{t('stac.explainAssets', { count: distinctAssetKeys })}
					</dd>
					<dt class="sr-only">overlap</dt>
					<dd class="text-muted-foreground">
						{t('stac.explainOverlap', { count: centerOverlapCount })}
					</dd>
					<dt class="sr-only">bytes</dt>
					<dd class="text-muted-foreground">
						{t('stac.explainBytes', {
							bytes: estimatedTileBytes != null ? formatFileSize(estimatedTileBytes) : '—'
						})}
					</dd>
					{#if timeSpan}
						<dt class="sr-only">time</dt>
						<dd class="text-muted-foreground">
							{t('stac.explainTimeSpan', { start: timeSpan.start, end: timeSpan.end })}
						</dd>
					{/if}
				</dl>
			</div>
		{/if}
	{/if}

	<PixelInspectorPanel
		lng={pixelValue?.lng ?? null}
		lat={pixelValue?.lat ?? null}
		rows={pixelValue
			? (pixelValue.values.map((v, i) => ({
					label: `${t('cog.band')} ${i + 1}`,
					value: v
				})) satisfies PixelInspectorRow[])
			: null}
		footnote={pixelValue ? `px (${pixelValue.col}, ${pixelValue.row})` : undefined}
		extraLine={pixelSourceId ?? undefined}
		onClose={() => {
			pixelValue = null;
			pixelSourceId = null;
		}}
		{inspecting}
	/>

	{#if showStrip && sourceCount > 0}
		<div
			class="pointer-events-none absolute inset-x-2 bottom-12 z-10 flex flex-col gap-2"
		>
			<StacDatetimeBar
				facet={facets.datetime}
				state={filterState}
				onChange={applyFilterChange}
			/>
			<StacItemStrip
				views={filteredViews}
				{hoveredId}
				{selectedId}
				presign={presignHref}
				onHover={handleStripHover}
				onSelect={handleStripSelect}
			/>
		</div>
	{/if}

	{#if selectedView}
		<StacItemInspector
			view={selectedView}
			presign={presignHref}
			onClose={() => {
				selectedId = null;
			}}
			onFlyTo={() => {
				if (selectedId) flyToSelected(selectedId);
			}}
		/>
	{/if}
</div>
