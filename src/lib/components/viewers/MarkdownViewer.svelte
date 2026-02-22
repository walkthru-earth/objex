<script lang="ts">
import { tick } from 'svelte';
import SqlResultBlock from '$lib/components/editor/SqlResultBlock.svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import { EvidenceContext } from '$lib/utils/evidence-context';
import { detectRTL, processDirection, renderMarkdown } from '$lib/utils/markdown';
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
let contentDir = $state<'ltr' | 'rtl'>('ltr');
let contentEl: HTMLElement | undefined = $state();

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

		const isRTL = detectRTL(rawMarkdown);
		contentDir = isRTL ? 'rtl' : 'ltr';

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
			let rendered = await renderMarkdown(markedContent);
			html = processDirection(rendered, isRTL);
		} else {
			let rendered = await renderMarkdown(rawMarkdown);
			html = processDirection(rendered, isRTL);
		}

		// Render mermaid diagrams after DOM update
		await tick();
		await renderMermaidDiagrams();
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function renderMermaidDiagrams() {
	if (!contentEl) return;
	const mermaidNodes = contentEl.querySelectorAll('.mermaid');
	if (mermaidNodes.length === 0) return;

	try {
		const mermaid = (await import('mermaid')).default;
		mermaid.initialize({
			startOnLoad: false,
			theme: 'default',
			securityLevel: 'loose',
			flowchart: { useMaxWidth: true },
			sequence: { useMaxWidth: true },
			gantt: { useMaxWidth: true }
		});
		await mermaid.run({ nodes: mermaidNodes as NodeListOf<HTMLElement> });

		// Make SVGs responsive
		for (const node of mermaidNodes) {
			const svg = node.querySelector('svg');
			if (!svg) continue;
			const width = svg.getAttribute('width');
			const height = svg.getAttribute('height');
			if (width && height && !svg.getAttribute('viewBox')) {
				svg.setAttribute('viewBox', `0 0 ${parseFloat(width)} ${parseFloat(height)}`);
			}
			svg.removeAttribute('width');
			svg.removeAttribute('height');
		}
	} catch (err) {
		console.warn('Mermaid rendering failed:', err);
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
			<article
				bind:this={contentEl}
				dir={contentDir}
				class="prose prose-zinc dark:prose-invert max-w-none p-6 lg:p-8"
			>
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

<style>
	/* ========== CODE BLOCKS — always LTR ========== */
	article :global(pre) {
		direction: ltr;
		text-align: left;
		border-radius: 6px;
		padding: 1rem;
		overflow-x: auto;
		font-size: 0.9em;
		line-height: 1.5;
	}
	/* Fallback for plain pre blocks not styled by Shiki */
	article :global(pre:not([style])) {
		background-color: #f6f8fa;
		color: #24292e;
		border: 1px solid #e1e4e8;
	}
	article :global(code) {
		direction: ltr;
		text-align: left;
		font-family: 'SF Mono', 'Fira Code', Consolas, Monaco, Menlo, monospace;
		font-size: 0.9em;
	}
	article :global(:not(pre) > code) {
		background-color: rgba(175, 184, 193, 0.2);
		padding: 0.2em 0.4em;
		border-radius: 4px;
	}
	article :global(pre code) {
		background-color: transparent;
		padding: 0;
		color: inherit;
		font-size: inherit;
	}

	/* ========== TABLES ========== */
	article :global(table) {
		width: 100%;
		max-width: 100%;
		border-collapse: collapse;
		margin: 1rem 0;
		table-layout: fixed;
	}
	article :global(th) {
		padding: 0.5rem;
		text-align: center;
		border-width: 1px;
		border-style: solid;
		word-wrap: break-word;
		overflow-wrap: break-word;
	}
	article :global(td) {
		padding: 0.5rem;
		border: 1px solid #ccc;
		text-align: center;
		word-wrap: break-word;
		overflow-wrap: break-word;
	}
	article :global(tr:nth-child(even)) {
		background-color: #f5f5f5;
	}

	/* ========== BLOCK ELEMENTS — overflow safety ========== */
	article :global(h1),
	article :global(h2),
	article :global(h3),
	article :global(h4),
	article :global(h5),
	article :global(h6),
	article :global(p),
	article :global(ul),
	article :global(ol),
	article :global(li),
	article :global(blockquote),
	article :global(div),
	article :global(span) {
		max-width: 100%;
		overflow-wrap: break-word;
	}

	/* ========== LINKS ========== */
	article :global(a) {
		text-decoration: none;
		word-break: break-all;
	}

	/* ========== MERMAID DIAGRAMS ========== */
	article :global(.mermaid) {
		display: block;
		margin: 1.5rem auto;
		text-align: center;
		direction: ltr;
		max-width: 100%;
		overflow-x: auto;
	}
	article :global(.mermaid svg) {
		display: block;
		margin: 0 auto;
		max-width: 100%;
		width: auto;
		height: auto;
	}

	/* ========== RTL ADJUSTMENTS ========== */
	article[dir='rtl'] {
		text-align: right;
	}
	article[dir='rtl'] :global(blockquote) {
		border-right-width: 4px;
		border-right-style: solid;
		border-left: none;
		padding-right: 1rem;
		padding-left: 0;
		margin-right: 0;
	}
	article[dir='rtl'] :global(ul),
	article[dir='rtl'] :global(ol) {
		padding-right: 2em;
		padding-left: 0;
	}

	/* ========== DARK MODE OVERRIDES ========== */
	:global(.dark) article :global(pre:not([style])) {
		background-color: #1e1e2e;
		color: #cdd6f4;
		border-color: #313244;
	}
	:global(.dark) article :global(:not(pre) > code) {
		background-color: rgba(110, 118, 129, 0.3);
	}
	:global(.dark) article :global(td) {
		border-color: #444;
	}
	:global(.dark) article :global(tr:nth-child(even)) {
		background-color: rgba(255, 255, 255, 0.05);
	}
</style>
