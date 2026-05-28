<script lang="ts">
import ArchiveIcon from '@lucide/svelte/icons/archive';
import GridIcon from '@lucide/svelte/icons/grid-3x3';
import MapIcon from '@lucide/svelte/icons/map';
import { handleLoadError } from '@walkthru-earth/objex-utils';
import type { PMTiles } from 'pmtiles';
import { onDestroy, untrack } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { Separator } from '$lib/components/ui/separator/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { loadPmtiles, type PmtilesMetadata } from '$lib/utils/pmtiles';
import { buildHttpsUrlAsync } from '$lib/utils/signed-url.js';
import { pickViewMode, updateUrlView } from '$lib/utils/url-state.js';

let { tab }: { tab: Tab } = $props();

type ViewMode = 'map' | 'archive' | 'inspector';

let loading = $state(true);
let error = $state<string | null>(null);
let metadata = $state<PmtilesMetadata | null>(null);
let pmtilesInstance = $state<PMTiles | null>(null);
let pmtilesUrl = $state('');

// Read initial view from URL hash
let viewMode = $state<ViewMode>(pickViewMode<ViewMode>(['map', 'archive', 'inspector'], 'map'));

// Tile inspector initial coordinates (set when navigating from archive)
let inspectorZ = $state<number | undefined>();
let inspectorX = $state<number | undefined>();
let inspectorY = $state<number | undefined>();

function setViewMode(mode: ViewMode) {
	viewMode = mode;
	updateUrlView(mode);
}

function openInInspector(z: number, x: number, y: number) {
	inspectorZ = z;
	inspectorX = x;
	inspectorY = y;
	setViewMode('inspector');
}

function cleanup() {
	pmtilesInstance = null;
	metadata = null;
	pmtilesUrl = '';
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		load();
	});
});

async function load() {
	loading = true;
	error = null;

	try {
		pmtilesUrl = await buildHttpsUrlAsync(tab);
		const result = await loadPmtiles(pmtilesUrl);
		pmtilesInstance = result.pmtiles;
		metadata = result.metadata;
	} catch (err) {
		error = handleLoadError(err);
	} finally {
		loading = false;
	}
}

const fileName = $derived(tab.path.split('/').pop() ?? 'pmtiles');
</script>

<div class="flex h-full flex-col">
	<!-- Toolbar -->
	{#if !loading && !error && metadata}
		<div
			class="flex items-center gap-1 border-b border-border px-2 py-1.5 sm:gap-2 sm:px-4"
		>
			<!-- File info -->
			<span
				class="max-w-[100px] truncate text-sm font-medium text-foreground sm:max-w-none"
			>
				{fileName}
			</span>
			<Badge variant="outline" class="hidden text-[10px] sm:inline-flex">
				{metadata.formatLabel}
			</Badge>
			<span class="hidden text-xs text-muted-foreground sm:inline">
				z{metadata.minZoom}-{metadata.maxZoom} · {metadata.numAddressedTiles.toLocaleString()} tiles
			</span>

			<!-- View mode buttons -->
			<div class="ms-auto flex items-center gap-1">
				<Button
					variant={viewMode === 'map' ? 'default' : 'outline'}
					size="sm"
					class="h-7 gap-1 px-2 text-xs {viewMode !== 'map'
						? 'border-border text-muted-foreground hover:bg-muted'
						: ''}"
					onclick={() => setViewMode('map')}
				>
					<MapIcon class="size-3" />
					<span class="hidden sm:inline">{t('pmtiles.mapView')}</span>
				</Button>

				<Button
					variant={viewMode === 'archive' ? 'default' : 'outline'}
					size="sm"
					class="h-7 gap-1 px-2 text-xs {viewMode !== 'archive'
						? 'border-border text-muted-foreground hover:bg-muted'
						: ''}"
					onclick={() => setViewMode('archive')}
				>
					<ArchiveIcon class="size-3" />
					<span class="hidden sm:inline">{t('pmtiles.archiveView')}</span>
				</Button>

				<Button
					variant={viewMode === 'inspector' ? 'default' : 'outline'}
					size="sm"
					class="h-7 gap-1 px-2 text-xs {viewMode !== 'inspector'
						? 'border-border text-muted-foreground hover:bg-muted'
						: ''}"
					onclick={() => setViewMode('inspector')}
				>
					<GridIcon class="size-3" />
					<span class="hidden sm:inline">{t('pmtiles.inspectorView')}</span>
				</Button>
			</div>
		</div>
	{/if}

	<!-- Content area -->
	<div class="min-h-0 flex-1 overflow-hidden">
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-muted-foreground">{t('map.loadingPmtiles')}</p>
			</div>
		{:else if error}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-destructive">{error}</p>
			</div>
		{:else if metadata && pmtilesInstance}
			{#if viewMode === 'map'}
				{#await import('./pmtiles/PmtilesMapView.svelte') then mod}
					<mod.default
						{tab}
						{metadata}
						{pmtilesUrl}
						onOpenInspector={openInInspector}
					/>
				{/await}
			{:else if viewMode === 'archive'}
				{#await import('./pmtiles/PmtilesArchiveView.svelte') then mod}
					<mod.default
						{metadata}
						pmtiles={pmtilesInstance}
						onOpenInspector={openInInspector}
					/>
				{/await}
			{:else if viewMode === 'inspector'}
				{#await import('./pmtiles/PmtilesTileInspector.svelte') then mod}
					<mod.default
						{metadata}
						pmtiles={pmtilesInstance}
						initialZ={inspectorZ}
						initialX={inspectorX}
						initialY={inspectorY}
					/>
				{/await}
			{/if}
		{/if}
	</div>
</div>
