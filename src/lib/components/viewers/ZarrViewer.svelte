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
	computeChunkCount,
	computeChunkSize,
	computeUncompressed,
	DIM_LIKE_NAMES,
	extractZarrStoreUrl,
	fetchHierarchy,
	formatChunkKeys,
	formatCodecs,
	formatShape,
	type ZarrHierarchy,
	type ZarrNode
} from '$lib/utils/zarr.js';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
const urlView = getUrlView();
let viewMode = $state<'inspect' | 'map'>(urlView === 'map' ? 'map' : 'inspect');

let hierarchy = $state.raw<ZarrHierarchy | null>(null);
let selectedNode = $state<ZarrNode | null>(null);
/** Set of expanded node paths for the tree view. */
let expanded = $state(new Set<string>());

const hasStoreAttrs = $derived(hierarchy ? Object.keys(hierarchy.storeAttrs).length > 0 : false);
/** When true, detail panel shows store attrs instead of node details. */
let showingStoreAttrs = $state(false);

const mapArrays = $derived.by(() => {
	if (!hierarchy) return [];
	const result: ZarrNode[] = [];
	function walk(n: ZarrNode) {
		if (n.kind === 'array' && (n.shape?.length ?? 0) >= 2) result.push(n);
		for (const c of n.children) walk(c);
	}
	walk(hierarchy.root);
	return result;
});

const coordArrays = $derived.by(() => {
	if (!hierarchy) return [];
	const result: ZarrNode[] = [];
	function walk(n: ZarrNode) {
		if (n.kind === 'array' && (DIM_LIKE_NAMES.has(n.name) || (n.shape?.length ?? 0) <= 1))
			result.push(n);
		for (const c of n.children) walk(c);
	}
	walk(hierarchy.root);
	return result;
});

const hasMapVars = $derived(mapArrays.length > 0);

// Reset view mode when tab changes
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
		loadHierarchy();
	});
});

function setViewMode(mode: 'inspect' | 'map') {
	viewMode = mode;
	updateUrlView(viewMode);
}

