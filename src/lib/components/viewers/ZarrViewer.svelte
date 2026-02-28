<script lang="ts">
import { untrack } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import {
	ResizableHandle,
	ResizablePane,
	ResizablePaneGroup
} from '$lib/components/ui/resizable/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl } from '$lib/utils/url.js';
import { getUrlView, updateUrlView } from '$lib/utils/url-state.js';
import {
	extractZarrStoreUrl,
	fetchConsolidated,
	formatShape,
	probeWithZarrita,
	type VarMeta,
	type ZarrMetadata
} from '$lib/utils/zarr.js';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
const urlView = getUrlView();
let viewMode = $state<'inspect' | 'map'>(urlView === 'map' ? 'map' : 'inspect');

let storeAttrs = $state<Record<string, any>>({});
let variables = $state<VarMeta[]>([]);
let coordVars = $state<VarMeta[]>([]);
let spatialRefAttrs = $state<Record<string, any> | null>(null);
let selectedNode = $state<VarMeta | null>(null);
let zarrVersion = $state<number | null>(null);

const mapVars = $derived(variables.filter((v) => v.shape.length >= 2));
const hasMapVars = $derived(mapVars.length > 0);

// Reset view mode when tab changes (component reuse across zarr-type tabs)
let prevTabId = '';
$effect(() => {
	const id = tab.id;
	if (prevTabId && prevTabId !== id) {
		viewMode = 'inspect';
		updateUrlView('');
	}
	prevTabId = id;
});

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loadZarrMetadata();
	});
});

function setViewMode(mode: 'inspect' | 'map') {
	viewMode = mode;
	updateUrlView(viewMode);
}

