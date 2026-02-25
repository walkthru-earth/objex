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
import { getUrlView, updateUrlView } from '$lib/utils/url-state.js';

let { tab }: { tab: Tab } = $props();

let html = $state('');
let rawCode = $state('');
let loading = $state(true);
let error = $state<string | null>(null);
let wordWrap = $state(false);
let copied = $state(false);
let formatted = $state(false);
const urlView = getUrlView();
let viewMode = $state<'code' | 'stac-browser' | 'kepler' | 'maputnik'>(
	urlView === 'stac-browser'
		? 'stac-browser'
		: urlView === 'kepler'
			? 'kepler'
			: urlView === 'maputnik'
				? 'maputnik'
				: 'code'
);

type JsonKind =
	| 'maplibre-style'
	| 'tilejson'
	| 'stac-catalog'
	| 'stac-collection'
	| 'stac-item'
	| 'kepler'
	| null;

/** Detect if JSON is a MapLibre style, TileJSON, STAC object, or Kepler.gl config */
function detectJsonKind(code: string): JsonKind {
	try {
		const obj = JSON.parse(code);
		if (obj && typeof obj === 'object') {
			if (obj.version === 8 && obj.sources && obj.layers) return 'maplibre-style';
			if (obj.tilejson && obj.tiles) return 'tilejson';
			if (obj.type === 'Catalog' && obj.stac_version) return 'stac-catalog';
			if (obj.type === 'Collection' && obj.stac_version) return 'stac-collection';
			if (obj.type === 'Feature' && obj.stac_version) return 'stac-item';
			if (obj.info?.app === 'kepler.gl' && obj.config) return 'kepler';
		}
	} catch {
		// not valid JSON
	}
	return null;
}

const ext = $derived(`.${tab.extension.toLowerCase()}`);
const lang = $derived(extensionToShikiLang(ext));
const jsonKind = $derived(ext === '.json' ? detectJsonKind(rawCode) : null);
const isStacJson = $derived(jsonKind?.startsWith('stac-') ?? false);
const stacBadgeKey = $derived<Record<string, string>>({
	'stac-catalog': 'code.stacCatalog',
	'stac-collection': 'code.stacCollection',
	'stac-item': 'code.stacItem'
});
const styleUrl = $derived(buildHttpsUrl(tab));
const stacBrowserSrc = $derived(
	`https://radiantearth.github.io/stac-browser/#/external/${styleUrl}`
);
const keplerSrc = $derived(`https://kepler.gl/demo?mapUrl=${encodeURIComponent(styleUrl)}`);
const maputnikSrc = $derived(
	`https://maplibre.org/maputnik/?style=${encodeURIComponent(styleUrl)}`
);

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

/** File types that support native formatting */
const canFormat = $derived(['.json', '.sql', '.css', '.html', '.xml'].includes(ext));

// Reset iframe view mode when tab changes (component reuse across code-type tabs)
let prevTabId = '';
$effect(() => {
	const id = tab.id;
	if (prevTabId && prevTabId !== id) {
		viewMode = 'code';
		updateUrlView('');
	}
	prevTabId = id;
});

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

async function toggleFormat() {
	if (formatted) {
		// Restore original
		html = await highlightCode(rawCode, lang);
		formatted = false;
		return;
	}

	let prettyCode = rawCode;
	try {
		if (ext === '.json') {
			prettyCode = JSON.stringify(JSON.parse(rawCode), null, 2);
		} else if (ext === '.sql') {
			const { format: formatSql } = await import('sql-formatter');
			prettyCode = formatSql(rawCode, { language: 'sql' });
		} else if (ext === '.css') {
			// Basic CSS pretty-print: newlines after { } ; and indent
			prettyCode = rawCode
				.replace(/\{/g, ' {\n  ')
				.replace(/;/g, ';\n  ')
				.replace(/\}/g, '\n}\n')
				.replace(/\n\s*\n/g, '\n')
				.trim();
		} else if (ext === '.html' || ext === '.xml') {
			// Basic XML/HTML indent
			let indent = 0;
			prettyCode = rawCode
				.replace(/>\s*</g, '>\n<')
				.split('\n')
				.map((line) => {
					const trimmed = line.trim();
					if (trimmed.startsWith('</')) indent = Math.max(0, indent - 1);
					const padded = '  '.repeat(indent) + trimmed;
					if (
						trimmed.startsWith('<') &&
						!trimmed.startsWith('</') &&
						!trimmed.endsWith('/>') &&
						!trimmed.startsWith('<!')
					)
						indent++;
					return padded;
				})
				.join('\n');
		}
	} catch {
		// If formatting fails, keep the original
		return;
	}

	html = await highlightCode(prettyCode, lang);
	formatted = true;
}

