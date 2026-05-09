<script lang="ts">
import CodeIcon from '@lucide/svelte/icons/file-code';
import GlobeIcon from '@lucide/svelte/icons/globe';
import LayersIcon from '@lucide/svelte/icons/layers';
import MapIcon from '@lucide/svelte/icons/map';
import { t } from '../../i18n/index.svelte.js';
import { connectionStore } from '../../stores/connections.svelte.js';
import type { Tab } from '../../types.js';
import type { StacRoutableKind } from '../../utils/stac.js';
import { canStreamDirectly } from '../../utils/url.js';
import { getUrlView, pickViewMode, updateUrlView } from '../../utils/url-state.js';
import { Badge } from '../ui/badge/index.js';
import { Button } from '../ui/button/index.js';
import * as Tooltip from '../ui/tooltip/index.js';
import CodeViewer from './CodeViewer.svelte';
import StacMapViewer from './StacMapViewer.svelte';
import TableViewer from './TableViewer.svelte';

type MapKind = 'mosaic' | 'multicog' | null;

interface Props {
	tab: Tab;
	/** Which map viewer to mount when the user switches to `#map`. */
	mapKind: MapKind;
	/** Pre-classified STAC payload, forwarded to map viewers to skip re-parsing. */
	classified?: StacRoutableKind;
}

let { tab, mapKind, classified }: Props = $props();

// 'code' is the URL token for raw-content view on JSON tabs; 'table' is the
// equivalent token on stac-geoparquet tabs. Both render the nested viewer
// (CodeViewer for JSON, TableViewer for parquet) but the URL stays
// semantically meaningful per filetype.
type ViewMode = 'map' | 'stac-map' | 'stac-browser' | 'code' | 'table';

interface CodeActions {
	toggleFormat: () => Promise<void>;
	copyCode: () => Promise<void>;
	canFormat: boolean;
	formatted: boolean;
	copied: boolean;
}

// Cross-origin STAC iframes (Radiant Earth stac-browser, DevSeed stac-map)
// crawl sibling items with their own fetch client and have no access to our
// presigned URLs. On signed-s3 connections the top manifest still renders but
// every child link 403s — keep the buttons available and surface a warning
// tooltip so the user can still preview the root document and knows why
// crawling children fails.
const iframeCrawlReachable = $derived.by(() => {
	if (tab.source === 'url') return true;
	if (!tab.connectionId) return true;
	const conn = connectionStore.getById(tab.connectionId);
	if (!conn) return true;
	return canStreamDirectly(tab);
});

const isParquet = $derived.by(() => {
	const ext = (tab.extension ?? '').toLowerCase();
	return ext === 'parquet' || ext === 'geoparquet';
});

const formatBadge = $derived(isParquet ? 'Parquet' : 'JSON');

const stacBadgeKey = $derived.by(() => {
	if (isParquet) return 'code.stacGeoparquet';
	const kind = classified?.kind;
	if (kind === 'item') return 'code.stacItem';
	if (kind === 'item-collection') return 'code.stacItem';
	if (kind === 'collection') return 'code.stacCollection';
	if (kind === 'catalog') return 'code.stacCatalog';
	return null;
});

function initialView(): ViewMode {
	// `'map'` is conditional on `mapKind`, so it's not in the static vocabulary.
	// Both `'code'` and `'table'` are accepted regardless of filetype so a URL
	// shared from one type still resolves; the render branch dispatches to the
	// appropriate inner viewer (`TableViewer` / `CodeViewer`).
	const picked = pickViewMode<ViewMode>(['stac-map', 'stac-browser', 'code', 'table'], 'stac-map');
	const urlView = getUrlView();
	if (urlView === 'map' && mapKind) return 'map';
	// Hash was unknown or empty: prefer the rich map view when available.
	if (mapKind && !urlView) return 'map';
	return picked;
}

let viewMode = $state<ViewMode>(initialView());
let wordWrap = $state(false);
let codeActions = $state<CodeActions | null>(null);

function setView(next: ViewMode) {
	if (viewMode === next) return;
	viewMode = next;
	updateUrlView(next);
}

// The "Table" / "JSON" button in the navbar writes a filetype-aware token so
// the URL stays semantically meaningful (parquet → `#table`, json → `#code`).
const rawContentMode: ViewMode = $derived(isParquet ? 'table' : 'code');
</script>

