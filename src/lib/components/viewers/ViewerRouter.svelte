<script lang="ts">
import { getViewerKind } from '../../file-icons/index.js';
import { getAdapter } from '../../storage/index.js';
import type { Tab } from '../../types.js';
import { readParquetMetadata } from '../../utils/parquet-metadata.js';
import {
	classifyStac,
	detectMosaicCapable,
	detectMultiCogCapable,
	type StacRoutableKind
} from '../../utils/stac.js';
import { isStacGeoparquetSchema } from '../../utils/stac-geoparquet.js';
import { STAC_API_PATH_RE } from '../../utils/storage-url.js';
import { buildHttpsUrlAsync } from '../../utils/url.js';
import CodeViewer from './CodeViewer.svelte';
import ImageViewer from './ImageViewer.svelte';
import MediaViewer from './MediaViewer.svelte';
import RawViewer from './RawViewer.svelte';
import StacTabViewer from './StacTabViewer.svelte';
import TableViewer from './TableViewer.svelte';

let { tab }: { tab: Tab } = $props();

const ext = $derived(tab?.extension ?? '');
const viewerKind = $derived(getViewerKind(ext));

type StacRoute =
	| { kind: 'pending' }
	| { kind: 'none' }
	| { kind: 'stac'; mapKind: 'mosaic' | 'multicog' | null; classified: StacRoutableKind };
const MAX_STAC_PEEK = 256 * 1024;

let stacRoute = $state<StacRoute>({ kind: 'none' });
let stacSignalCtrl: AbortController | null = null;

$effect(() => {
	// Track the full tab identity so auto-migration (eager `url` tab → remote
	// tab with a real connectionId) re-runs classification with the now-valid
	// adapter. Without these reads the effect only depends on `ext`, and a
	// stale 403 would leave the file stuck on the non-STAC CodeViewer path.
	const tabId = tab.id;
	const tabPath = tab.path;
	const tabSource = tab.source;
	const tabConn = tab.connectionId;
	void tabId;
	void tabPath;
	void tabSource;
	void tabConn;

	const currentExt = ext.toLowerCase().replace(/^\./, '');
	const isJsonExt = currentExt === 'json' || currentExt === 'geojson';
	// STAC API endpoints return `application/geo+json` at extensionless paths
	// like `/v1/collections/.../items/S2B_18TVK_20240928_0_L2A`, so we still
	// peek when the basename has no dot.
	const isExtensionless = !currentExt;
	const viewerEligible = viewerKind === 'code' || viewerKind === 'raw';
	let isStacPath = false;
	if (isExtensionless) {
		try {
			isStacPath = STAC_API_PATH_RE.test(new URL(tab.path).pathname);
		} catch {
			isStacPath = false;
		}
	}
	const isParquetExt = currentExt === 'parquet' || currentExt === 'geoparquet';
	const shouldPeek = viewerEligible && (isJsonExt || (isExtensionless && isStacPath));
	stacSignalCtrl?.abort();
	if (!shouldPeek && !isParquetExt) {
		stacRoute = { kind: 'none' };
		return;
	}
	stacRoute = { kind: 'pending' };
	const ctrl = new AbortController();
	stacSignalCtrl = ctrl;
	const detector = isParquetExt
		? detectStacGeoparquet(tab, ctrl.signal)
		: detectStac(tab, ctrl.signal);
	void detector.then((result) => {
		if (ctrl.signal.aborted) return;
		stacRoute = result;
	});
	return () => ctrl.abort();
});

async function detectStacGeoparquet(current: Tab, signal: AbortSignal): Promise<StacRoute> {
	try {
		const url = await buildHttpsUrlAsync(current);
		if (signal.aborted) return { kind: 'none' };
		const meta = await readParquetMetadata(url);
		if (signal.aborted) return { kind: 'none' };
		// Use top-level column names so struct parents (`assets`, `bbox`) are
		// visible. `meta.schema` flattens structs away, which hides the very
		// columns stac-geoparquet detection keys on.
		const topLevel = meta.topLevelColumns.map((name) => ({ name }));
		if (!isStacGeoparquetSchema(topLevel)) return { kind: 'none' };
		return {
			kind: 'stac',
			mapKind: 'mosaic',
			classified: { kind: 'item-collection', fc: { type: 'FeatureCollection', features: [] } }
		};
	} catch {
		return { kind: 'none' };
	}
}

