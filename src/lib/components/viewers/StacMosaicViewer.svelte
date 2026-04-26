<script lang="ts">
import { GeoJsonLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { COGLayer, MosaicLayer } from '@developmentseed/deck.gl-geotiff';
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
import { resolveCloudUrl } from '../../utils/cloud-url.js';
import {
	type BandConfig,
	buildDataTypeLabel,
	type CustomTileData,
	clampBounds,
	cleanupNativeBitmap,
	createEpsgResolver,
	DEFAULT_RESCALE,
	defaultBandConfig,
	fitCogBounds,
	HISTOGRAM_BIN_COUNT,
	normalizeCogGeotiff,
	type PixelValue,
	type RescaleConfig,
	readPixelAtLngLat,
	resolveProj4Def,
	selectCogPipeline
} from '../../utils/cog.js';
import { isAbortError } from '../../utils/error.js';
import { LruCache } from '../../utils/lru.js';
import {
	buildMosaicSourceMeta,
	classifyStac,
	type MosaicSourceMeta,
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
import { buildHttpsUrlAsync } from '../../utils/url.js';
import CogControls from './CogControls.svelte';
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

// ─── Pixel inspection ──────────────────────────────────────────────
let pixelValue = $state<PixelValue | null>(null);
let pixelSourceId = $state<string | null>(null);
let inspecting = $state(false);
let clickHandlerRef: ((e: maplibregl.MapMouseEvent) => void) | null = null;

// ─── Caches ────────────────────────────────────────────────────────
// Bounded so panning does not grow memory forever. Eviction is wired to
// `MosaicLayer.onTileUnload` so the working set tracks deck.gl's own tile
// cache; cap matches `MosaicLayer.maxCacheSize` for symmetric eviction.
const SOURCE_CACHE_MAX = 64;
let geotiffCache = new LruCache<string, Promise<GeoTIFF>>({ max: SOURCE_CACHE_MAX });
let presignCache = new LruCache<string, Promise<string>>({ max: SOURCE_CACHE_MAX });
let sourceHrefById = new Map<string, string>();
// Per-source visible-tile histograms, summed across sources in `aggregate`.
let sourceHistograms = new Map<string, Uint32Array>();

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
const filteredItems = $derived.by(() => {
	if (!hasActiveFilters(filterState)) return committedSources;
	const allowed = new Set(filteredViews.map((v) => v.id));
	return committedSources.filter((it) => allowed.has(it.id));
});
const filtersActive = $derived(hasActiveFilters(filterState));
const sourceCount = $derived(committedSources.length);

// ─── Stage HUD ─────────────────────────────────────────────────────
type Stage = 'idle' | 'classify' | 'fetch' | 'index' | 'render' | 'done' | 'error';
let stage = $state<Stage>('idle');
let stageFetched = $state(0);
let stageHinted = $state<number | null>(null);
let lastRefreshAt = $state<number | null>(null);
let stageMessage = $state<string | null>(null);
let showFilters = $state(false);

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
const mosaicId = $derived(`mosaic-${hashSources(filteredItems)}-p${pipelineGen}`);
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
		maxCacheSize: SOURCE_CACHE_MAX,
		onTileUnload: (tile: { index?: { id?: string } } | undefined) => {
			const sid = tile?.index?.id;
			if (typeof sid !== 'string') return;
			geotiffCache.delete(sid);
			const href = sourceHrefById.get(sid);
			if (href) {
				presignCache.delete(href);
				sourceHrefById.delete(sid);
			}
			if (sourceHistograms.delete(sid)) aggregateSources();
		},
		getSource: async (source: MosaicSourceMeta, opts: { signal?: AbortSignal }) => {
			const cached = geotiffCache.get(source.id);
			if (cached) return cached.catch(() => undefined as unknown as GeoTIFF);
			const promise = (async () => {
				const url = await presignHref(source.href);
				const geotiff = await GeoTIFF.fromUrl(url);
				normalizeCogGeotiff(geotiff);
				return geotiff;
			})();
			geotiffCache.set(source.id, promise);
			sourceHrefById.set(source.id, source.href);
			let geotiff: GeoTIFF;
			try {
				geotiff = await promise;
			} catch {
				// Swallow per-source fetch/decode failures so deck.gl's TileLayer
				// gets `data: undefined` (renderSource returns null for it) instead
				// of a rejected promise, which surfaces as "v is null" during the
				// TileLayer update when a mosaic covers hundreds of unreachable
				// sources (e.g. a 302k-item global catalog).
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
				bandConfig = defaultBandConfig(count, sf);
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
					console.error(err);
				}
			};
			return new COGLayer(cogProps);
		}
	};
	return new MosaicLayer<MosaicSourceMeta, GeoTIFF>(mosaicProps);
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
	if (mosaicLayer) out.push(mosaicLayer);
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
		if (mapRef) void loadMosaic(mapRef);
	});
});