function setViewMode(mode: 'code' | 'stac-browser' | 'kepler' | 'maputnik') {
	viewMode = viewMode === mode ? 'code' : mode;
	updateUrlView(viewMode);
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
				<Button
					variant={viewMode === 'maputnik' ? 'default' : 'outline'}
					size="sm"
					class="h-7 gap-1 px-2 text-xs {viewMode !== 'maputnik' ? 'border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950' : ''}"
					onclick={() => setViewMode('maputnik')}
				>
					{viewMode === 'maputnik' ? t('code.code') : t('code.editStyle')}
				</Button>
			{:else if jsonKind === 'tilejson'}
				<Badge variant="outline" class="hidden border-teal-200 text-teal-600 sm:inline-flex dark:border-teal-800 dark:text-teal-300">
					{t('code.tileJson')}
				</Badge>
			{:else if isStacJson && jsonKind}
				<Badge variant="outline" class="hidden border-emerald-200 text-emerald-600 sm:inline-flex dark:border-emerald-800 dark:text-emerald-300">
					{t(stacBadgeKey[jsonKind] ?? 'code.stacItem')}
				</Badge>
				<Button
					variant={viewMode === 'stac-browser' ? 'default' : 'outline'}
					size="sm"
					class="h-7 gap-1 px-2 text-xs {viewMode !== 'stac-browser' ? 'border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950' : ''}"
					onclick={() => setViewMode('stac-browser')}
				>
					{viewMode === 'stac-browser' ? t('code.code') : t('code.browseStac')}
				</Button>
			{:else if jsonKind === 'kepler'}
				<Badge variant="outline" class="hidden border-violet-200 text-violet-600 sm:inline-flex dark:border-violet-800 dark:text-violet-300">
					{t('code.keplerGl')}
				</Badge>
				<Button
					variant={viewMode === 'kepler' ? 'default' : 'outline'}
					size="sm"
					class="h-7 gap-1 px-2 text-xs {viewMode !== 'kepler' ? 'border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950' : ''}"
					onclick={() => setViewMode('kepler')}
				>
					{viewMode === 'kepler' ? t('code.code') : t('code.openKepler')}
				</Button>
			{/if}

			<!-- Desktop controls -->
			<div class="hidden items-center gap-1 sm:flex">
				{#if canFormat}
					<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={toggleFormat}>
						{formatted ? t('code.raw') : t('code.format')}
					</Button>
				{/if}
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
							<DropdownMenu.Item onclick={() => setViewMode('maputnik')}>
								{viewMode === 'maputnik' ? t('code.code') : t('code.editStyle')}
							</DropdownMenu.Item>
						{:else if jsonKind === 'tilejson'}
							<DropdownMenu.Item disabled>
								{t('code.tileJson')}
							</DropdownMenu.Item>
						{:else if isStacJson && jsonKind}
							<DropdownMenu.Item disabled>
								{t(stacBadgeKey[jsonKind] ?? 'code.stacItem')}
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => setViewMode('stac-browser')}>
								{viewMode === 'stac-browser' ? t('code.code') : t('code.browseStac')}
							</DropdownMenu.Item>
						{:else if jsonKind === 'kepler'}
							<DropdownMenu.Item disabled>
								{t('code.keplerGl')}
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => setViewMode('kepler')}>
								{viewMode === 'kepler' ? t('code.code') : t('code.openKepler')}
							</DropdownMenu.Item>
						{/if}
						{#if canFormat}
							<DropdownMenu.Item onclick={toggleFormat}>
								{formatted ? t('code.raw') : t('code.format')}
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

	{#if viewMode === 'stac-browser'}
		<div class="flex-1 overflow-hidden">
			<iframe
				src={stacBrowserSrc}
				class="h-full w-full border-0"
				title="STAC Browser"
				allow="fullscreen"
			></iframe>
		</div>
	{:else if viewMode === 'kepler'}
		<div class="flex-1 overflow-hidden">
			<iframe
				src={keplerSrc}
				class="h-full w-full border-0"
				title="Kepler.gl"
				allow="fullscreen"
			></iframe>
		</div>
	{:else if viewMode === 'maputnik'}
		<div class="flex-1 overflow-hidden">
			<iframe
				src={maputnikSrc}
				class="h-full w-full border-0"
				title="Maputnik Style Editor"
				allow="clipboard-read; clipboard-write; fullscreen"
			></iframe>
		</div>
	{:else}
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
	{/if}
</div>

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
