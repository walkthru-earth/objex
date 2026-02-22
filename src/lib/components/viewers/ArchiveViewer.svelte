<script lang="ts">
import type { Entry } from '@zip.js/zip.js';
import { untrack } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import {
	buildFileTree,
	extractEntry,
	type FileTreeNode,
	readZipEntriesFromBuffer,
	readZipEntriesFromUrl
} from '$lib/utils/archive';
import { formatFileSize } from '$lib/utils/format';
import { buildHttpsUrl } from '$lib/utils/url.js';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let tree = $state<FileTreeNode[]>([]);
let entries = $state<Entry[]>([]);
let selectedNode = $state<FileTreeNode | null>(null);
let previewContent = $state<string | null>(null);
let previewType = $state<'text' | 'image' | 'binary'>('binary');
let previewUrl = $state<string | null>(null);
let extracting = $state(false);
let expandedDirs = $state<Set<string>>(new Set());
let loadMethod = $state<'range' | 'full' | ''>('');

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loadArchive();
	});
});

async function loadArchive() {
	loading = true;
	error = null;

	try {
		if (tab.source === 'remote') {
			// Remote files: use HTTP range requests (no full download)
			const url = buildHttpsUrl(tab);
			try {
				const result = await readZipEntriesFromUrl(url);
				entries = result.entries;
				tree = buildFileTree(result.entryList);
				loadMethod = 'range';
				return;
			} catch {
				// Range requests failed — fall back to full download
			}
		}

		// Local files or range-request fallback: download full file
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		const result = await readZipEntriesFromBuffer(data);
		entries = result.entries;
		tree = buildFileTree(result.entryList);
		loadMethod = 'full';
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function selectNode(node: FileTreeNode) {
	if (node.isDir) {
		if (expandedDirs.has(node.path)) {
			expandedDirs.delete(node.path);
		} else {
			expandedDirs.add(node.path);
		}
		expandedDirs = new Set(expandedDirs);
		return;
	}

	selectedNode = node;
	previewContent = null;
	previewUrl = null;
	extracting = true;

	try {
		const entry = entries.find((e) => e.filename === node.path || e.filename === `${node.path}/`);
		if (!entry || entry.directory) return;

		const data = await extractEntry(entry);

		const ext = node.name.split('.').pop()?.toLowerCase() || '';
		const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
		const textExts = [
			'txt',
			'md',
			'json',
			'xml',
			'html',
			'css',
			'js',
			'ts',
			'py',
			'rs',
			'yaml',
			'yml',
			'toml',
			'csv',
			'sql',
			'sh'
		];

		if (imageExts.includes(ext)) {
			previewType = 'image';
			const blob = new Blob([data as unknown as BlobPart]);
			previewUrl = URL.createObjectURL(blob);
		} else if (textExts.includes(ext) || data.length < 100000) {
			try {
				previewContent = new TextDecoder('utf-8', { fatal: true }).decode(data);
				previewType = 'text';
			} catch {
				previewType = 'binary';
			}
		} else {
			previewType = 'binary';
		}
	} catch (err) {
		previewContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
		previewType = 'text';
	} finally {
		extracting = false;
	}
}
</script>

<div class="flex h-full flex-col">
	<div class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800">
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		<Badge variant="secondary">{t('archive.badge')}</Badge>
		{#if entries.length > 0}
			<span class="hidden text-xs text-zinc-400 sm:inline">{entries.length} {t('archive.entries')}</span>
		{/if}
		{#if loadMethod === 'range'}
			<Badge variant="outline" class="border-emerald-200 text-emerald-600 dark:border-emerald-800 dark:text-emerald-400">
				{t('archive.streamed')}
			</Badge>
		{/if}
	</div>

	<div class="flex flex-1 overflow-hidden">
		{#if loading}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-zinc-400">{t('archive.loading')}</p>
			</div>
		{:else if error}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else}
			<!-- File tree -->
			<div
				class="w-72 shrink-0 overflow-auto border-e border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
			>
				{#snippet renderTree(nodes: FileTreeNode[], depth: number)}
					{#each nodes as node}
						<button
							class="flex w-full items-center gap-1.5 px-3 py-1 text-start text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
							class:bg-blue-50={selectedNode?.path === node.path}
							class:dark:bg-blue-950={selectedNode?.path === node.path}
							style="padding-inline-start: {depth * 16 + 12}px;"
							onclick={() => selectNode(node)}
						>
							<span class="shrink-0 text-zinc-400">
								{#if node.isDir}
									{expandedDirs.has(node.path) ? '▼' : '►'}
								{:else}
									●
								{/if}
							</span>
							<span
								class="truncate"
								class:font-medium={node.isDir}
								class:text-zinc-700={true}
								class:dark:text-zinc-300={true}
							>
								{node.name}
							</span>
							{#if !node.isDir}
								<span class="ms-auto shrink-0 text-[10px] text-zinc-400">
									{formatFileSize(node.size)}
								</span>
							{/if}
						</button>
						{#if node.isDir && expandedDirs.has(node.path)}
							{@render renderTree(node.children, depth + 1)}
						{/if}
					{/each}
				{/snippet}
				{@render renderTree(tree, 0)}
			</div>

			<!-- Preview -->
			<div
				class="flex flex-1 items-center justify-center overflow-auto bg-white p-4 dark:bg-zinc-950"
			>
				{#if extracting}
					<p class="text-sm text-zinc-400">{t('archive.extracting')}</p>
				{:else if selectedNode && previewType === 'text' && previewContent !== null}
					<pre
						class="h-full w-full overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-700 dark:text-zinc-300"
					>{previewContent}</pre>
				{:else if selectedNode && previewType === 'image' && previewUrl}
					<img
						src={previewUrl}
						alt={selectedNode.name}
						class="max-h-full max-w-full object-contain"
					/>
				{:else if selectedNode}
					<p class="text-sm text-zinc-400">Binary file — {formatFileSize(selectedNode.size)}</p>
				{:else}
					<p class="text-sm text-zinc-400">{t('archive.selectFile')}</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
