<script lang="ts">
import { ArrowDown, ArrowUp, ArrowUpDown, FolderOpen, Layers, Loader2 } from '@lucide/svelte';
import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
import { Button } from '$lib/components/ui/button/index.js';
import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { safeLock } from '$lib/stores/safelock.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import type { FileEntry } from '$lib/types.js';
import { detectZarrMarkers } from '$lib/utils/zarr.js';
import Breadcrumb from './Breadcrumb.svelte';
import CreateFolderDialog from './CreateFolderDialog.svelte';
import DeleteConfirmDialog from './DeleteConfirmDialog.svelte';
import DropZone from './DropZone.svelte';
import FileRow from './FileRow.svelte';
import RenameDialog from './RenameDialog.svelte';
import SearchBar from './SearchBar.svelte';
import UploadButton from './UploadButton.svelte';

type SortField = 'name' | 'size' | 'modified' | 'extension';
type SortDirection = 'asc' | 'desc';

let filterQuery = $state('');
let sortField = $state<SortField>('name');
let sortDirection = $state<SortDirection>('asc');

let deleteDialogOpen = $state(false);
let deleteTarget = $state<FileEntry | null>(null);
let createFolderOpen = $state(false);
let renameDialogOpen = $state(false);
let renameTarget = $state<FileEntry | null>(null);

let showWriteActions = $derived(browser.canWrite && !safeLock.locked);

const zarrDetection = $derived(detectZarrMarkers(browser.entries.map((e: FileEntry) => e.name)));

function openAsZarr() {
	if (!browser.activeConnection) return;
	const prefix = browser.currentPrefix.replace(/\/+$/, '');
	const name = prefix.split('/').pop() || browser.activeConnection.bucket;
	tabs.open({
		id: `${browser.activeConnection.id}:${prefix}/`,
		name,
		path: `${prefix}/`,
		source: 'remote',
		connectionId: browser.activeConnection.id,
		extension: 'zarr'
	});
}

const sortedAndFilteredEntries = $derived.by(() => {
	let result = [...browser.entries];

	// Filter
	if (filterQuery) {
		const q = filterQuery.toLowerCase();
		result = result.filter((entry: FileEntry) => entry.name.toLowerCase().includes(q));
	}

	// Sort
	const dir = sortDirection === 'asc' ? 1 : -1;
	result.sort((a, b) => {
		// Directories always come first
		if (a.is_dir && !b.is_dir) return -1;
		if (!a.is_dir && b.is_dir) return 1;

		switch (sortField) {
			case 'name':
				return dir * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
			case 'size':
				return dir * (a.size - b.size);
			case 'modified':
				return dir * (a.modified - b.modified);
			case 'extension':
				return dir * a.extension.localeCompare(b.extension, undefined, { sensitivity: 'base' });
			default:
				return 0;
		}
	});

	return result;
});

function handleFilter(query: string) {
	filterQuery = query;
}

function handleNavigate(path: string) {
	browser.navigateTo(path);
}

function handleSort(field: SortField) {
	if (sortField === field) {
		sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
	} else {
		sortField = field;
		sortDirection = 'asc';
	}
}

function handleDelete(entry: FileEntry) {
	deleteTarget = entry;
	deleteDialogOpen = true;
}

function handleRename(entry: FileEntry) {
	renameTarget = entry;
	renameDialogOpen = true;
}
</script>

