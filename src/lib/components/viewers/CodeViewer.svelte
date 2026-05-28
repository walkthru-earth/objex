<script lang="ts">
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import {
	copyToClipboard,
	handleLoadError,
	isStacCatalog,
	isStacCollection,
	isStacItem
} from '@walkthru-earth/objex-utils';
import { onDestroy } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { extensionToShikiLang, highlightCode } from '$lib/utils/shiki';
import { buildHttpsUrl, buildHttpsUrlAsync, canStreamDirectly } from '$lib/utils/signed-url.js';
import { getUrlView, pickViewMode, updateUrlView } from '$lib/utils/url-state.js';
import { openZarrTab } from '$lib/utils/zarr-tab.js';
import ViewerHeader from './ViewerHeader.svelte';
import ViewerStatus from './ViewerStatus.svelte';

interface CodeActions {
	toggleFormat: () => Promise<void>;
	copyCode: () => Promise<void>;
	canFormat: boolean;
	formatted: boolean;
	copied: boolean;
}

let {
	tab,
	nested = false,
	wordWrap = $bindable(false),
	actions = $bindable<CodeActions | null>(null)
}: {
	tab: Tab;
	nested?: boolean;
	wordWrap?: boolean;
	actions?: CodeActions | null;
} = $props();

let abortController: AbortController | null = null;
let html = $state('');
let rawCode = $state('');
let loading = $state(true);
let error = $state<string | null>(null);
let copied = $state(false);
let formatted = $state(false);
const urlView = getUrlView();
type CodeViewMode = 'code' | 'render' | 'stac-browser' | 'kepler' | 'maputnik' | 'marimo';
const CODE_VIEW_MODES = [
	'code',
	'render',
	'stac-browser',
	'kepler',
	'maputnik',
	'marimo'
] as const satisfies readonly CodeViewMode[];
function getInitialViewMode(): CodeViewMode {
	const explicit = pickViewMode<CodeViewMode>(CODE_VIEW_MODES, 'code');
	if (explicit !== 'code' || urlView === 'code') return explicit;
	// No (or unknown) hash: default to render for HTML, code otherwise.
	return tab.extension.toLowerCase() === 'html' ? 'render' : 'code';
}
let viewMode = $state(getInitialViewMode());

type JsonKind =
	| 'maplibre-style'
	| 'tilejson'
	| 'stac-catalog'
	| 'stac-collection'
	| 'stac-item'
	| 'kepler'
	| 'zarr-v2'
	| 'zarr-v3'
	| null;

/** Detect if a .py file is a marimo notebook (first 512 bytes contain both markers) */
function isMarimoNotebook(code: string): boolean {
	const header = code.slice(0, 512);
	return header.includes('import marimo') && header.includes('marimo.App');
}

/** Detect if a .md file is a marimo notebook (first 512 bytes contain marimo-version:) */
function isMarimoMarkdown(code: string): boolean {
	const header = code.slice(0, 512);
	return header.includes('marimo-version:');
}

/** Detect if JSON is a MapLibre style, TileJSON, STAC object, or Kepler.gl config */
function detectJsonKind(code: string): JsonKind {
	try {
		const obj = JSON.parse(code);
		if (obj && typeof obj === 'object') {
			if (obj.version === 8 && obj.sources && obj.layers) return 'maplibre-style';
			if (obj.tilejson && obj.tiles) return 'tilejson';
			if (isStacCatalog(obj)) return 'stac-catalog';
			if (isStacCollection(obj)) return 'stac-collection';
			if (isStacItem(obj)) return 'stac-item';
			if (obj.info?.app === 'kepler.gl' && obj.config) return 'kepler';
			if (obj.zarr_format === 3) return 'zarr-v3';
			if (obj.zarr_format === 2) return 'zarr-v2';
		}
	} catch {
		// not valid JSON
	}
	return null;
}

const ext = $derived(`.${tab.extension.toLowerCase()}`);
const isHtml = $derived(ext === '.html');
const lang = $derived(extensionToShikiLang(ext));
const jsonKind = $derived(ext === '.json' ? detectJsonKind(rawCode) : null);
const isStacJson = $derived(jsonKind?.startsWith('stac-') ?? false);
const stacBadgeKey = $derived<Record<string, string>>({
	'stac-catalog': 'code.stacCatalog',
	'stac-collection': 'code.stacCollection',
	'stac-item': 'code.stacItem'
});
// Third-party iframes can't route through the storage adapter, so the URL
// must carry auth. Public/SAS connections resolve synchronously; `signed-s3`
// must wait for the presign so the iframe never loads a bare `s3://` href.
let styleUrl = $state('');
$effect(() => {
	const id = tab.id;
	styleUrl = canStreamDirectly(tab) ? buildHttpsUrl(tab) : '';
	let cancelled = false;
	(async () => {
		const url = await buildHttpsUrlAsync(tab);
		if (cancelled || id !== tab.id) return;
		styleUrl = url;
	})();
	return () => {
		cancelled = true;
	};
});
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

