<script lang="ts">
import SqlResultBlock from '$lib/components/editor/SqlResultBlock.svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import { EvidenceContext } from '$lib/utils/evidence-context';
import { renderMarkdown } from '$lib/utils/markdown';
import {
	interpolateTemplates,
	markSqlBlocks,
	parseMarkdownDocument
} from '$lib/utils/markdown-sql';

let { tab }: { tab: Tab } = $props();

let html = $state('');
let rawMarkdown = $state('');
let loading = $state(true);
let error = $state<string | null>(null);
let editMode = $state(false);
let sqlResults = $state<
	Map<string, { columns: string[]; rows: Record<string, any>[]; error?: string }>
>(new Map());
let hasSqlBlocks = $state(false);

$effect(() => {
	if (!tab) return;
	loadMarkdown();
});

async function loadMarkdown() {
	loading = true;
	error = null;

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		rawMarkdown = new TextDecoder().decode(data);

		// Parse for SQL blocks
		const parsed = parseMarkdownDocument(rawMarkdown);
		hasSqlBlocks = parsed.sqlBlocks.length > 0;

		if (parsed.sqlBlocks.length > 0) {
			// Execute SQL blocks in parallel
			const ctx = new EvidenceContext(
				tab.connectionId ?? '',
				tab.path.split('/').slice(0, -1).join('/')
			);

			const results = new Map<
				string,
				{ columns: string[]; rows: Record<string, any>[]; error?: string }
			>();

			await Promise.all(
				parsed.sqlBlocks.map(async (block) => {
					try {
						const rows = await ctx.executeSql(block.sql, block.name);
						const columns = ctx.getColumns(block.name);
						results.set(block.name, { columns, rows });
					} catch (err) {
						results.set(block.name, {
							columns: [],
							rows: [],
							error: err instanceof Error ? err.message : String(err)
						});
					}
				})
			);

			sqlResults = results;

			// Interpolate templates and render
			const interpolated = interpolateTemplates(parsed.content, ctx.getAllResults());
			const markedContent = markSqlBlocks(interpolated);
			html = await renderMarkdown(markedContent);
		} else {
			html = await renderMarkdown(rawMarkdown);
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function saveMarkdown(markdown: string) {
	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = new TextEncoder().encode(markdown);
		await adapter.put(tab.path, data, 'text/markdown');
		rawMarkdown = markdown;
		editMode = false;
		await loadMarkdown();
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
	>
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		<Badge variant="secondary">{t('markdown.badge')}</Badge>
		{#if hasSqlBlocks}
			<Badge variant="outline" class="border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-300">
				{t('markdown.evidence')}
			</Badge>
		{/if}

		<div class="ms-auto">
			<Button
				variant="ghost"
				size="sm"
				class="h-7 px-2 text-xs {editMode ? 'text-blue-500' : ''}"
				onclick={() => (editMode = !editMode)}
			>
				{editMode ? t('markdown.view') : t('markdown.edit')}
			</Button>
		</div>
	</div>

	<div class="flex-1 overflow-auto">
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-zinc-400">Loading...</p>
			</div>
		{:else if error}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else if editMode}
			{#await import('$lib/components/editor/MilkdownEditor.svelte') then MilkdownEditor}
				<MilkdownEditor.default
					initialValue={rawMarkdown}
					onSave={saveMarkdown}
				/>
			{/await}
		{:else}
			<article class="prose prose-zinc dark:prose-invert max-w-none p-6 lg:p-8">
				{@html html}

				<!-- Render SQL result blocks -->
				{#each [...sqlResults.entries()] as [name, result]}
					<SqlResultBlock
						columns={result.columns}
						rows={result.rows}
						queryName={name}
						error={result.error ?? null}
					/>
				{/each}
			</article>
		{/if}
	</div>
</div>
