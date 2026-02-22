<script lang="ts">
import { untrack } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl } from '$lib/utils/url.js';
import { getUrlView, updateUrlView } from '$lib/utils/url-state.js';
import {
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
		const url = buildHttpsUrl(tab)
			.replace(/\/zarr\.json$/, '')
			.replace(/\/+$/, '');

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

<div class="flex h-full flex-col">
	<!-- Toolbar -->
	<div
		class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
	>
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		<Badge variant="secondary" class="bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300">{t('zarr.badge')}</Badge>

		{#if variables.length > 0}
			<span class="hidden text-xs text-zinc-400 sm:inline">{variables.length} {t('zarr.variables')}</span>
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

	<!-- Content -->
	<div class="flex min-h-0 flex-1 overflow-hidden">
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
					<ZarrMapViewer.default {tab} variables={mapVars} {spatialRefAttrs} {zarrVersion} />
				{/await}
			{/key}
		{:else}
			<!-- Inspect mode -->
			<div class="flex flex-1 overflow-hidden">
				<!-- Variable list sidebar -->
				<div
					class="w-64 shrink-0 overflow-auto border-e border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
				>
					{#if Object.keys(storeAttrs).length > 0}
						<div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
							<button
								class="w-full text-start text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
								onclick={() => (selectedNode = null)}
							>
								Store Attributes
							</button>
						</div>
					{/if}

					{#if variables.length > 0}
						<div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
							<h3 class="text-xs font-medium text-zinc-400">Data Variables ({variables.length})</h3>
						</div>
						{#each variables as v}
							<button
								class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
								class:bg-blue-50={selectedNode?.name === v.name}
								class:dark:bg-blue-950={selectedNode?.name === v.name}
								onclick={() => (selectedNode = v)}
							>
								<span class="font-medium text-zinc-700 dark:text-zinc-300">{v.name}</span>
								<span class="ms-auto text-zinc-400">{v.dtype}</span>
							</button>
						{/each}
					{/if}

					{#if coordVars.length > 0}
						<div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
							<h3 class="text-xs font-medium text-zinc-400">Coordinates ({coordVars.length})</h3>
						</div>
						{#each coordVars as v}
							<button
								class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
								class:bg-blue-50={selectedNode?.name === v.name}
								class:dark:bg-blue-950={selectedNode?.name === v.name}
								onclick={() => (selectedNode = v)}
							>
								<span class="text-zinc-500 dark:text-zinc-400">{v.name}</span>
								<span class="ms-auto text-zinc-400">{v.dtype}</span>
							</button>
						{/each}
					{/if}
				</div>

				<!-- Detail panel -->
				<div class="flex-1 overflow-auto p-4">
					{#if selectedNode}
						<h2 class="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
							{selectedNode.name}
						</h2>
						<dl class="space-y-2 text-xs">
							<dt class="font-medium text-zinc-500 dark:text-zinc-400">Shape</dt>
							<dd class="font-mono text-zinc-700 dark:text-zinc-300">{formatShape(selectedNode.shape)}</dd>

							{#if selectedNode.dims.length > 0}
								<dt class="font-medium text-zinc-500 dark:text-zinc-400">Dimensions</dt>
								<dd class="font-mono text-zinc-700 dark:text-zinc-300">
									({selectedNode.dims.join(', ')})
								</dd>
							{/if}

							<dt class="font-medium text-zinc-500 dark:text-zinc-400">Data Type</dt>
							<dd class="font-mono text-zinc-700 dark:text-zinc-300">{selectedNode.dtype}</dd>

							{#if selectedNode.chunks.length > 0}
								<dt class="font-medium text-zinc-500 dark:text-zinc-400">Chunks</dt>
								<dd class="font-mono text-zinc-700 dark:text-zinc-300">[{selectedNode.chunks.join(', ')}]</dd>
							{/if}

							{#if Object.keys(selectedNode.attributes).length > 0}
								<dt class="mt-3 font-medium text-zinc-500 dark:text-zinc-400">Attributes</dt>
								<dd>
									<div class="mt-1 rounded border border-zinc-200 bg-zinc-100 p-2 dark:border-zinc-700 dark:bg-zinc-800">
										{#each Object.entries(selectedNode.attributes) as [key, value]}
											<div class="flex gap-2 py-0.5">
												<span class="shrink-0 font-medium text-zinc-500 dark:text-zinc-400">{key}:</span>
												<span class="break-all text-zinc-700 dark:text-zinc-300">
													{typeof value === 'string' ? value : JSON.stringify(value)}
												</span>
											</div>
										{/each}
									</div>
								</dd>
							{/if}
						</dl>
					{:else if Object.keys(storeAttrs).length > 0}
						<h2 class="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
							Store Attributes
						</h2>
						<div class="rounded border border-zinc-200 bg-zinc-100 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800">
							{#each Object.entries(storeAttrs) as [key, value]}
								<div class="flex gap-2 py-0.5">
									<span class="shrink-0 font-medium text-zinc-500 dark:text-zinc-400">{key}:</span>
									<span class="break-all text-zinc-700 dark:text-zinc-300">
										{typeof value === 'string' ? value : JSON.stringify(value)}
									</span>
								</div>
							{/each}
						</div>
					{:else}
						<div class="flex h-full items-center justify-center">
							<p class="text-sm text-zinc-400">Select a variable from the list</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
