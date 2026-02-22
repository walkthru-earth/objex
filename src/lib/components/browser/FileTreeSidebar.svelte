<script lang="ts">
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
import SearchIcon from '@lucide/svelte/icons/search';
import FileTypeIcon from '$lib/file-icons/FileTypeIcon.svelte';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import type { Connection, FileEntry } from '$lib/types.js';
import { syncUrlParam } from '$lib/utils/url-state.js';

let {
	connection,
	initialPath = ''
}: {
	connection: Connection;
	initialPath?: string;
} = $props();

interface TreeNode {
	entry: FileEntry;
	expanded: boolean;
	children: TreeNode[];
	loaded: boolean;
	loading: boolean;
}

let rootNodes = $state<TreeNode[]>([]);
let rootLoading = $state(true);
let filterQuery = $state('');

const filteredNodes = $derived(
	filterQuery ? filterTree(rootNodes, filterQuery.toLowerCase()) : rootNodes
);

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
	const result: TreeNode[] = [];
	for (const node of nodes) {
		if (node.entry.name.toLowerCase().includes(query)) {
			result.push(node);
		} else if (node.entry.is_dir && node.children.length > 0) {
			const filteredChildren = filterTree(node.children, query);
			if (filteredChildren.length > 0) {
				result.push({ ...node, children: filteredChildren, expanded: true });
			}
		}
	}
	return result;
}

function toTreeNode(entry: FileEntry): TreeNode {
	return {
		entry,
		expanded: false,
		children: [],
		loaded: !entry.is_dir,
		loading: false
	};
}

async function loadChildren(node: TreeNode) {
	if (node.loaded || node.loading || !node.entry.is_dir) return;
	node.loading = true;
	try {
		const adapter = getAdapter('remote', connection.id);
		const entries = await adapter.list(node.entry.path);
		node.children = entries.map(toTreeNode);
		node.loaded = true;
	} catch (err) {
		console.error('[FileTree] Error loading:', err);
	} finally {
		node.loading = false;
	}
}

async function toggleFolder(node: TreeNode) {
	if (!node.entry.is_dir) return;

	if (!node.loaded) {
		await loadChildren(node);
	}
	node.expanded = !node.expanded;
}

function openFile(entry: FileEntry) {
	tabs.open({
		id: `${connection.id}:${entry.path}`,
		name: entry.name,
		path: entry.path,
		source: 'remote',
		connectionId: connection.id,
		extension: entry.extension
	});

	// Update URL for shareable links
	syncUrlParam(connection, entry.path);
}

/** Extensions that represent "virtual files" — directories that open as viewers. */
const VIEWER_DIR_EXTENSIONS = new Set(['zarr']);

function isViewerDir(entry: FileEntry): boolean {
	return entry.is_dir && VIEWER_DIR_EXTENSIONS.has(entry.extension);
}

function handleNodeClick(node: TreeNode) {
	if (isViewerDir(node.entry)) {
		// .zarr directories open in the viewer (clicking chevron expands)
		openFile(node.entry);
	} else if (node.entry.is_dir) {
		toggleFolder(node);
	} else {
		openFile(node.entry);
	}
}

function handleChevronClick(e: MouseEvent, node: TreeNode) {
	e.stopPropagation();
	toggleFolder(node);
}

/**
 * Auto-expand tree directories along a given file path.
 * e.g. "data/sub/file.parquet" → expands "data/" then "data/sub/"
 */
async function expandToPath(path: string) {
	if (!path) return;

	const prefix = connection.rootPrefix ?? '';
	const relativePath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	const segments = relativePath.split('/').filter(Boolean);

	let currentNodes = rootNodes;
	let accumulatedPath = prefix;

	// Expand each directory segment (skip the last segment — it's the file)
	for (let i = 0; i < segments.length - 1; i++) {
		accumulatedPath += `${segments[i]}/`;
		const node = currentNodes.find((n) => n.entry.path === accumulatedPath);
		if (!node || !node.entry.is_dir) break;

		if (!node.loaded) {
			await loadChildren(node);
		}
		node.expanded = true;
		currentNodes = node.children;
	}
}

