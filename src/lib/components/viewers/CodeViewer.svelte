<script lang="ts">
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import { extensionToShikiLang, highlightCode } from '$lib/utils/shiki';
import { buildHttpsUrl } from '$lib/utils/url.js';
import StyleEditorOverlay from './StyleEditorOverlay.svelte';

let { tab }: { tab: Tab } = $props();

let html = $state('');
let rawCode = $state('');
let loading = $state(true);
let error = $state<string | null>(null);
let wordWrap = $state(false);
let copied = $state(false);
let showStyleEditor = $state(false);

type JsonKind = 'maplibre-style' | 'tilejson' | null;

/** Detect if JSON is a MapLibre style or TileJSON spec */
function detectJsonKind(code: string): JsonKind {
	try {
		const obj = JSON.parse(code);
		if (obj && typeof obj === 'object') {
			if (obj.version === 8 && obj.sources && obj.layers) return 'maplibre-style';
			if (obj.tilejson && obj.tiles) return 'tilejson';
		}
	} catch {
		// not valid JSON
	}
	return null;
}

const ext = $derived(`.${tab.extension.toLowerCase()}`);
const lang = $derived(extensionToShikiLang(ext));
const jsonKind = $derived(ext === '.json' ? detectJsonKind(rawCode) : null);
const styleUrl = $derived(buildHttpsUrl(tab));

const languageMap: Record<string, string> = {
	'.js': 'JavaScript',
	'.ts': 'TypeScript',
	'.py': 'Python',
	'.rs': 'Rust',
	'.go': 'Go',
	'.java': 'Java',
	'.c': 'C',
	'.cpp': 'C++',
	'.h': 'C Header',
	'.hpp': 'C++ Header',
	'.rb': 'Ruby',
	'.php': 'PHP',
	'.swift': 'Swift',
	'.kt': 'Kotlin',
	'.scala': 'Scala',
	'.r': 'R',
	'.lua': 'Lua',
	'.sql': 'SQL',
	'.html': 'HTML',
	'.css': 'CSS',
	'.xml': 'XML',
	'.yaml': 'YAML',
	'.yml': 'YAML',
	'.toml': 'TOML',
	'.json': 'JSON',
	'.sh': 'Shell',
	'.bash': 'Bash',
	'.vim': 'Vim Script',
	'.dockerfile': 'Dockerfile',
	'.makefile': 'Makefile',
	'.ini': 'INI',
	'.cfg': 'Config',
	'.conf': 'Config',
	'.env': 'Environment',
	'.txt': 'Plain Text',
	'.log': 'Log',
	'.md': 'Markdown',
	'.svelte': 'Svelte',
	'.vue': 'Vue'
};

const language = $derived(languageMap[ext] ?? 'Plain Text');

$effect(() => {
	if (!tab) return;
	loadCode();
});

async function loadCode() {
	loading = true;
	error = null;

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		rawCode = new TextDecoder().decode(data);
		html = await highlightCode(rawCode, lang);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function copyCode() {
	try {
		await navigator.clipboard.writeText(rawCode);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	} catch {
		// clipboard not available
	}
}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
	>
		<span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{tab.name}</span>
		<span
			class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
		>
			{language}
		</span>

		<div class="ml-auto flex items-center gap-2">
			{#if jsonKind === 'maplibre-style'}
				<span class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-600 dark:bg-blue-900 dark:text-blue-300">
					MapLibre Style
				</span>
				<button
					class="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
					onclick={() => (showStyleEditor = true)}
				>
					Edit Style
				</button>
			{:else if jsonKind === 'tilejson'}
				<span class="rounded bg-teal-100 px-1.5 py-0.5 text-xs text-teal-600 dark:bg-teal-900 dark:text-teal-300">
					TileJSON
				</span>
			{/if}
			<button
				class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
				onclick={() => (wordWrap = !wordWrap)}
			>
				{wordWrap ? 'No Wrap' : 'Wrap'}
			</button>
			<button
				class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
				onclick={copyCode}
			>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>
	</div>

	<div
		class="code-viewer flex-1 overflow-auto"
		class:word-wrap={wordWrap}
	>
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-zinc-400">Loading...</p>
			</div>
		{:else if error}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else}
			{@html html}
		{/if}
	</div>
</div>

{#if showStyleEditor}
	<StyleEditorOverlay {styleUrl} onclose={() => (showStyleEditor = false)} />
{/if}

<style>
	.code-viewer :global(pre) {
		margin: 0;
		padding: 1rem;
		min-height: 100%;
		font-size: 0.8125rem;
		line-height: 1.6;
	}

	.code-viewer :global(code) {
		counter-reset: line;
	}

	.code-viewer :global(code .line) {
		display: inline-block;
		width: 100%;
	}

	.code-viewer :global(code .line::before) {
		counter-increment: line;
		content: counter(line);
		display: inline-block;
		width: 3rem;
		margin-right: 1rem;
		text-align: right;
		color: #4b5563;
		user-select: none;
	}

	.code-viewer.word-wrap :global(pre) {
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
