<script lang="ts">
import CloudIcon from '@lucide/svelte/icons/cloud';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import FolderIcon from '@lucide/svelte/icons/folder';
import GlobeIcon from '@lucide/svelte/icons/globe';
import { Separator } from '$lib/components/ui/separator/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { files } from '$lib/stores/files.svelte.js';
import SafeLockToggle from './SafeLockToggle.svelte';

let isBrowsingRemote = $derived(browser.activeConnection !== null);

let displayPath = $derived(isBrowsingRemote ? browser.currentPrefix : files.currentPath);
let displayCount = $derived(isBrowsingRemote ? browser.entries.length : files.entries.length);
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
			<span class="text-muted-foreground/50">/</span>
			<span class="max-w-[200px] truncate" title={displayPath}>{displayPath}</span>
		{/if}
		<Separator orientation="vertical" class="mx-1.5 h-3.5" />
	{:else if displayPath}
		<FolderIcon class="size-3 shrink-0" />
		<span class="max-w-[300px] truncate" title={displayPath}>{displayPath}</span>
		<Separator orientation="vertical" class="mx-1.5 h-3.5" />
	{/if}

	<!-- Entry count -->
	{#if displayCount > 0}
		<FileTextIcon class="size-3 shrink-0" />
		<span>{displayCount} {displayCount === 1 ? t('statusBar.item') : t('statusBar.items')}</span>
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