// Load root entries when connection changes
$effect(() => {
	const _connId = connection.id;
	loadRoot();
});

async function loadRoot() {
	rootLoading = true;
	try {
		const adapter = getAdapter('remote', connection.id);
		const prefix = connection.rootPrefix ?? '';
		const entries = await adapter.list(prefix);
		rootNodes = entries.map(toTreeNode);

		// Auto-expand to the initial shared path
		if (initialPath) {
			await expandToPath(initialPath);
		}
	} catch (err) {
		console.error('[FileTree] Error loading root:', err);
	} finally {
		rootLoading = false;
	}
}
</script>

<div class="flex h-full flex-col bg-sidebar text-sidebar-foreground">
	<!-- Header -->
	<div class="flex items-center gap-2 border-b border-sidebar-border px-3 py-2">
		<span class="truncate text-xs font-medium text-muted-foreground">{connection.name}</span>
		<button
			class="ms-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
			onclick={loadRoot}
			title={t('fileTree.refresh')}
		>
			<RefreshCwIcon class="size-3" />
		</button>
	</div>

	<!-- Search filter -->
	<div class="border-b border-sidebar-border px-2 py-1.5">
		<div class="flex items-center gap-1.5 rounded bg-sidebar-accent/50 px-2 py-1">
			<SearchIcon class="size-3 shrink-0 text-muted-foreground" />
			<input
				type="text"
				class="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
				placeholder={t('fileTree.filterPlaceholder')}
				bind:value={filterQuery}
			/>
		</div>
	</div>

	<!-- Tree (scrollable both axes) -->
	<div class="min-h-0 flex-1 overflow-auto">
		{#if rootLoading}
			<div class="flex items-center justify-center py-8">
				<Loader2Icon class="size-4 animate-spin text-muted-foreground" />
			</div>
		{:else if filteredNodes.length === 0}
			<div class="px-3 py-6 text-center text-xs text-muted-foreground">
				{filterQuery ? t('fileTree.noMatch') : t('fileTree.emptyBucket')}
			</div>
		{:else}
			<div class="min-w-max py-1">
				{#each filteredNodes as node (node.entry.path)}
					{@render treeItem(node, 0)}
				{/each}
			</div>
		{/if}
	</div>
</div>

{#snippet treeItem(node: TreeNode, depth: number)}
	<div
		class="flex w-full items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-start text-xs hover:bg-accent/50"
		style="padding-inline-start: {8 + depth * 16}px; height: 24px;"
	>
		<!-- Expand/collapse chevron for folders -->
		{#if node.entry.is_dir}
			<button
				class="shrink-0 rounded hover:bg-accent"
				onclick={(e) => handleChevronClick(e, node)}
				title={isViewerDir(node.entry) ? t('fileTree.expandDir') : undefined}
			>
				{#if node.loading}
					<Loader2Icon class="size-3 animate-spin text-muted-foreground" />
				{:else if node.expanded}
					<ChevronDownIcon class="size-3 text-muted-foreground" />
				{:else}
					<ChevronRightIcon class="size-3 text-muted-foreground rtl:-scale-x-100" />
				{/if}
			</button>
		{:else}
			<span class="size-3 shrink-0"></span>
		{/if}

		<!-- Clickable area: icon + name -->
		<button
			class="flex min-w-0 flex-1 items-center gap-1"
			onclick={() => handleNodeClick(node)}
		>
			<FileTypeIcon
				extension={node.entry.extension}
				isDir={node.entry.is_dir && !isViewerDir(node.entry)}
				isOpen={node.expanded}
				class="size-3.5 shrink-0"
			/>
			<span class="text-foreground">{node.entry.name}</span>
		</button>
	</div>

	{#if node.entry.is_dir && node.expanded}
		{#each node.children as child (child.entry.path)}
			{@render treeItem(child, depth + 1)}
		{/each}
	{/if}
{/snippet}