const isMarimo = $derived(
	(ext === '.py' && isMarimoNotebook(rawCode)) ||
		((ext === '.md' || ext === '.qmd') && isMarimoMarkdown(rawCode))
);

let marimoSrc = $state('');
let htmlBlobUrl = $state('');

const language = $derived(languageMap[ext] ?? 'Plain Text');

/** File types that support native formatting */
const canFormat = $derived(['.json', '.sql', '.css', '.html', '.xml'].includes(ext));

// Expose imperative actions to the parent so a shared outer toolbar (e.g. the
// one rendered by StacTabViewer when nested) can invoke Format/Wrap/Copy
// without duplicating the text state.
$effect(() => {
	actions = {
		toggleFormat,
		copyCode,
		canFormat,
		formatted,
		copied
	};
});

// Auto-switch to STAC Browser when STAC JSON is detected and the user did NOT
// request a specific view via the URL hash. Any explicit hash (#map, #stac-map,
// #stac-browser, #code, …) MUST be honored, because while ViewerRouter's async
// detectStac is pending it falls back to plain CodeViewer for .json tabs;
// rewriting the hash here would race the eventual StacTabViewer mount and
// clobber the shared link the user opened.
// Skipped when nested in StacTabViewer since the outer wrapper owns the view toggle.
let stacAutoSwitched = false;
$effect(() => {
	if (nested) return;
	if (isStacJson && !stacAutoSwitched && viewMode === 'code' && !urlView) {
		stacAutoSwitched = true;
		viewMode = 'stac-browser';
		updateUrlView('stac-browser');
	}
});

// Reset iframe view mode when tab changes (component reuse across code-type tabs)
let prevTabId = '';
$effect(() => {
	const id = tab.id;
	if (prevTabId && prevTabId !== id) {
		viewMode = isHtml ? 'render' : 'code';
		stacAutoSwitched = false;
		updateUrlView('');
	}
	prevTabId = id;
});

function cleanup() {
	abortController?.abort();
	abortController = null;
}

$effect(() => {
	if (!tab) return;
	const unregister = tabResources.register(tab.id, cleanup);
	return unregister;
});
onDestroy(cleanup);

$effect(() => {
	if (!tab) return;
	loadCode();
});

async function loadCode() {
	abortController?.abort();
	abortController = new AbortController();
	const { signal } = abortController;

	loading = true;
	error = null;

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path, undefined, undefined, signal);
		rawCode = new TextDecoder().decode(data);
		html = await highlightCode(rawCode, lang);
	} catch (err) {
		const msg = handleLoadError(err);
		if (msg === null) return;
		error = msg;
	} finally {
		loading = false;
	}
}

// Build marimo playground URL when marimo notebook is detected
$effect(() => {
	if (!isMarimo || !rawCode) {
		marimoSrc = '';
		return;
	}
	import('lz-string').then(({ compressToEncodedURIComponent }) => {
		const compressed = compressToEncodedURIComponent(rawCode);
		marimoSrc = `https://marimo.app?embed=true&mode=read#code/${compressed}`;
	});
});

// Build blob URL for HTML rendering
// Only reads isHtml + rawCode as dependencies; cleanup revokes via captured local ref
$effect(() => {
	if (!isHtml || !rawCode) {
		htmlBlobUrl = '';
		return;
	}
	const blob = new Blob([rawCode], { type: 'text/html' });
	const url = URL.createObjectURL(blob);
	htmlBlobUrl = url;

	return () => URL.revokeObjectURL(url);
});

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

function setViewMode(mode: CodeViewMode) {
	viewMode = viewMode === mode ? (isHtml ? 'render' : 'code') : mode;
	updateUrlView(viewMode === 'render' ? '' : viewMode);
}

async function copyCode() {
	await copyToClipboard(rawCode, (v) => (copied = v));
}
</script>

