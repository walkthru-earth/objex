<script lang="ts">
import PencilIcon from '@lucide/svelte/icons/pencil';
import Trash2Icon from '@lucide/svelte/icons/trash-2';
import FileTypeIcon from '$lib/file-icons/FileTypeIcon.svelte';
import { getFileTypeInfo } from '$lib/file-icons/index.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { safeLock } from '$lib/stores/safelock.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import type { FileEntry } from '$lib/types.js';
import { formatDate, formatFileSize } from '$lib/utils/format.js';

interface Props {
	entry: FileEntry;
	onDelete?: (entry: FileEntry) => void;
	onRename?: (entry: FileEntry) => void;
}

let { entry, onDelete, onRename }: Props = $props();

const info = $derived(getFileTypeInfo(entry.extension, entry.is_dir));
let showActions = $derived(browser.canWrite && !safeLock.locked);

function handleClick() {
	if (entry.is_dir) {
		browser.navigateTo(entry.path);
	} else {
		if (browser.activeConnection) {
			tabs.open({
				id: `${browser.activeConnection.id}:${entry.path}`,
				name: entry.name,
				path: entry.path,
				source: 'remote',
				connectionId: browser.activeConnection.id,
				extension: entry.extension
			});
		}
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
		handleClick();
	}
}

function handleDeleteClick(e: MouseEvent) {
	e.stopPropagation();
	onDelete?.(entry);
}

function handleRenameClick(e: MouseEvent) {
	e.stopPropagation();
	onRename?.(entry);
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="hover:bg-accent/50 border-border/40 group flex w-full cursor-pointer items-center gap-3 border-b px-3 py-2 text-left transition-colors last:border-b-0"
	onclick={handleClick}
	onkeydown={handleKeydown}
	role="row"
	tabindex="0"
	title={info.label}
>
	<!-- Icon -->
	<div class="flex shrink-0 items-center justify-center">
		<FileTypeIcon extension={entry.extension} isDir={entry.is_dir} class="size-4" />
	</div>

	<!-- File name -->
	<span class="text-foreground min-w-0 flex-1 truncate text-sm">
		{entry.name}
	</span>

	<!-- Action buttons (hover-reveal) -->
	{#if showActions}
		<div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
			<button
				class="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
				aria-label="Rename {entry.name}"
				onclick={handleRenameClick}
			>
				<PencilIcon class="size-3" />
			</button>
			<button
				class="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
				aria-label="Delete {entry.name}"
				onclick={handleDeleteClick}
			>
				<Trash2Icon class="size-3" />
			</button>
		</div>
	{/if}

	<!-- File size -->
	<span class="text-muted-foreground w-20 shrink-0 text-right text-xs">
		{#if entry.is_dir}
			--
		{:else}
			{formatFileSize(entry.size)}
		{/if}
	</span>

	<!-- Modified date -->
	<span class="text-muted-foreground w-24 shrink-0 text-right text-xs">
		{formatDate(entry.modified)}
	</span>
</div>
