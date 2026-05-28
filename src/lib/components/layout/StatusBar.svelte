<script lang="ts">
import CloudIcon from '@lucide/svelte/icons/cloud';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import FolderIcon from '@lucide/svelte/icons/folder';
import GlobeIcon from '@lucide/svelte/icons/globe';
import InfoIcon from '@lucide/svelte/icons/info';
import { formatFileSize } from '@walkthru-earth/objex-utils';
import { Separator } from '$lib/components/ui/separator/index.js';
import { getFileTypeInfo } from '$lib/file-icons/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { files } from '$lib/stores/files.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import SafeLockToggle from './SafeLockToggle.svelte';

let isBrowsingRemote = $derived(browser.activeConnection !== null);

let displayPath = $derived(isBrowsingRemote ? browser.currentPrefix : files.currentPath);
let displayCount = $derived(isBrowsingRemote ? browser.entries.length : files.entries.length);

let activeTab = $derived(tabs.active);
let activeFileInfo = $derived(activeTab ? getFileTypeInfo(activeTab.extension) : null);
</script>

<div
	class="flex h-7 shrink-0 items-center gap-1 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground"
>
	<!-- Connection / path context -->
	{#if isBrowsingRemote && browser.activeConnection}
		<CloudIcon class="size-3 shrink-0" />
		<span class="max-w-[200px] truncate" title={browser.activeConnection.name}>
			{browser.activeConnection.name}
		</span>
		{#if displayPath}
			<span class="hidden text-muted-foreground/50 sm:inline">/</span>
			<span class="hidden max-w-[200px] truncate sm:inline" title={displayPath}>{displayPath}</span>
		{/if}
		<Separator orientation="vertical" class="mx-1.5 h-3.5" />
	{:else if displayPath}
		<FolderIcon class="hidden size-3 shrink-0 sm:block" />
		<span class="hidden max-w-[300px] truncate sm:inline" title={displayPath}>{displayPath}</span>
		<Separator orientation="vertical" class="mx-1.5 hidden h-3.5 sm:block" />
	{/if}

	<!-- Entry count — hidden on mobile -->
	{#if displayCount > 0}
		<FileTextIcon class="hidden size-3 shrink-0 sm:block" />
		<span class="hidden sm:inline"
			>{displayCount}
			{displayCount === 1 ? t('statusBar.item') : t('statusBar.items')}</span
		>
		<Separator orientation="vertical" class="mx-1.5 hidden h-3.5 sm:block" />
	{/if}

	<!-- Active file info: type label hidden on mobile, size kept -->
	{#if activeTab && activeFileInfo}
		<InfoIcon class="hidden size-3 shrink-0 sm:block" />
		<span class="hidden sm:inline">{activeFileInfo.label}</span>
		{#if activeTab.size}
			<span class="hidden text-muted-foreground/50 sm:inline">·</span>
			<span>{formatFileSize(activeTab.size)}</span>
		{/if}
		<Separator orientation="vertical" class="mx-1.5 h-3.5" />
	{/if}

	<!-- Spacer -->
	<div class="flex-1"></div>

	<!-- Safe lock toggle -->
	<SafeLockToggle />
	<Separator orientation="vertical" class="mx-1.5 h-3.5" />

	<!-- Mode indicator -->
	<GlobeIcon class="size-3 shrink-0" />
	<span>{t('statusBar.web')}</span>
</div>
