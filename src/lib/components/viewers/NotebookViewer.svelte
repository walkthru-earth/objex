<script lang="ts">
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import { onDestroy } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { highlightCode } from '$lib/utils/shiki';

let { tab }: { tab: Tab } = $props();

let container = $state<HTMLDivElement | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
let cellCount = $state(0);
let kernelName = $state('');
let showCode = $state(true);
let copied = $state(false);
let rawContent = $state('');

$effect(() => {
	if (!tab) return;
	loadNotebook();
});

function cleanup() {
	rawContent = '';
	if (container) {
		container.innerHTML = '';
	}
}

$effect(() => {
	if (!tab) return;
	const unregister = tabResources.register(tab.id, cleanup);
	return unregister;
});

onDestroy(cleanup);

async function loadNotebook() {
	loading = true;
	error = null;

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		rawContent = new TextDecoder().decode(data);
		const notebook = JSON.parse(rawContent);

		if (typeof notebook.nbformat !== 'number' || !Array.isArray(notebook.cells)) {
			throw new Error('Not a valid Jupyter notebook');
		}

		cellCount = notebook.cells.length;
		kernelName =
			notebook.metadata?.kernelspec?.display_name ?? notebook.metadata?.language_info?.name ?? '';

		await renderNotebook(notebook);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function renderNotebook(notebook: any) {
	if (!container) return;

	const [nb, { marked }, { AnsiUp }] = await Promise.all([
		import('notebookjs').then((m) => m.default || m),
		import('marked'),
		import('ansi_up')
	]);

	// Configure notebookjs
	nb.markdown = (md: string) => marked.parse(md, { async: false }) as string;
	const ansiUp = new AnsiUp();
	nb.ansi = (text: string) => ansiUp.ansi_to_html(text);
	nb.highlighter = (code: string, lang: string) => {
		// Return escaped code — Shiki highlighting is async so we apply it after render
		return code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
	};

	const parsed = nb.parse(notebook);
	const rendered: HTMLElement = parsed.render();

	container.innerHTML = '';
	container.appendChild(rendered);

	// Apply Shiki syntax highlighting to code cells asynchronously
	const codeBlocks = container.querySelectorAll('.nb-input pre');
	for (const block of codeBlocks) {
		const code = block.textContent ?? '';
		const lang =
			notebook.metadata?.kernelspec?.language ?? notebook.metadata?.language_info?.name ?? 'python';
		try {
			const html = await highlightCode(code, lang);
			block.outerHTML = html;
		} catch {
			// Shiki doesn't support this language — keep the escaped HTML
		}
	}
}

function toggleCode() {
	showCode = !showCode;
	if (container) {
		const inputs = container.querySelectorAll('.nb-input');
		for (const el of inputs) {
			(el as HTMLElement).style.display = showCode ? '' : 'none';
		}
	}
}

async function copyRaw() {
	try {
		await navigator.clipboard.writeText(rawContent);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	} catch {
		// clipboard not available
	}
}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
	>
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		<Badge variant="secondary">{t('notebook.badge')}</Badge>
		{#if kernelName}
			<Badge variant="outline" class="hidden border-orange-200 text-orange-600 sm:inline-flex dark:border-orange-800 dark:text-orange-300">
				{kernelName}
			</Badge>
		{/if}
		{#if cellCount > 0}
			<span class="hidden text-xs text-muted-foreground sm:inline">
				{cellCount} {t('notebook.cells')}
			</span>
		{/if}

		<div class="ms-auto flex items-center gap-1 sm:gap-2">
			<!-- Desktop controls -->
			<div class="hidden items-center gap-1 sm:flex">
				<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={toggleCode}>
					{showCode ? t('notebook.hideCode') : t('notebook.showCode')}
				</Button>
				<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={copyRaw}>
					{copied ? t('code.copied') : t('code.copy')}
				</Button>
			</div>

			<!-- Mobile overflow menu -->
			<div class="flex sm:hidden">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger class="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
						<EllipsisVerticalIcon class="size-4" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-44">
						<DropdownMenu.Item onclick={toggleCode}>
							{showCode ? t('notebook.hideCode') : t('notebook.showCode')}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={copyRaw}>
							{copied ? t('code.copied') : t('code.copy')}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
	</div>

	<div class="notebook-viewer flex-1 overflow-auto" dir="ltr">
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-zinc-400">{t('notebook.loading')}</p>
			</div>
		{:else if error}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else}
			<div bind:this={container} class="notebook-content"></div>
		{/if}
	</div>
</div>

<style>
	.notebook-content {
		padding: 1rem;
		max-width: 960px;
		margin: 0 auto;
	}

	/* notebookjs cell styles — inherit app font (Cairo for Arabic, system sans for others) */
	.notebook-content :global(.nb-notebook) {
		font-family: inherit;
	}

	.notebook-content :global(.nb-cell) {
		margin-bottom: 1rem;
	}

	/* Code input cells */
	.notebook-content :global(.nb-input) {
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.notebook-content :global(.nb-input pre) {
		margin: 0;
		padding: 0.75rem 1rem;
		font-size: 0.8125rem;
		line-height: 1.6;
		overflow-x: auto;
		background: var(--muted);
	}

	/* Shiki-rendered code blocks replace the notebookjs pre */
	.notebook-content :global(.nb-input .shiki) {
		margin: 0;
		border-radius: 0;
	}

	.notebook-content :global(.nb-input .shiki pre) {
		border: none;
	}

	/* Execution count */
	.notebook-content :global(.nb-input::before) {
		display: none;
	}

	/* Output cells */
	.notebook-content :global(.nb-output) {
		padding: 0.5rem 1rem;
		border-left: 3px solid var(--border);
		margin-bottom: 0.25rem;
		overflow-x: auto;
	}

	.notebook-content :global(.nb-output pre) {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* Markdown cells */
	.notebook-content :global(.nb-markdown-cell) {
		padding: 0.5rem 0;
		font-size: 0.9375rem;
		line-height: 1.7;
	}

	.notebook-content :global(.nb-markdown-cell h1) {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 1rem 0 0.5rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.25rem;
	}

	.notebook-content :global(.nb-markdown-cell h2) {
		font-size: 1.375rem;
		font-weight: 600;
		margin: 0.75rem 0 0.375rem;
	}

	.notebook-content :global(.nb-markdown-cell h3) {
		font-size: 1.125rem;
		font-weight: 600;
		margin: 0.5rem 0 0.25rem;
	}

	.notebook-content :global(.nb-markdown-cell p) {
		margin: 0.5rem 0;
	}

	.notebook-content :global(.nb-markdown-cell code) {
		background: var(--muted);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.8125rem;
	}

	.notebook-content :global(.nb-markdown-cell pre code) {
		background: none;
		padding: 0;
	}

	.notebook-content :global(.nb-markdown-cell pre) {
		background: var(--muted);
		padding: 0.75rem 1rem;
		border-radius: 0.375rem;
		overflow-x: auto;
		font-size: 0.8125rem;
	}

	.notebook-content :global(.nb-markdown-cell ul),
	.notebook-content :global(.nb-markdown-cell ol) {
		padding-left: 1.5rem;
		margin: 0.5rem 0;
	}

	.notebook-content :global(.nb-markdown-cell li) {
		margin: 0.25rem 0;
	}

	.notebook-content :global(.nb-markdown-cell a) {
		color: var(--primary);
		text-decoration: underline;
	}

	.notebook-content :global(.nb-markdown-cell blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 1rem;
		margin: 0.5rem 0;
		color: var(--muted-foreground);
	}

	.notebook-content :global(.nb-markdown-cell table) {
		border-collapse: collapse;
		width: 100%;
		margin: 0.5rem 0;
	}

	.notebook-content :global(.nb-markdown-cell th),
	.notebook-content :global(.nb-markdown-cell td) {
		border: 1px solid var(--border);
		padding: 0.375rem 0.75rem;
		text-align: left;
		font-size: 0.875rem;
	}

	.notebook-content :global(.nb-markdown-cell th) {
		background: var(--muted);
		font-weight: 600;
	}

	/* Image outputs */
	.notebook-content :global(.nb-output img) {
		max-width: 100%;
		height: auto;
	}

	/* HTML outputs */
	.notebook-content :global(.nb-output .rendered_html) {
		overflow-x: auto;
	}

	/* Error outputs */
	.notebook-content :global(.nb-output .nb-stderr) {
		color: #dc2626;
		background: #fef2f2;
		padding: 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.8125rem;
	}

	:global(.dark) .notebook-content :global(.nb-output .nb-stderr) {
		color: #fca5a5;
		background: #450a0a;
	}

	/* Raw cell */
	.notebook-content :global(.nb-raw-cell) {
		padding: 0.5rem 1rem;
		background: var(--muted);
		border-radius: 0.375rem;
		font-family: monospace;
		font-size: 0.8125rem;
	}
</style>
