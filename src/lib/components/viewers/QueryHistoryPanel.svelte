<script lang="ts">
import ClockIcon from '@lucide/svelte/icons/clock';
import SearchIcon from '@lucide/svelte/icons/search';
import TrashIcon from '@lucide/svelte/icons/trash-2';
import XIcon from '@lucide/svelte/icons/x';
import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import type { QueryHistoryEntry } from '$lib/stores/query-history.svelte.js';
import { queryHistory } from '$lib/stores/query-history.svelte.js';

let {
	visible = false,
	onSelect
}: {
	visible?: boolean;
	onSelect?: (sql: string) => void;
} = $props();

let searchQuery = $state('');

const filteredEntries = $derived(
	searchQuery ? queryHistory.search(searchQuery) : queryHistory.entries
);

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return t('queryHistory.justNow');
	if (diffMins < 60) return t('queryHistory.minsAgo', { n: diffMins });
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return t('queryHistory.hoursAgo', { n: diffHours });
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return t('queryHistory.daysAgo', { n: diffDays });

	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function truncateSql(sql: string, maxLen = 120): string {
	const oneLine = sql.replace(/\s+/g, ' ').trim();
	if (oneLine.length <= maxLen) return oneLine;
	return `${oneLine.slice(0, maxLen)}...`;
}
</script>

{#if visible}
	<div
		class="flex w-72 shrink-0 flex-col overflow-hidden border-s border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
	>
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
			<div class="flex items-center gap-1.5">
				<ClockIcon class="size-3.5 text-zinc-500" />
				<h3 class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
					{t('queryHistory.title')}
				</h3>
			</div>
			{#if queryHistory.entries.length > 0}
				<button
					class="text-[10px] text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
					onclick={() => queryHistory.clear()}
				>
					{t('queryHistory.clearAll')}
				</button>
			{/if}
		</div>

		<!-- Search -->
		<div class="border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
			<div class="flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
				<SearchIcon class="size-3 shrink-0 text-zinc-400" />
				<input
					type="text"
					class="w-full bg-transparent text-xs outline-none placeholder:text-zinc-400"
					placeholder={t('queryHistory.searchPlaceholder')}
					bind:value={searchQuery}
				/>
				{#if searchQuery}
					<button class="shrink-0 text-zinc-400 hover:text-zinc-600" onclick={() => { searchQuery = ''; }}>
						<XIcon class="size-3" />
					</button>
				{/if}
			</div>
		</div>

		<!-- Entries -->
		<ScrollArea class="flex-1">
			{#if filteredEntries.length === 0}
				<div class="px-3 py-6 text-center text-xs text-zinc-400">
					{searchQuery ? 'No matching queries' : 'No query history yet'}
				</div>
			{:else}
				<div class="divide-y divide-zinc-100 dark:divide-zinc-800">
					{#each filteredEntries as entry (entry.id)}
						<div
							class="group flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-start hover:bg-zinc-100 dark:hover:bg-zinc-800"
							role="button"
							tabindex="0"
							onclick={() => onSelect?.(entry.sql)}
							onkeydown={(e) => { if (e.key === 'Enter') onSelect?.(entry.sql); }}
						>
							<div class="font-mono text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
								{truncateSql(entry.sql)}
							</div>
							<div class="flex items-center gap-2 text-[10px] text-zinc-400">
								<span>{formatTime(entry.timestamp)}</span>
								<span>{entry.durationMs}ms</span>
								{#if entry.rowCount > 0}
									<span>{entry.rowCount.toLocaleString()} rows</span>
								{/if}
								{#if entry.error}
									<span class="text-red-400">error</span>
								{/if}
								<button
									class="ms-auto opacity-0 group-hover:opacity-100"
									onclick={(e) => { e.stopPropagation(); queryHistory.remove(entry.id); }}
									title="Remove"
								>
									<TrashIcon class="size-3 text-zinc-400 hover:text-red-500" />
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</ScrollArea>
	</div>
{/if}