<div class="flex h-full w-full flex-col">
	<!-- Header: connection name + breadcrumb + search + actions -->
	<div class="border-border flex flex-col gap-2 border-b px-3 py-2">
		{#if browser.activeConnection}
			<div class="flex items-center gap-2">
				<span class="text-xs font-medium text-muted-foreground">
					{browser.activeConnection.name}
				</span>
				<span class="text-muted-foreground/50 text-xs">/</span>
				<span class="text-xs text-muted-foreground">
					{browser.activeConnection.bucket}
				</span>
			</div>
		{/if}
		<Breadcrumb path={browser.currentPrefix} onNavigate={handleNavigate} />
		<div class="flex items-center gap-2">
			<div class="flex-1">
				<SearchBar onFilter={handleFilter} />
			</div>
			{#if showWriteActions}
				<UploadButton />
				<Button
					variant="outline"
					size="sm"
					class="h-7 gap-1.5 px-2 text-xs"
					onclick={() => { createFolderOpen = true; }}
				>
					<FolderPlusIcon class="size-3.5" />
					{t('fileBrowser.newFolder')}
				</Button>
			{/if}
		</div>
	</div>

	<!-- Column headers -->
	<div class="border-border bg-muted/30 flex items-center gap-3 border-b px-3 py-1.5 text-xs">
		<div class="w-4 shrink-0"></div>
		<button
			class="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center gap-1 transition-colors"
			onclick={() => handleSort('name')}
		>
			{t('fileBrowser.name')}
			{#if sortField === 'name'}
				{#if sortDirection === 'asc'}
					<ArrowUp class="size-3" />
				{:else}
					<ArrowDown class="size-3" />
				{/if}
			{:else}
				<ArrowUpDown class="size-3 opacity-0 group-hover:opacity-100" />
			{/if}
		</button>
		<button
			class="text-muted-foreground hover:text-foreground flex w-20 shrink-0 items-center justify-end gap-1 transition-colors"
			onclick={() => handleSort('size')}
		>
			{#if sortField === 'size'}
				{#if sortDirection === 'asc'}
					<ArrowUp class="size-3" />
				{:else}
					<ArrowDown class="size-3" />
				{/if}
			{/if}
			{t('fileBrowser.size')}
		</button>
		<button
			class="text-muted-foreground hover:text-foreground flex w-24 shrink-0 items-center justify-end gap-1 transition-colors"
			onclick={() => handleSort('modified')}
		>
			{#if sortField === 'modified'}
				{#if sortDirection === 'asc'}
					<ArrowUp class="size-3" />
				{:else}
					<ArrowDown class="size-3" />
				{/if}
			{/if}
			{t('fileBrowser.modified')}
		</button>
	</div>

	<!-- Zarr detection banner -->
	{#if zarrDetection.detected}
		<div class="border-border flex items-center gap-2 border-b bg-purple-50 px-3 py-1.5 dark:bg-purple-950/30">
			<Layers class="size-3.5 shrink-0 text-purple-500" />
			<span class="flex-1 text-xs text-purple-700 dark:text-purple-300">
				{t('fileBrowser.zarrDetected', { version: String(zarrDetection.version ?? '?') })}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-6 gap-1 px-2 text-[11px]"
				onclick={openAsZarr}
			>
				{t('fileBrowser.openAsZarr')}
			</Button>
		</div>
	{/if}

	<!-- File list -->
	<div class="relative min-h-0 flex-1">
		<DropZone>
			{#if browser.loading}
				<div class="flex h-full items-center justify-center">
					<Loader2 class="text-muted-foreground size-6 animate-spin" />
				</div>
			{:else if browser.error}
				<div class="flex h-full items-center justify-center px-4">
					<p class="text-destructive text-sm">{browser.error}</p>
				</div>
			{:else if sortedAndFilteredEntries.length === 0}
				<div class="flex h-full flex-col items-center justify-center gap-2 px-4">
					<FolderOpen class="text-muted-foreground/50 size-10" />
					{#if filterQuery}
						<p class="text-muted-foreground text-sm">{t('fileBrowser.noMatch', { query: filterQuery })}</p>
					{:else}
						<p class="text-muted-foreground text-sm">{t('fileBrowser.empty')}</p>
					{/if}
				</div>
			{:else}
				<ScrollArea class="h-full">
					<div role="table" aria-label="File list">
						{#each sortedAndFilteredEntries as entry (entry.path)}
							<FileRow
								{entry}
								onDelete={handleDelete}
								onRename={handleRename}
							/>
						{/each}
					</div>
				</ScrollArea>
			{/if}
		</DropZone>
	</div>

	<!-- Upload progress bar -->
	{#if browser.uploading}
		<div class="border-border border-t px-3 py-1.5">
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full bg-primary transition-all"
						style="width: {browser.uploadProgress.total > 0 ? (browser.uploadProgress.current / browser.uploadProgress.total) * 100 : 0}%"
					></div>
				</div>
				<span>{browser.uploadProgress.current}/{browser.uploadProgress.total}</span>
			</div>
		</div>
	{/if}
</div>

<DeleteConfirmDialog bind:open={deleteDialogOpen} entry={deleteTarget} />
<CreateFolderDialog bind:open={createFolderOpen} />
<RenameDialog bind:open={renameDialogOpen} entry={renameTarget} />