function resetViewer(): void {
	abortController.abort();
	abortController = new AbortController();
	hydrationController.abort();
	hydrationController = new AbortController();
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
	pipelineGen = 0;
	hoveredId = null;
	selectedId = null;
	filterState = emptyFacetState();
	presignCache = new LruCache<string, Promise<string>>({ max: SOURCE_CACHE_MAX });
	geotiffCache = new LruCache<string, Promise<GeoTIFF>>({ max: SOURCE_CACHE_MAX });
	sourceHrefById = new Map();
	sourceHistograms = new Map();
	loading = true;
	error = null;
	bounds = undefined;
	bandConfig = null;
	histogram = null;
	rescale = { ...DEFAULT_RESCALE };
	hasFittedOnce = false;
	showControls = false;
	showInfo = false;
	detectedBandCount = 3;
	detectedDataType = '';
	probedBandCount = false;
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
	if (mapRef && clickHandlerRef) {
		mapRef.off('click', clickHandlerRef);
		clickHandlerRef = null;
	}
}

function setupClickHandler(map: maplibregl.Map): void {
	removeClickHandler();
	clickHandlerRef = async (e: maplibregl.MapMouseEvent) => {
		const lng = e.lngLat.lng;
		const lat = e.lngLat.lat;
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
		if (!hit) {
			pixelValue = null;
			pixelSourceId = null;
			return;
		}
		inspecting = true;
		try {
			let geotiffPromise = geotiffCache.get(hit.id);
			if (!geotiffPromise) {
				geotiffPromise = (async () => {
					const url = await presignHref(hit.href);
					const g = await GeoTIFF.fromUrl(url);
					normalizeCogGeotiff(g);
					return g;
				})();
				geotiffCache.set(hit.id, geotiffPromise);
				sourceHrefById.set(hit.id, hit.href);
			}
			const geotiff = await geotiffPromise;
			const proj4Def = await resolveProj4Def(geotiff.crs, abortController.signal);
			const result = await readPixelAtLngLat(
				geotiff,
				lng,
				lat,
				proj4Def,
				pool,
				abortController.signal
			);
			pixelValue = result;
			pixelSourceId = hit.id;
		} catch {
			pixelValue = null;
			pixelSourceId = null;
		} finally {
			inspecting = false;
		}
	};
	map.on('click', clickHandlerRef);
}

function onMapReady(map: maplibregl.Map): void {
	mapRef = map;
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
	void loadMosaic(map);
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
	hydrationController = new AbortController();
	error = null;
	loading = true;
	hasFittedOnce = true;
	await loadMosaic(mapRef);
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

function presignHref(href: string): Promise<string> {
	let cached = presignCache.get(href);
	if (!cached) {
		const normalized = resolveCloudUrl(href);
		if (/^https?:\/\//i.test(normalized)) {
			const key = extractConnectionKey(normalized);
			if (key !== null) {
				cached = buildHttpsUrlAsync({ ...tab, path: key } as Tab).catch(() => normalized);
			} else {
				cached = Promise.resolve(normalized);
			}
		} else {
			cached = buildHttpsUrlAsync({ ...tab, path: normalized } as Tab).catch(() => normalized);
		}
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

			const accepted: MosaicSourceMeta[] = [];
			const acceptedViews: StacItemView[] = [];
			for (const item of residualFilteredItems) {
				const normalized = buildMosaicSourceMeta(item);
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
			} else {
				// Static + parquet: append in catalog order. Static streams
				// slowly enough that per-batch commits are cheap; parquet
				// emits a single batch.
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
	sourceHistograms.clear();
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
		histogram = null;
		return;
	}
	const summed = new Uint32Array(HISTOGRAM_BIN_COUNT);
	for (const bins of sourceHistograms.values()) {
		for (let i = 0; i < HISTOGRAM_BIN_COUNT; i++) summed[i] += bins[i];
	}
	histogram = summed;
}

function handleRescaleChange(next: RescaleConfig): void {
	rescale = next;
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
	sourceHrefById.clear();
	sourceHistograms.clear();
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

		{#if showControls}
			<CogControls
				bandCount={detectedBandCount}
				{bandConfig}
				onConfigChange={handleConfigChange}
				{rescale}
				rescaleApplicable={bandConfig?.mode === 'single'}
				onRescaleChange={handleRescaleChange}
				{histogram}
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
			</div>
		{/if}
	{/if}

	{#if pixelValue}
		<div
			class="absolute bottom-2 left-2 z-10 rounded bg-card/90 p-2.5 text-xs text-card-foreground backdrop-blur-sm"
		>
			<div class="mb-1 flex items-center justify-between gap-3">
				<span class="font-medium">{t('cog.pixelValue')}</span>
				<button
					class="text-muted-foreground hover:text-card-foreground"
					onclick={() => {
						pixelValue = null;
						pixelSourceId = null;
					}}
				>
					&times;
				</button>
			</div>
			<div class="space-y-0.5 text-muted-foreground">
				<div>{pixelValue.lat.toFixed(6)}&deg;, {pixelValue.lng.toFixed(6)}&deg;</div>
				<div class="text-[10px]">px ({pixelValue.col}, {pixelValue.row})</div>
				{#if pixelSourceId}
					<div class="truncate text-[10px]" title={pixelSourceId}>{pixelSourceId}</div>
				{/if}
			</div>
			<div class="mt-1.5 space-y-0.5">
				{#each pixelValue.values as val, i}
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">{t('cog.band')} {i + 1}</span>
						<span class="font-mono tabular-nums">
							{Number.isInteger(val) ? val : val.toFixed(4)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if inspecting}
		<div
			class="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
		>
			{t('cog.reading')}
		</div>
	{/if}

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