async function detectStac(current: Tab, signal: AbortSignal): Promise<StacRoute> {
	const adapter = getAdapter(current.source, current.connectionId);
	const decoder = new TextDecoder('utf-8', { fatal: false });

	// Peek the first 256 KB first; a small catalog/collection parses outright.
	// STAC Items with detailed asset metadata + dense footprint coordinates
	// frequently blow past that, so on a parse failure we fall back to the
	// full file. Network errors (403, CORS) short-circuit to `none`.
	// `classifyStac` already returns `{ kind: 'none' }` for any JSON that
	// isn't a STAC Item/Collection/Catalog/ItemCollection — propagate that
	// so plain JSON files don't route through StacTabViewer (which exposes
	// the stac-map / STAC Browser buttons).
	try {
		const peek = await adapter.read(current.path, 0, MAX_STAC_PEEK, signal);
		if (signal.aborted) return { kind: 'none' };
		try {
			const parsed = JSON.parse(decoder.decode(peek));
			const classified = classifyStac(parsed);
			if (classified.kind === 'none') return { kind: 'none' };
			return { kind: 'stac', mapKind: pickMapKind(classified), classified };
		} catch {
			if (peek.byteLength < MAX_STAC_PEEK) return { kind: 'none' };
		}
	} catch {
		return { kind: 'none' };
	}

	try {
		const full = await adapter.read(current.path, undefined, undefined, signal);
		if (signal.aborted) return { kind: 'none' };
		const parsed = JSON.parse(decoder.decode(full));
		const classified = classifyStac(parsed);
		if (classified.kind === 'none') return { kind: 'none' };
		return { kind: 'stac', mapKind: pickMapKind(classified), classified };
	} catch {
		return { kind: 'none' };
	}
}

function pickMapKind(classified: StacRoutableKind): 'mosaic' | 'multicog' | null {
	switch (classified.kind) {
		case 'item':
			if (detectMultiCogCapable(classified.item)) return 'multicog';
			if (detectMosaicCapable(classified.item)) return 'mosaic';
			return null;
		case 'item-collection': {
			const first = classified.fc.features[0];
			if (first && detectMultiCogCapable(first)) return 'multicog';
			return 'mosaic';
		}
		case 'collection':
		case 'catalog':
			return 'mosaic';
		case 'none':
			return null;
	}
}
</script>

{#if stacRoute.kind === 'stac' && viewerKind === 'table'}
	<StacTabViewer {tab} mapKind={stacRoute.mapKind} classified={stacRoute.classified} />
{:else if stacRoute.kind === 'pending' && (viewerKind === 'table' || viewerKind === 'code' || viewerKind === 'raw')}
	<!-- STAC detection (sniff parquet schema or peek 256KB JSON) is in flight.
	     Mounting TableViewer / CodeViewer here would let them read the URL hash,
	     pick a default viewMode, and potentially write back over an explicit
	     hash that StacTabViewer would otherwise own (e.g. `#map` on a STAC
	     collection JSON). The pending window is short — render an empty pane
	     until detection resolves and the right viewer takes over. -->
	<div class="h-full"></div>
{:else if viewerKind === 'table'}
	<TableViewer {tab} />
{:else if viewerKind === 'image'}
	<ImageViewer {tab} />
{:else if viewerKind === 'video' || viewerKind === 'audio'}
	<MediaViewer {tab} />
{:else if viewerKind === 'markdown'}
	{#await import('./MarkdownViewer.svelte') then { default: MarkdownViewer }}
		<MarkdownViewer {tab} />
	{/await}
{:else if stacRoute.kind === 'stac' && (viewerKind === 'code' || viewerKind === 'raw')}
	<StacTabViewer {tab} mapKind={stacRoute.mapKind} classified={stacRoute.classified} />
{:else if viewerKind === 'code'}
	<CodeViewer {tab} />
{:else if viewerKind === 'cog'}
	{#await import('./CogViewer.svelte') then { default: CogViewer }}
		<CogViewer {tab} />
	{/await}
{:else if viewerKind === 'pmtiles'}
	{#await import('./PmtilesViewer.svelte') then { default: PmtilesViewer }}
		<PmtilesViewer {tab} />
	{/await}
{:else if viewerKind === 'flatgeobuf'}
	{#await import('./FlatGeobufViewer.svelte') then { default: FlatGeobufViewer }}
		<FlatGeobufViewer {tab} />
	{/await}
{:else if viewerKind === 'pdf'}
	{#await import('./PdfViewer.svelte') then { default: PdfViewer }}
		<PdfViewer {tab} />
	{/await}
{:else if viewerKind === '3d'}
	{#await import('./ModelViewer.svelte') then { default: ModelViewer }}
		<ModelViewer {tab} />
	{/await}
{:else if viewerKind === 'archive'}
	{#await import('./ArchiveViewer.svelte') then { default: ArchiveViewer }}
		<ArchiveViewer {tab} />
	{/await}
{:else if viewerKind === 'database'}
	{#await import('./DatabaseViewer.svelte') then { default: DatabaseViewer }}
		<DatabaseViewer {tab} />
	{/await}
{:else if viewerKind === 'zarr'}
	{#await import('./ZarrViewer.svelte') then { default: ZarrViewer }}
		<ZarrViewer {tab} />
	{/await}
{:else if viewerKind === 'copc'}
	{#await import('./CopcViewer.svelte') then { default: CopcViewer }}
		<CopcViewer {tab} />
	{/await}
{:else if viewerKind === 'notebook'}
	{#await import('./NotebookViewer.svelte') then { default: NotebookViewer }}
		<NotebookViewer {tab} />
	{/await}
{:else}
	<RawViewer {tab} />
{/if}
