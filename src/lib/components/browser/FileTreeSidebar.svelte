<script lang="ts">
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import ClipboardCopyIcon from '@lucide/svelte/icons/clipboard-copy';
import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
import LinkIcon from '@lucide/svelte/icons/link';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
import SearchIcon from '@lucide/svelte/icons/search';
import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
import FileTypeIcon from '$lib/file-icons/FileTypeIcon.svelte';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import type { Connection, FileEntry } from '$lib/types.js';
import { getNativeScheme } from '$lib/utils/url.js';
import { syncUrlParam } from '$lib/utils/url-state.js';

let {
	connection,
	initialPath = ''
}: {
	connection: Connection;
	initialPath?: string;
} = $props();

/** Entries per API call. S3 default is 1000 — we use 200 for fast first paint. */
const PAGE_SIZE = 200;

interface TreeNode {
	entry: FileEntry;
	expanded: boolean;
	children: TreeNode[];
	loaded: boolean;
	loading: boolean;
	continuationToken?: string;
	hasMore: boolean;
}

let rootNodes = $state<TreeNode[]>([]);
let rootLoading = $state(true);
let rootLoadingMore = $state(false);
let rootContinuationToken = $state<string | undefined>();
let rootHasMore = $state(false);
let filterQuery = $state('');
let scrollEl = $state<HTMLElement>();

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
		loading: false,
		continuationToken: undefined,
		hasMore: false
	};
}

// ---------- IntersectionObserver sentinel action ----------

/**
 * Svelte action: fires `callback` when the element scrolls into view.
 * Uses the tree scroll container as the observer root for correct detection.
 */
function lazyLoad(el: HTMLElement, callback: () => void) {
	const observer = new IntersectionObserver(
		(entries) => {
			if (entries[0]?.isIntersecting) {
				callback();
			}
		},
		{ root: scrollEl, rootMargin: '200px' }
	);
	observer.observe(el);
	return {
		destroy() {
			observer.disconnect();
		}
	};
}

// ---------- Data loading ----------

async function loadChildren(node: TreeNode) {
	if (node.children.length > 0 || node.loading || !node.entry.is_dir) return;
	node.loading = true;
	try {
		const adapter = getAdapter('remote', connection.id);
		if (adapter.listPage) {
			const firstPage = await adapter.listPage(node.entry.path, undefined, PAGE_SIZE);
			node.children = firstPage.entries.map(toTreeNode);
			node.continuationToken = firstPage.continuationToken;
			node.hasMore = firstPage.hasMore;
			node.loaded = !firstPage.hasMore;
		} else {
			const entries = await adapter.list(node.entry.path);
			node.children = entries.map(toTreeNode);
			node.loaded = true;
		}
	} catch (err) {
		console.error('[FileTree] Error loading:', err);
	} finally {
		node.loading = false;
	}
}

async function loadMoreChildren(node: TreeNode) {
	if (!node.hasMore || node.loading || !node.continuationToken) return;
	node.loading = true;
	try {
		const adapter = getAdapter('remote', connection.id);
		if (adapter.listPage) {
			const page = await adapter.listPage(node.entry.path, node.continuationToken, PAGE_SIZE);
			node.children = [...node.children, ...page.entries.map(toTreeNode)];
			node.continuationToken = page.continuationToken;
			node.hasMore = page.hasMore;
			node.loaded = !page.hasMore;
		}
	} catch (err) {
		console.error('[FileTree] Error loading more:', err);
	} finally {
		node.loading = false;
	}
}

async function toggleFolder(node: TreeNode) {
	if (!node.entry.is_dir) return;

	if (node.children.length === 0) {
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
		extension: entry.extension,
		size: entry.size
	});

	// Update URL for shareable links
	syncUrlParam(connection, entry.path);
}

/** Extensions that represent "virtual files" — directories that open as viewers. */
const VIEWER_DIR_EXTENSIONS = new Set(['zarr', 'zr3']);

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

// ---------- URL builders ----------

/** Build HTTPS URL for a file path. */
function buildHttpUrl(path: string): string {
	const conn = connection;
	if (conn.endpoint) {
		const base = conn.endpoint.replace(/\/$/, '');
		return `${base}/${conn.bucket}/${encodeKeyPath(path)}`;
	}
	// Default AWS S3
	return `https://s3.${conn.region}.amazonaws.com/${conn.bucket}/${encodeKeyPath(path)}`;
}

