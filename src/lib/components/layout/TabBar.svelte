<script lang="ts">
import DatabaseIcon from '@lucide/svelte/icons/database';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import XIcon from '@lucide/svelte/icons/x';
import type { Snippet } from 'svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';

let { leading }: { leading?: Snippet } = $props();

function getTabIcon(tab: { connectionId?: string }) {
	if (tab.connectionId) return DatabaseIcon;
	return FileTextIcon;
}

function handleClose(event: MouseEvent, id: string) {
	event.stopPropagation();
	tabs.close(id);
}
</script>

{#if tabs.items.length > 0 || leading}
	<div class="flex h-9 shrink-0 items-center border-b bg-muted/30">
		{#if leading}
			<div class="flex items-center ps-1">
				{@render leading()}
			</div>
		{/if}
		<ScrollArea orientation="horizontal" class="w-full">
			<div class="flex h-9 items-center">
				{#each tabs.items as tab (tab.id)}
					{@const TabIcon = getTabIcon(tab)}
					{@const isActive = tabs.active?.id === tab.id}
					<button
						class="group relative flex h-full shrink-0 items-center gap-1.5 border-e px-3 text-sm transition-colors
							{isActive
							? 'bg-background text-foreground'
							: 'text-muted-foreground hover:bg-background/50 hover:text-foreground'}"
						onclick={() => tabs.setActive(tab.id)}
					>
						<TabIcon class="size-3.5 shrink-0" />
						<span class="max-w-[120px] truncate">{tab.name}</span>
						<Button
							variant="ghost"
							size="icon-sm"
							class="ms-1 size-5 opacity-0 transition-opacity group-hover:opacity-100
								{isActive ? 'opacity-60' : ''}"
							onclick={(e: MouseEvent) => handleClose(e, tab.id)}
							aria-label={t('tabBar.closeTab', { name: tab.name })}
						>
							<XIcon class="size-3" />
						</Button>
						{#if isActive}
							<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></div>
						{/if}
					</button>
				{/each}
			</div>
		</ScrollArea>
	</div>
{/if}