async function loadHierarchy() {
	loading = true;
	error = null;

	try {
		const rawUrl = buildHttpsUrl(tab).replace(/\/+$/, '');
		const url = extractZarrStoreUrl(rawUrl) ?? rawUrl;
		const storeName = tab.name.replace(/\.(zarr|zr3)$/, '');

		const h = await fetchHierarchy(url, storeName);
		if (h) {
			hierarchy = h;
			selectedNode = null;
			showingStoreAttrs = false;
			// Auto-expand root children
			expanded = new Set(['/']);
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
		updateUrlView(viewMode);
	}
}

function toggleExpand(path: string) {
	const next = new Set(expanded);
	if (next.has(path)) {
		next.delete(path);
	} else {
		next.add(path);
	}
	expanded = next;
}

function selectNode(node: ZarrNode) {
	selectedNode = node;
	showingStoreAttrs = false;
}

function selectStoreAttrs() {
	selectedNode = null;
	showingStoreAttrs = true;
}
</script>

{#snippet treeNode(node: ZarrNode, depth: number)}
	{@const isExpanded = expanded.has(node.path)}
	{@const hasChildren = node.children.length > 0}
	{@const isSelected = !showingStoreAttrs && selectedNode?.path === node.path}
	<div>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="flex w-full cursor-pointer items-center gap-1 py-1 pe-3 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
			class:bg-blue-50={isSelected}
			class:dark:bg-blue-950={isSelected}
			style="padding-inline-start: {depth * 16 + 8}px"
			role="treeitem"
			tabindex="0"
			aria-selected={isSelected}
			aria-expanded={hasChildren ? isExpanded : undefined}
			onclick={() => selectNode(node)}
		>
			<!-- Expand/collapse toggle -->
			{#if hasChildren}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<span
					class="flex size-4 shrink-0 items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
					role="button"
					tabindex="-1"
					aria-label={isExpanded ? 'Collapse' : 'Expand'}
					onclick={(e: MouseEvent) => {
						e.stopPropagation();
						toggleExpand(node.path);
					}}
				>
					<svg
						class="size-3 text-zinc-400 transition-transform"
						class:rotate-90={isExpanded}
						viewBox="0 0 16 16"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
							clip-rule="evenodd"
						/>
					</svg>
				</span>
			{:else}
				<span class="size-4 shrink-0"></span>
			{/if}

			<!-- Icon -->
			{#if node.kind === 'group'}
				<svg class="size-3.5 shrink-0 text-amber-500" viewBox="0 0 16 16" fill="currentColor">
					<path
						d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9Z"
					/>
				</svg>
			{:else}
				<svg class="size-3.5 shrink-0 text-blue-500" viewBox="0 0 16 16" fill="currentColor">
					<path
						fill-rule="evenodd"
						d="M1.5 2A1.5 1.5 0 0 0 0 3.5v2A1.5 1.5 0 0 0 1.5 7h3A1.5 1.5 0 0 0 6 5.5V5h4v.5A1.5 1.5 0 0 0 11.5 7h3A1.5 1.5 0 0 0 16 5.5v-2A1.5 1.5 0 0 0 14.5 2h-3A1.5 1.5 0 0 0 10 3.5V4H6v-.5A1.5 1.5 0 0 0 4.5 2h-3ZM10 9.5A1.5 1.5 0 0 1 11.5 8h3A1.5 1.5 0 0 1 16 9.5v2a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 10 11.5v-2ZM0 9.5A1.5 1.5 0 0 1 1.5 8h3A1.5 1.5 0 0 1 6 9.5v2A1.5 1.5 0 0 1 4.5 13h-3A1.5 1.5 0 0 1 0 11.5v-2Z"
						clip-rule="evenodd"
					/>
				</svg>
			{/if}

			<!-- Name -->
			<span
				class="truncate"
				class:font-medium={node.kind === 'array'}
				class:text-zinc-700={node.kind === 'array'}
				class:dark:text-zinc-300={node.kind === 'array'}
				class:text-zinc-600={node.kind === 'group'}
				class:dark:text-zinc-400={node.kind === 'group'}
			>
				{node.path === '/' ? '/ (root)' : node.name}
			</span>

			<!-- Right badge -->
			{#if node.kind === 'array' && node.dtype}
				<span class="ms-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
					{node.dtype}
				</span>
			{:else if node.kind === 'group'}
				<span class="ms-auto shrink-0 text-[10px] text-muted-foreground">{t('zarr.group')}</span>
			{/if}
		</div>

		<!-- Children (lazy: only render when expanded) -->
		{#if hasChildren && isExpanded}
			{#each node.children as child}
				{@render treeNode(child, depth + 1)}
			{/each}
		{/if}
	</div>
{/snippet}

{#snippet nodeDetails()}
	{#if showingStoreAttrs && hierarchy}
		<div
			class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
		>
			{t('zarr.storeAttributes')}
		</div>
		<div class="flex-1 overflow-auto p-3">
			<div
				class="rounded border border-zinc-200 bg-zinc-100 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"
			>
				{#each Object.entries(hierarchy.storeAttrs) as [key, value]}
					<div class="flex gap-2 py-0.5">
						<span class="shrink-0 font-medium text-muted-foreground">{key}:</span>
						<span class="break-all text-zinc-700 dark:text-zinc-300">
							{typeof value === 'string' ? value : JSON.stringify(value)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{:else if selectedNode}
		<div
			class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
		>
			{selectedNode.path}
		</div>
		<div class="flex-1 overflow-auto p-3">
			<dl class="space-y-2 text-xs">
				<div>
					<dt class="text-muted-foreground">{t('zarr.nodeType')}</dt>
					<dd class="font-mono text-[11px]">{selectedNode.kind}</dd>
				</div>

				{#if hierarchy}
					<div>
						<dt class="text-muted-foreground">{t('zarr.format')}</dt>
						<dd class="font-mono text-[11px]">
							{hierarchy.zarrVersion ? `v${hierarchy.zarrVersion}` : 'unknown'}
						</dd>
					</div>
				{/if}

				{#if selectedNode.shape}
					<div>
						<dt class="text-muted-foreground">{t('zarr.shape')}</dt>
						<dd class="font-mono text-[11px]">{formatShape(selectedNode.shape)}</dd>
					</div>
				{/if}

				{#if selectedNode.dims && selectedNode.dims.length > 0}
					<div>
						<dt class="text-muted-foreground">{t('zarr.dimensions')}</dt>
						<dd class="font-mono text-[11px]">({selectedNode.dims.join(', ')})</dd>
					</div>
				{/if}

				{#if selectedNode.dtype}
					<div>
						<dt class="text-muted-foreground">{t('zarr.dtype')}</dt>
						<dd class="font-mono text-[11px]">{selectedNode.dtype}</dd>
					</div>
				{/if}

				{#if selectedNode.fillValue != null}
					<div>
						<dt class="text-muted-foreground">{t('zarr.fillValue')}</dt>
						<dd class="font-mono text-[11px]">
							{typeof selectedNode.fillValue === 'string'
								? selectedNode.fillValue
								: JSON.stringify(selectedNode.fillValue)}
						</dd>
					</div>
				{/if}

				{#if selectedNode.chunks && selectedNode.chunks.length > 0}
					<div>
						<dt class="text-muted-foreground">{t('zarr.chunks')}</dt>
						<dd class="font-mono text-[11px]">[{selectedNode.chunks.join(', ')}]</dd>
					</div>

					{@const chunkCount = computeChunkCount(selectedNode.shape, selectedNode.chunks)}
					{#if chunkCount}
						<div>
							<dt class="text-muted-foreground">{t('zarr.chunkCount')}</dt>
							<dd class="font-mono text-[11px]">{chunkCount}</dd>
						</div>
					{/if}

					{@const chunkSize = computeChunkSize(selectedNode.chunks, selectedNode.dtype)}
					{#if chunkSize}
						<div>
							<dt class="text-muted-foreground">{t('zarr.chunkSize')}</dt>
							<dd class="font-mono text-[11px]">{chunkSize}</dd>
						</div>
					{/if}
				{/if}

				{#if computeUncompressed(selectedNode.shape, selectedNode.dtype)}
					<div>
						<dt class="text-muted-foreground">{t('zarr.uncompressed')}</dt>
						<dd class="font-mono text-[11px]">
							{computeUncompressed(selectedNode.shape, selectedNode.dtype)}
						</dd>
					</div>
				{/if}

				{#if formatCodecs(selectedNode)}
					<div>
						<dt class="text-muted-foreground">{t('zarr.codecs')}</dt>
						<dd class="font-mono text-[11px]">{formatCodecs(selectedNode)}</dd>
					</div>
				{/if}

				{#if formatChunkKeys(selectedNode)}
					<div>
						<dt class="text-muted-foreground">{t('zarr.chunkKeys')}</dt>
						<dd class="font-mono text-[11px]">{formatChunkKeys(selectedNode)}</dd>
					</div>
				{/if}

				{#if selectedNode.kind === 'group'}
					<div>
						<dt class="text-muted-foreground">{t('zarr.children')}</dt>
						<dd class="font-mono text-[11px]">{selectedNode.children.length}</dd>
					</div>
				{/if}

				{#if Object.keys(selectedNode.attributes).length > 0}
					<div>
						<dt class="text-muted-foreground">{t('zarr.attributes')}</dt>
						<dd>
							<div
								class="mt-1 rounded border border-zinc-200 bg-zinc-100 p-2 dark:border-zinc-700 dark:bg-zinc-800"
							>
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
	{:else}
		<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
			{t('zarr.selectNode')}
		</div>
	{/if}
{/snippet}

<div class="flex h-full flex-col">
	<!-- Header bar -->
	<div class="shrink-0 border-b border-zinc-200 px-3 py-2 sm:px-4 dark:border-zinc-800">
		<div class="flex items-center gap-1.5 sm:gap-2">
			<span
				class="max-w-[140px] truncate text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300"
				>{tab.name}</span
			>
			<Badge
				variant="secondary"
				class="bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300"
			>
				{hierarchy?.zarrVersion ? `Zarr v${hierarchy.zarrVersion}` : t('zarr.badge')}
			</Badge>

			{#if hierarchy}
				<span class="hidden text-xs text-muted-foreground sm:inline">
					{hierarchy.totalNodes} {t('zarr.nodes')}
				</span>
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
				<ZarrMapViewer.default
					{tab}
					variables={mapArrays}
					coords={coordArrays}
					spatialRefAttrs={hierarchy?.spatialRefAttrs ?? null}
					zarrVersion={hierarchy?.zarrVersion}
				/>
			{/await}
		{/key}
	{:else if hierarchy}
		<!-- Inspect mode (tree + detail panel) -->
		<ResizablePaneGroup direction="horizontal" class="min-h-0 flex-1">
			<!-- Left: Tree view -->
			<ResizablePane defaultSize={40} minSize={20}>
				<div class="flex h-full flex-col">
					<div
						class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
					>
						{t('zarr.contents')}
						<span class="ms-1 normal-case tracking-normal"
							>({hierarchy.totalNodes})</span
						>
					</div>
					<div class="flex-1 overflow-auto">
						{#if hasStoreAttrs}
							<button
								class="flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-800/50 dark:hover:bg-zinc-800/50"
								class:bg-blue-50={showingStoreAttrs}
								class:dark:bg-blue-950={showingStoreAttrs}
								onclick={selectStoreAttrs}
							>
								<span class="size-4 shrink-0"></span>
								<svg
									class="size-3.5 shrink-0 text-zinc-400"
									viewBox="0 0 16 16"
									fill="currentColor"
								>
									<path
										fill-rule="evenodd"
										d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H3a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1.5V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z"
										clip-rule="evenodd"
									/>
								</svg>
								<span class="truncate font-medium text-muted-foreground">
									{t('zarr.storeAttributes')}
								</span>
							</button>
						{/if}
						{@render treeNode(hierarchy.root, 0)}
					</div>
				</div>
			</ResizablePane>

			<ResizableHandle />

			<!-- Right: Detail panel -->
			<ResizablePane defaultSize={60} minSize={30}>
				<div class="flex h-full flex-col">
					{@render nodeDetails()}
				</div>
			</ResizablePane>
		</ResizablePaneGroup>
	{/if}
</div>