<Tooltip.Provider>
<div class="flex h-full flex-col overflow-hidden">
	{#key tab.id}
		<div
			class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
		>
			<span
				class="max-w-[120px] truncate text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300"
			>
				{tab.name}
			</span>
			<Badge variant="secondary">{formatBadge}</Badge>
			{#if stacBadgeKey}
				<Badge
					variant="outline"
					class="hidden border-emerald-200 text-emerald-600 sm:inline-flex dark:border-emerald-800 dark:text-emerald-300"
				>
					{t(stacBadgeKey)}
				</Badge>
			{/if}

			<div class="ms-auto flex items-center gap-1 sm:gap-2">
				{#if mapKind}
					<Button
						size="sm"
						variant={viewMode === 'map' ? 'default' : 'ghost'}
						class="h-7 gap-1 px-2"
						onclick={() => setView('map')}
					>
						<MapIcon class="size-3.5" />
						{mapKind === 'multicog' ? t('stac.viewMultiCog') : t('stac.viewMosaic')}
					</Button>
				{/if}
				{#if iframeCrawlReachable}
					<Button
						size="sm"
						variant={viewMode === 'stac-map' ? 'default' : 'ghost'}
						class="h-7 gap-1 px-2"
						onclick={() => setView('stac-map')}
					>
						<LayersIcon class="size-3.5" />
						{t('stac.viewStacMap')}
					</Button>
					{#if isParquet}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<Button
									size="sm"
									variant="ghost"
									class="h-7 gap-1 px-2 opacity-50"
									disabled
								>
									<GlobeIcon class="size-3.5" />
									{t('stac.viewBrowser')}
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>{t('stac.stacBrowserJsonOnly')}</Tooltip.Content>
						</Tooltip.Root>
					{:else}
						<Button
							size="sm"
							variant={viewMode === 'stac-browser' ? 'default' : 'ghost'}
							class="h-7 gap-1 px-2"
							onclick={() => setView('stac-browser')}
						>
							<GlobeIcon class="size-3.5" />
							{t('stac.viewBrowser')}
						</Button>
					{/if}
				{:else}
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								size="sm"
								variant={viewMode === 'stac-map' ? 'default' : 'ghost'}
								class="h-7 gap-1 px-2"
								onclick={() => setView('stac-map')}
							>
								<LayersIcon class="size-3.5" />
								{t('stac.viewStacMap')}
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t('stac.iframePrivateBucketWarning')}</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								size="sm"
								variant={viewMode === 'stac-browser' ? 'default' : 'ghost'}
								class="h-7 gap-1 px-2"
								onclick={() => setView('stac-browser')}
							>
								<GlobeIcon class="size-3.5" />
								{t('stac.viewBrowser')}
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t('stac.iframePrivateBucketWarning')}</Tooltip.Content>
					</Tooltip.Root>
				{/if}
				<Button
					size="sm"
					variant={viewMode === rawContentMode ? 'default' : 'ghost'}
					class="h-7 gap-1 px-2"
					onclick={() => setView(rawContentMode)}
				>
					<CodeIcon class="size-3.5" />
					{isParquet ? t('stac.viewTable') : t('stac.viewJson')}
				</Button>

				{#if viewMode === 'code' && !isParquet && codeActions}
					{#if codeActions.canFormat}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 px-2 text-xs"
							onclick={() => codeActions?.toggleFormat()}
						>
							{codeActions.formatted ? t('code.raw') : t('code.format')}
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 px-2 text-xs"
						onclick={() => (wordWrap = !wordWrap)}
					>
						{wordWrap ? t('code.noWrap') : t('code.wrap')}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="h-7 px-2 text-xs"
						onclick={() => codeActions?.copyCode()}
					>
						{codeActions.copied ? t('code.copied') : t('code.copy')}
					</Button>
				{/if}
			</div>
		</div>

		<div class="relative flex-1 overflow-hidden">
			{#if viewMode === 'map' && mapKind === 'mosaic'}
				{#await import('./StacMosaicViewer.svelte') then { default: StacMosaicViewer }}
					<StacMosaicViewer {tab} {classified} />
				{/await}
			{:else if viewMode === 'map' && mapKind === 'multicog'}
				{#await import('./MultiCogViewer.svelte') then { default: MultiCogViewer }}
					<MultiCogViewer {tab} {classified} />
				{/await}
			{:else if viewMode === 'stac-map'}
				<StacMapViewer {tab} variant="stac-map" />
			{:else if viewMode === 'stac-browser'}
				<StacMapViewer {tab} variant="stac-browser" />
			{:else if isParquet}
				<TableViewer {tab} nested />
			{:else}
				<CodeViewer {tab} nested bind:wordWrap bind:actions={codeActions} />
			{/if}
		</div>
	{/key}
</div>
</Tooltip.Provider>