<div class="flex h-full flex-col">
	{#if !nested}
	<ViewerHeader {tab}>
		{#snippet badge()}<Badge variant="secondary">{language}</Badge>{/snippet}
		{#snippet actions()}
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
				{#if !nested}
					<Button
						variant={viewMode === 'stac-browser' ? 'default' : 'outline'}
						size="sm"
						class="h-7 gap-1 px-2 text-xs {viewMode !== 'stac-browser' ? 'border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950' : ''}"
						onclick={() => setViewMode('stac-browser')}
					>
						{viewMode === 'stac-browser' ? t('code.code') : t('code.browseStac')}
					</Button>
				{/if}
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
			{:else if jsonKind === 'zarr-v3' || jsonKind === 'zarr-v2'}
				<Badge variant="outline" class="hidden border-purple-200 text-purple-600 sm:inline-flex dark:border-purple-800 dark:text-purple-300">
					{jsonKind === 'zarr-v3' ? 'Zarr v3' : 'Zarr v2'}
				</Badge>
				<Button
					variant="outline"
					size="sm"
					class="h-7 gap-1 px-2 text-xs border-purple-300 text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:border-purple-700 dark:text-purple-400 dark:hover:bg-purple-950"
					onclick={() => {
						const parentPath = tab.path.replace(/[^/]+$/, '');
						openZarrTab(parentPath, {
							source: tab.source as 'remote' | 'url',
							connectionId: tab.connectionId
						});
					}}
				>
					{t('fileBrowser.openAsZarr')}
				</Button>
			{/if}

			{#if isMarimo}
				<Badge variant="outline" class="hidden border-green-200 text-green-600 sm:inline-flex dark:border-green-800 dark:text-green-300">
					{t('code.marimoNotebook')}
				</Badge>
				<Button
					variant={viewMode === 'marimo' ? 'default' : 'outline'}
					size="sm"
					class="h-7 gap-1 px-2 text-xs {viewMode !== 'marimo' ? 'border-green-300 text-green-600 hover:bg-green-50 hover:text-green-700 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950' : ''}"
					onclick={() => setViewMode('marimo')}
				>
					{viewMode === 'marimo' ? t('code.code') : t('code.openPlayground')}
				</Button>
			{/if}

			{#if isHtml}
				<Button
					variant={viewMode === 'code' ? 'default' : 'outline'}
					size="sm"
					class="h-7 gap-1 px-2 text-xs"
					onclick={() => setViewMode('code')}
				>
					{viewMode === 'code' ? t('code.preview') : t('code.viewSource')}
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
						{#if isMarimo}
							<DropdownMenu.Item disabled>
								{t('code.marimoNotebook')}
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => setViewMode('marimo')}>
								{viewMode === 'marimo' ? t('code.code') : t('code.openPlayground')}
							</DropdownMenu.Item>
						{/if}
						{#if isHtml}
							<DropdownMenu.Item onclick={() => setViewMode('code')}>
								{viewMode === 'code' ? t('code.preview') : t('code.viewSource')}
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
		{/snippet}
	</ViewerHeader>
	{/if}

	{#if viewMode === 'stac-browser' && styleUrl}
		<div class="flex-1 overflow-hidden">
			<iframe
				src={stacBrowserSrc}
				class="h-full w-full border-0"
				title="STAC Browser"
				allow="fullscreen"
			></iframe>
		</div>
	{:else if viewMode === 'kepler' && styleUrl}
		<div class="flex-1 overflow-hidden">
			<iframe
				src={keplerSrc}
				class="h-full w-full border-0"
				title="Kepler.gl"
				allow="fullscreen"
			></iframe>
		</div>
	{:else if viewMode === 'maputnik' && styleUrl}
		<div class="flex-1 overflow-hidden">
			<iframe
				src={maputnikSrc}
				class="h-full w-full border-0"
				title="Maputnik Style Editor"
				allow="clipboard-read; clipboard-write; fullscreen"
			></iframe>
		</div>
	{:else if viewMode === 'render' && htmlBlobUrl}
		<div class="flex-1 overflow-hidden">
			<iframe
				src={htmlBlobUrl}
				class="h-full w-full border-0"
				title={tab.name}
				sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
			></iframe>
		</div>
	{:else if viewMode === 'marimo' && marimoSrc}
		<div class="flex-1 overflow-hidden">
			<iframe
				src={marimoSrc}
				class="h-full w-full border-0"
				title="marimo Playground"
				sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
				allow="fullscreen"
			></iframe>
		</div>
	{:else}
		<div
			dir="ltr"
			class="code-viewer flex-1 overflow-auto"
			class:word-wrap={wordWrap}
		>
			{#if loading}
				<ViewerStatus kind="loading" message={t('code.loading')} />
			{:else if error}
				<ViewerStatus kind="error" message={error} />
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
