<script lang="ts">
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { t } from '$lib/i18n/index.svelte.js';
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
		class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
	>
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		<Badge variant="secondary">{language}</Badge>

		<div class="ms-auto flex items-center gap-1 sm:gap-2">
			{#if jsonKind === 'maplibre-style'}
				<Badge variant="outline" class="hidden border-blue-200 text-blue-600 sm:inline-flex dark:border-blue-800 dark:text-blue-300">
					{t('code.maplibreStyle')}
				</Badge>
				<Button size="sm" class="h-7 px-2 text-xs" onclick={() => (showStyleEditor = true)}>
					{t('code.editStyle')}
				</Button>
			{:else if jsonKind === 'tilejson'}
				<Badge variant="outline" class="hidden border-teal-200 text-teal-600 sm:inline-flex dark:border-teal-800 dark:text-teal-300">
					{t('code.tileJson')}
				</Badge>
			{/if}

			<!-- Desktop controls -->
			<div class="hidden items-center gap-1 sm:flex">
				<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={() => (wordWrap = !wordWrap)}>
					{wordWrap ? t('code.noWrap') : t('code.wrap')}
				</Button>
				<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={copyCode}>
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
						{#if jsonKind === 'maplibre-style'}
							<DropdownMenu.Item disabled>
								{t('code.maplibreStyle')}
							</DropdownMenu.Item>
						{:else if jsonKind === 'tilejson'}
							<DropdownMenu.Item disabled>
								{t('code.tileJson')}
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Item onclick={() => (wordWrap = !wordWrap)}>
							{wordWrap ? t('code.noWrap') : t('code.wrap')}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={copyCode}>
							{copied ? t('code.copied') : t('code.copy')}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
	</div>

	<div
		dir="ltr"
		class="code-viewer flex-1 overflow-auto"
		class:word-wrap={wordWrap}
	>
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-zinc-400">{t('code.loading')}</p>
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
		margin-inline-end: 1rem;
		text-align: right;
		color: var(--muted-foreground);
		user-select: none;
	}

	.code-viewer.word-wrap :global(pre) {
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
