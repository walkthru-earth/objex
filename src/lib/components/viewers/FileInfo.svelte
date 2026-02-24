<script lang="ts">
import { t } from '$lib/i18n/index.svelte.js';
import type { SchemaField } from '$lib/query/engine';
import type { ProgressEntry } from './LoadProgress.svelte';

let {
	entries = [],
	schema = [],
	parquetUrl = ''
}: {
	entries?: ProgressEntry[];
	schema?: SchemaField[];
	parquetUrl?: string;
} = $props();

const parquetTableSrc = $derived(
	parquetUrl
		? `https://source-cooperative.github.io/parquet-table/?iframe=true&url=${encodeURIComponent(parquetUrl)}`
		: ''
);

// Separate entries into groups for display
const geoLabels = $derived(
	new Set([t('progress.geometry'), t('progress.encoding'), t('progress.crs'), t('progress.bounds')])
);
const fileEntries = $derived(entries.filter((e) => !geoLabels.has(e.label)));
const geoEntries = $derived(entries.filter((e) => geoLabels.has(e.label)));
</script>

<div class="flex flex-1 overflow-auto">
	<div class="mx-auto w-full space-y-5 p-4 sm:p-6">
		<!-- File Metadata -->
		{#if fileEntries.length > 0}
			<section class="mx-auto max-w-2xl">
				<h3 class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
					{t('fileInfo.fileMetadata')}
				</h3>
				<div
					class="mt-2 rounded-lg border border-zinc-200/70 bg-zinc-50/50 dark:border-zinc-800/70 dark:bg-zinc-900/30"
				>
					<div class="divide-y divide-zinc-200/50 dark:divide-zinc-800/50">
						{#each fileEntries as entry}
							<div class="flex items-start gap-3 px-3.5 py-2">
								<span
									class="w-[5.5rem] shrink-0 text-xs text-zinc-400 dark:text-zinc-500"
								>
									{entry.label}
								</span>
								<div class="min-w-0 flex-1">
									<span class="text-xs font-medium text-zinc-700 dark:text-zinc-300">
										{entry.value}
									</span>
									{#if entry.detail}
										<p
											class="mt-0.5 truncate font-mono text-[10px] leading-tight text-zinc-400 dark:text-zinc-500"
										>
											{entry.detail}
										</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			</section>
		{/if}

		<!-- Geometry -->
		{#if geoEntries.length > 0}
			<section class="mx-auto max-w-2xl">
				<h3 class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
					{t('fileInfo.geometry')}
				</h3>
				<div
					class="mt-2 rounded-lg border border-zinc-200/70 bg-zinc-50/50 dark:border-zinc-800/70 dark:bg-zinc-900/30"
				>
					<div class="divide-y divide-zinc-200/50 dark:divide-zinc-800/50">
						{#each geoEntries as entry}
							<div class="flex items-start gap-3 px-3.5 py-2">
								<span
									class="w-[5.5rem] shrink-0 text-xs text-zinc-400 dark:text-zinc-500"
								>
									{entry.label}
								</span>
								<div class="min-w-0 flex-1">
									<span class="text-xs font-medium text-zinc-700 dark:text-zinc-300">
										{entry.value}
									</span>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</section>
		{/if}

		<!-- Schema -->
		{#if schema.length > 0}
			<section class="mx-auto max-w-2xl">
				<h3 class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
					{t('fileInfo.schema')} ({schema.length})
				</h3>
				<div
					class="mt-2 overflow-hidden rounded-lg border border-zinc-200/70 dark:border-zinc-800/70"
				>
					<table class="w-full text-xs">
						<thead>
							<tr class="bg-zinc-100/80 dark:bg-zinc-800/50">
								<th
									class="w-10 px-3 py-1.5 text-left font-medium text-zinc-400 dark:text-zinc-500"
								>
									#
								</th>
								<th
									class="px-3 py-1.5 text-left font-medium text-zinc-500 dark:text-zinc-400"
								>
									{t('fileInfo.column')}
								</th>
								<th
									class="px-3 py-1.5 text-left font-medium text-zinc-500 dark:text-zinc-400"
								>
									{t('fileInfo.type')}
								</th>
							</tr>
						</thead>
						<tbody>
							{#each schema as field, i}
								<tr
									class="border-t border-zinc-100/80 dark:border-zinc-800/50 {i % 2 === 0 ? 'bg-zinc-50/50 dark:bg-zinc-900/20' : ''}"
								>
									<td class="px-3 py-1.5 tabular-nums text-zinc-400 dark:text-zinc-600">
										{i + 1}
									</td>
									<td class="px-3 py-1.5 font-mono text-zinc-700 dark:text-zinc-300">
										{field.name}
									</td>
									<td class="px-3 py-1.5 font-mono text-zinc-500 dark:text-zinc-400">
										{field.type}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<!-- Parquet Table Explorer -->
		{#if parquetTableSrc}
			<section>
				<h3 class="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
					{t('fileInfo.parquetExplorer')}
				</h3>
				<div
					class="mt-2 overflow-hidden rounded-lg border border-zinc-200/70 dark:border-zinc-800/70"
				>
					<iframe
						src={parquetTableSrc}
						title="Parquet Table Explorer"
						class="h-[500px] w-full border-0"
						sandbox="allow-scripts allow-same-origin allow-popups"
						loading="lazy"
					></iframe>
				</div>
			</section>
		{/if}

		{#if entries.length === 0 && schema.length === 0}
			<div class="flex flex-1 items-center justify-center py-16">
				<p class="text-sm text-zinc-400">{t('fileInfo.noMetadata')}</p>
			</div>
		{/if}
	</div>
</div>
