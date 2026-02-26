<script lang="ts">
import { onDestroy, tick } from 'svelte';
import SqlResultBlock from '$lib/components/editor/SqlResultBlock.svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { EvidenceContext } from '$lib/utils/evidence-context';
import { detectRTL, processDirection, renderMarkdown } from '$lib/utils/markdown';
import {
	interpolateTemplates,
	markSqlBlocks,
	parseMarkdownDocument
} from '$lib/utils/markdown-sql';

let mermaidInitialized = false;
const CAIRO_FONT = '"Cairo", sans-serif';
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

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

function cleanup() {
	html = '';
	rawMarkdown = '';
	sqlResults = new Map();
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);

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
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}

	// After loading is false and DOM has mounted the article
	if (!error) {
		await tick();
		await renderMermaidDiagrams();
		wireCodeCopyButtons();
	}
}

function wireCodeCopyButtons() {
	if (!contentEl) return;
	for (const btn of contentEl.querySelectorAll('.code-copy-btn')) {
		btn.addEventListener('click', async () => {
			const code = decodeURIComponent((btn as HTMLElement).dataset.code ?? '');
			try {
				await navigator.clipboard.writeText(code);
				btn.classList.add('copied');
				setTimeout(() => btn.classList.remove('copied'), 2000);
			} catch {
				// clipboard not available
			}
		});
	}
}

async function renderMermaidDiagrams() {
	if (!contentEl) return;
	const mermaidNodes = contentEl.querySelectorAll('.mermaid');
	if (mermaidNodes.length === 0) return;

	try {
		const mermaid = (await import('mermaid')).default;
		// Always use Cairo — it supports both Arabic and Latin scripts
		const fontFamily = CAIRO_FONT;
		if (!mermaidInitialized) {
			mermaid.initialize({
				startOnLoad: false,
				theme: 'default',
				securityLevel: 'loose',
				fontFamily: fontFamily,
				themeVariables: { fontFamily },
				flowchart: { useMaxWidth: true },
				sequence: { useMaxWidth: true },
				gantt: { useMaxWidth: true }
			});
			mermaidInitialized = true;
		}
		await mermaid.run({ nodes: mermaidNodes as NodeListOf<HTMLElement> });

		// Post-process SVGs: make responsive + force font on all text elements
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

			// Force Cairo on SVG root
			svg.style.fontFamily = fontFamily;

			// Force font on all text/tspan elements inside the SVG
			for (const el of svg.querySelectorAll('text, tspan')) {
				(el as SVGElement).style.fontFamily = fontFamily;
			}

			// Force font on foreignObject content (used by some diagram types)
			for (const el of svg.querySelectorAll(
				'foreignObject div, foreignObject span, foreignObject p'
			)) {
				(el as HTMLElement).style.fontFamily = fontFamily;
			}
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
				class:md-rtl={contentDir === 'rtl'}
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
	/* ========== FONT — Cairo for RTL content (supports Arabic + Latin) ========== */
	article.md-rtl {
		font-family: var(--font-cairo, "Cairo", sans-serif);
	}

	/* ========== CODE BLOCK WRAPPER (copy button + shiki) ========== */
	article :global(.code-block-wrapper) {
		position: relative;
		margin: 1rem 0;
	}
	article :global(.code-copy-btn) {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border: none;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.6);
		cursor: pointer;
		font-size: 11px;
		opacity: 0;
		transition: opacity 0.15s;
	}
	article :global(.code-block-wrapper:hover .code-copy-btn) {
		opacity: 1;
	}
	article :global(.code-copy-btn:hover) {
		background: rgba(255, 255, 255, 0.2);
		color: rgba(255, 255, 255, 0.9);
	}
	article :global(.code-copy-btn.copied) {
		opacity: 1;
		color: #4ade80;
	}
	article :global(.code-copy-btn.copied)::after {
		content: '✓';
		margin-left: 2px;
	}
	article :global(.code-lang) {
		text-transform: uppercase;
		font-weight: 500;
		letter-spacing: 0.03em;
	}
	/* Dark mode: swap copy button colors for light code block bg */
	:global(.dark) article :global(.code-copy-btn) {
		background: rgba(0, 0, 0, 0.1);
		color: rgba(0, 0, 0, 0.5);
	}
	:global(.dark) article :global(.code-copy-btn:hover) {
		background: rgba(0, 0, 0, 0.2);
		color: rgba(0, 0, 0, 0.8);
	}
	:global(.dark) article :global(.code-copy-btn.copied) {
		color: #16a34a;
	}

	/* ========== CODE BLOCKS — always LTR, reversed theme ========== */
	article :global(pre) {
		direction: ltr;
		text-align: left;
		border-radius: 6px;
		padding: 1rem;
		overflow-x: auto;
		font-size: 0.9em;
		line-height: 1.5;
	}
	/* Fallback for plain pre blocks not styled by Shiki (reversed: dark in light) */
	article :global(pre:not([style])) {
		background-color: #24292e;
		color: #e1e4e8;
		border: 1px solid #444d56;
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
	/* Reversed fallback: light code blocks in dark mode */
	:global(.dark) article :global(pre:not([style])) {
		background-color: #f6f8fa;
		color: #24292e;
		border-color: #e1e4e8;
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