async function loadZarrMetadata() {
	loading = true;
	error = null;

	try {
		const rawUrl = buildHttpsUrl(tab).replace(/\/+$/, '');
		const url = extractZarrStoreUrl(rawUrl) ?? rawUrl;

		let meta: ZarrMetadata | null = await fetchConsolidated(url);

		if (!meta) {
			meta = await probeWithZarrita(url, tab.name.replace(/\.(zarr|zr3)$/, ''));
		}

		if (meta) {
			storeAttrs = meta.storeAttrs;
			variables = meta.variables;
			coordVars = meta.coords;
			spatialRefAttrs = meta.spatialRefAttrs;
			zarrVersion = meta.zarrVersion;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
		updateUrlView(viewMode);
	}
}
</script>

{#snippet variableDetails()}
	{#if selectedNode}
		<div
			class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
		>
			{selectedNode.name}
		</div>
		<div class="flex-1 overflow-auto p-3">
			<dl class="space-y-2 text-xs">
				<div>
					<dt class="text-muted-foreground">Shape</dt>
					<dd class="font-mono text-[11px]">{formatShape(selectedNode.shape)}</dd>
				</div>

				{#if selectedNode.dims.length > 0}
					<div>
						<dt class="text-muted-foreground">Dimensions</dt>
						<dd class="font-mono text-[11px]">({selectedNode.dims.join(', ')})</dd>
					</div>
				{/if}

				<div>
					<dt class="text-muted-foreground">Data Type</dt>
					<dd class="font-mono text-[11px]">{selectedNode.dtype}</dd>
				</div>

				{#if selectedNode.chunks.length > 0}
					<div>
						<dt class="text-muted-foreground">Chunks</dt>
						<dd class="font-mono text-[11px]">[{selectedNode.chunks.join(', ')}]</dd>
					</div>
				{/if}

				{#if Object.keys(selectedNode.attributes).length > 0}
					<div>
						<dt class="text-muted-foreground">Attributes</dt>
						<dd>
							<div class="mt-1 rounded border border-zinc-200 bg-zinc-100 p-2 dark:border-zinc-700 dark:bg-zinc-800">
								{#each Object.entries(selectedNode.attributes) as [key, value]}
									<div class="flex gap-2 py-0.5">
										<span class="shrink-0 font-medium text-muted-foreground">{key}:</span>
										<span class="break-all text-zinc-700 dark:text-zinc-300">
											{typeof value === 'string' ? value : JSON.stringify(value)}
										</span>
									</div>
								{/each}
							</div>
						</dd>
					</div>
				{/if}
			</dl>
		</div>
	{:else if Object.keys(storeAttrs).length > 0}
		<div
			class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
		>
			Store Attributes
		</div>
		<div class="flex-1 overflow-auto p-3">
			<div class="rounded border border-zinc-200 bg-zinc-100 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
				{#each Object.entries(storeAttrs) as [key, value]}
					<div class="flex gap-2 py-0.5">
						<span class="shrink-0 font-medium text-muted-foreground">{key}:</span>
						<span class="break-all text-zinc-700 dark:text-zinc-300">
							{typeof value === 'string' ? value : JSON.stringify(value)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
			Select a variable
		</div>
	{/if}
{/snippet}

<div class="flex h-full flex-col">
	<!-- Header bar -->
	<div class="shrink-0 border-b border-zinc-200 px-3 py-2 sm:px-4 dark:border-zinc-800">
		<div class="flex items-center gap-1.5 sm:gap-2">
			<span class="max-w-[140px] truncate text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
			<Badge variant="secondary" class="bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300">{zarrVersion ? `Zarr v${zarrVersion}` : t('zarr.badge')}</Badge>

			{#if variables.length > 0}
				<span class="hidden text-xs text-muted-foreground sm:inline">{variables.length} {t('zarr.variables')}</span>
			{/if}

			<div class="ms-auto flex items-center gap-1">
				<Button
					variant={viewMode === 'inspect' ? 'secondary' : 'ghost'}
					size="sm"
					class="h-7 px-2 text-xs"
					onclick={() => setViewMode('inspect')}
				>
					{t('zarr.inspect')}
				</Button>
				{#if hasMapVars}
					<Button
						variant={viewMode === 'map' ? 'secondary' : 'ghost'}
						size="sm"
						class="h-7 px-2 text-xs"
						onclick={() => setViewMode('map')}
					>
						{t('zarr.map')}
					</Button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Content -->
	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-zinc-400">{t('zarr.loading')}</p>
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center">
			<p class="max-w-md text-center text-sm text-red-400">{error}</p>
		</div>
	{:else if viewMode === 'map' && hasMapVars}
		{#key viewMode}
			{#await import('./ZarrMapViewer.svelte') then ZarrMapViewer}
				<ZarrMapViewer.default {tab} variables={mapVars} coords={coordVars} {spatialRefAttrs} {zarrVersion} />
			{/await}
		{/key}
	{:else}
		<!-- Inspect mode (resizable) -->
		<ResizablePaneGroup direction="horizontal" class="min-h-0 flex-1">
			<!-- Column 1: Variable list -->
			<ResizablePane defaultSize={35} minSize={20}>
				<div class="flex h-full flex-col">
					<div
						class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
					>
						{t('zarr.variables')}
						<span class="ms-1 normal-case tracking-normal">({(variables.length + coordVars.length).toLocaleString()})</span>
					</div>
					<div class="flex-1 overflow-auto">
						{#if Object.keys(storeAttrs).length > 0}
							<button
								class="flex w-full items-center gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
								class:bg-zinc-100={selectedNode === null}
								class:dark:bg-zinc-800={selectedNode === null}
								onclick={() => (selectedNode = null)}
							>
								<span class="truncate font-medium text-muted-foreground">Store Attributes</span>
							</button>
						{/if}

						{#if variables.length > 0}
							<div class="border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
								<h3 class="text-[11px] font-medium text-muted-foreground">Data Variables ({variables.length})</h3>
							</div>
							{#each variables as v}
								<button
									class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
									class:bg-zinc-100={selectedNode?.name === v.name}
									class:dark:bg-zinc-800={selectedNode?.name === v.name}
									onclick={() => (selectedNode = v)}
								>
									<span class="truncate font-medium text-zinc-700 dark:text-zinc-300">{v.name}</span>
									<span class="ms-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{v.dtype}</span>
								</button>
							{/each}
						{/if}

						{#if coordVars.length > 0}
							<div class="border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
								<h3 class="text-[11px] font-medium text-muted-foreground">Coordinates ({coordVars.length})</h3>
							</div>
							{#each coordVars as v}
								<button
									class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
									class:bg-zinc-100={selectedNode?.name === v.name}
									class:dark:bg-zinc-800={selectedNode?.name === v.name}
									onclick={() => (selectedNode = v)}
								>
									<span class="truncate text-zinc-500 dark:text-zinc-400">{v.name}</span>
									<span class="ms-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{v.dtype}</span>
								</button>
							{/each}
						{/if}
					</div>
				</div>
			</ResizablePane>

			<ResizableHandle />

			<!-- Column 2: Variable details -->
			<ResizablePane defaultSize={65} minSize={30}>
				<div class="flex h-full flex-col">
					{@render variableDetails()}
				</div>
			</ResizablePane>
		</ResizablePaneGroup>
	{/if}
</div>