/** Build provider-native URI (s3://, gs://, r2://, az://). */
function buildNativeUri(path: string): string {
	const conn = connection;
	const scheme = getNativeScheme(conn.provider);
	return `${scheme}://${conn.bucket}/${path}`;
}

// getNativeScheme imported from $lib/utils/url.js

function encodeKeyPath(key: string): string {
	return key
		.split('/')
		.map((s) => encodeURIComponent(s))
		.join('/');
}

// ---------- Clipboard ----------

async function copyToClipboard(text: string) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// clipboard not available
	}
}

// ---------- Size formatting ----------

function formatSize(bytes: number): string {
	if (bytes === 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------- Date formatting ----------

function formatDate(timestamp: number): string {
	if (!timestamp) return '';
	return new Date(timestamp).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

// ---------- Path expansion (for shared URLs) ----------

/**
 * Search for a node at a given level, loading more pages if needed.
 * Used by expandToPath to navigate to a deep path that may be beyond the first page.
 */
async function findNodeAtRoot(targetPath: string): Promise<TreeNode | undefined> {
	let node = rootNodes.find((n) => n.entry.path === targetPath);
	if (node) return node;

	const adapter = getAdapter('remote', connection.id);
	const prefix = connection.rootPrefix ?? '';
	while (rootHasMore && rootContinuationToken && adapter.listPage) {
		const page = await adapter.listPage(prefix, rootContinuationToken, PAGE_SIZE);
		const newNodes = page.entries.map(toTreeNode);
		rootNodes = [...rootNodes, ...newNodes];
		rootContinuationToken = page.continuationToken;
		rootHasMore = page.hasMore;

		node = newNodes.find((n) => n.entry.path === targetPath);
		if (node) return node;
	}
	return undefined;
}

async function findNodeInParent(
	parent: TreeNode,
	targetPath: string
): Promise<TreeNode | undefined> {
	if (parent.children.length === 0) {
		await loadChildren(parent);
	}

	let node = parent.children.find((n) => n.entry.path === targetPath);
	if (node) return node;

	const adapter = getAdapter('remote', connection.id);
	while (parent.hasMore && parent.continuationToken && adapter.listPage) {
		const page = await adapter.listPage(parent.entry.path, parent.continuationToken, PAGE_SIZE);
		const newNodes = page.entries.map(toTreeNode);
		parent.children = [...parent.children, ...newNodes];
		parent.continuationToken = page.continuationToken;
		parent.hasMore = page.hasMore;
		parent.loaded = !page.hasMore;

		node = newNodes.find((n) => n.entry.path === targetPath);
		if (node) return node;
	}
	return undefined;
}

/**
 * Auto-expand tree directories along a given file path.
 * Loads additional pages as needed to find each path segment.
 */
async function expandToPath(path: string) {
	if (!path) return;

	const prefix = connection.rootPrefix ?? '';
	const relativePath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	const segments = relativePath.split('/').filter(Boolean);

	let accumulatedPath = prefix;
	let parentNode: TreeNode | null = null;

	// Expand each directory segment (skip the last segment — it's the file)
	for (let i = 0; i < segments.length - 1; i++) {
		accumulatedPath += `${segments[i]}/`;

		const node: TreeNode | undefined =
			parentNode === null
				? await findNodeAtRoot(accumulatedPath)
				: await findNodeInParent(parentNode, accumulatedPath);

		if (!node || !node.entry.is_dir) break;

		if (node.children.length === 0) {
			await loadChildren(node);
		}
		node.expanded = true;
		parentNode = node;
	}
}

// ---------- Root loading ----------

// Load root entries when connection changes
$effect(() => {
	const _connId = connection.id;
	loadRoot();
});

async function loadRoot() {
	rootLoading = true;
	rootContinuationToken = undefined;
	rootHasMore = false;
	try {
		const adapter = getAdapter('remote', connection.id);
		const prefix = connection.rootPrefix ?? '';

		if (adapter.listPage) {
			const firstPage = await adapter.listPage(prefix, undefined, PAGE_SIZE);
			rootNodes = firstPage.entries.map(toTreeNode);
			rootContinuationToken = firstPage.continuationToken;
			rootHasMore = firstPage.hasMore;
		} else {
			const entries = await adapter.list(prefix);
			rootNodes = entries.map(toTreeNode);
		}

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

async function loadMoreRoot() {
	if (rootLoadingMore || !rootHasMore || !rootContinuationToken) return;
	rootLoadingMore = true;
	try {
		const adapter = getAdapter('remote', connection.id);
		const prefix = connection.rootPrefix ?? '';
		if (adapter.listPage) {
			const page = await adapter.listPage(prefix, rootContinuationToken, PAGE_SIZE);
			rootNodes = [...rootNodes, ...page.entries.map(toTreeNode)];
			rootContinuationToken = page.continuationToken;
			rootHasMore = page.hasMore;
		}
	} catch (err) {
		console.error('[FileTree] Error loading more root:', err);
	} finally {
		rootLoadingMore = false;
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
	<div class="min-h-0 flex-1 overflow-auto" bind:this={scrollEl}>
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

				<!-- Root-level scroll sentinel -->
				{#if rootHasMore && !rootLoadingMore && !filterQuery}
					<div use:lazyLoad={loadMoreRoot} class="h-1"></div>
				{/if}
				{#if rootLoadingMore}
					<div class="flex items-center justify-center py-2">
						<Loader2Icon class="size-3 animate-spin text-muted-foreground" />
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#snippet treeItem(node: TreeNode, depth: number)}
	{@const entry = node.entry}
	{@const sizeStr = !entry.is_dir && entry.size > 0 ? formatSize(entry.size) : ''}
	{@const dateStr = entry.modified ? formatDate(entry.modified) : ''}
	{@const scheme = getNativeScheme(connection.provider)}

	<ContextMenu.Root>
		<ContextMenu.Trigger>
			<div
				class="group flex w-full items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-start text-xs hover:bg-accent/50"
				style="padding-inline-start: {8 + depth * 16}px; height: 24px;"
				title={dateStr}
			>
				<!-- Expand/collapse chevron for folders -->
				{#if entry.is_dir}
					<button
						class="shrink-0 rounded hover:bg-accent"
						onclick={(e) => handleChevronClick(e, node)}
						title={isViewerDir(entry) ? t('fileTree.expandDir') : undefined}
					>
						{#if node.loading && node.children.length === 0}
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
						extension={entry.extension}
						isDir={entry.is_dir && !isViewerDir(entry)}
						isOpen={node.expanded}
						class="size-3.5 shrink-0"
					/>
					<span class="text-foreground">{entry.name}</span>
				</button>

				<!-- File size -->
				{#if sizeStr}
					<span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{sizeStr}</span>
				{/if}
			</div>
		</ContextMenu.Trigger>

		<ContextMenu.Content class="w-52">
			{#if !entry.is_dir || isViewerDir(entry)}
				<ContextMenu.Item onclick={() => openFile(entry)}>
					<ExternalLinkIcon class="me-2 size-3.5" />
					{t('fileTree.open')}
				</ContextMenu.Item>
				<ContextMenu.Separator />
			{/if}

			<ContextMenu.Item onclick={() => copyToClipboard(buildHttpUrl(entry.path))}>
				<LinkIcon class="me-2 size-3.5" />
				{t('fileTree.copyHttpUrl')}
			</ContextMenu.Item>

			<ContextMenu.Item onclick={() => copyToClipboard(buildNativeUri(entry.path))}>
				<ClipboardCopyIcon class="me-2 size-3.5" />
				{t('fileTree.copyNativeUri', { scheme: scheme.toUpperCase() })}
			</ContextMenu.Item>

			<ContextMenu.Separator />

			<ContextMenu.Item onclick={() => copyToClipboard(entry.path)}>
				<FolderOpenIcon class="me-2 size-3.5" />
				{t('fileTree.copyPath')}
			</ContextMenu.Item>

			<ContextMenu.Item onclick={() => copyToClipboard(entry.name)}>
				<FileTextIcon class="me-2 size-3.5" />
				{t('fileTree.copyName')}
			</ContextMenu.Item>
		</ContextMenu.Content>
	</ContextMenu.Root>

	{#if entry.is_dir && node.expanded}
		{#each node.children as child (child.entry.path)}
			{@render treeItem(child, depth + 1)}
		{/each}

		<!-- Folder-level scroll sentinel -->
		{#if node.hasMore && !node.loading}
			<div use:lazyLoad={() => loadMoreChildren(node)} class="h-1"></div>
		{/if}
		{#if node.hasMore && node.loading}
			<div
				class="flex items-center gap-1 py-0.5"
				style="padding-inline-start: {8 + (depth + 1) * 16}px;"
			>
				<Loader2Icon class="size-3 animate-spin text-muted-foreground" />
			</div>
		{/if}
	{/if}
{/snippet}
