<script lang="ts">
import { Archive, ChevronRight, Download, File, Folder, Loader } from '@lucide/svelte';
import type { Entry } from '@zip.js/zip.js';
import { onDestroy, untrack } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import {
	ResizableHandle,
	ResizablePane,
	ResizablePaneGroup
} from '$lib/components/ui/resizable/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import {
	type ArchiveEntry,
	type ArchiveFormat,
	clampPrefix,
	decompressGzip,
	detectArchiveFormat,
	downloadTarEntryFromBuffer,
	downloadTarEntryFromUrl,
	downloadZipEntry,
	listContents,
	readTarEntriesFromBuffer,
	readZipEntriesFromBuffer,
	streamTarEntriesFromUrl,
	streamTarGzEntriesFromUrl,
	streamZipEntriesFromUrl
} from '$lib/utils/archive';
import { formatFileSize } from '$lib/utils/format';
import { buildHttpsUrl } from '$lib/utils/url.js';

let { tab }: { tab: Tab } = $props();

const MAX_ITEMS = 500;

// ── State ──────────────────────────────────────────────────────────────

let error = $state<string | null>(null);
let entryList = $state<ArchiveEntry[]>([]);
let prefix = $state('');
let loadMethod = $state<'range' | 'full' | ''>('');
let format = $state<ArchiveFormat>('unsupported');
let downloading = $state<Set<string>>(new Set());
let remoteUrl = $state('');
let tarBuffer = $state<Uint8Array | null>(null);
let initializing = $state(true);
let scanning = $state(false);
let scanCount = $state(0);

// Column browser state
let selectedDir = $state<string | null>(null);
let selectedFile = $state<ArchiveEntry | null>(null);

let zipEntryMap = new Map<string, Entry>();
let abortController: AbortController | null = null;

// Derived listing — column 1
let contents = $derived.by(() => {
	void scanCount;
	return listContents(entryList, prefix);
});

// Column 2 — contents of selected directory
let selectedDirContents = $derived.by(() => {
	if (!selectedDir) return { directories: [] as string[], files: [] as ArchiveEntry[] };
	void scanCount;
	return listContents(entryList, selectedDir);
});

let breadcrumbs = $derived(prefix.length > 0 ? prefix.split('/').filter(Boolean) : []);

// Reset selections when prefix changes
$effect(() => {
	void prefix;
	selectedDir = null;
	selectedFile = null;
});

// ── Lifecycle ──────────────────────────────────────────────────────────

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loadArchive();
	});
});

function cleanup() {
	abortController?.abort();
	entryList = [];
	zipEntryMap.clear();
	tarBuffer = null;
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);

// ── Navigation ─────────────────────────────────────────────────────────

function navigateTo(newPrefix: string) {
	prefix = clampPrefix(newPrefix);
}

function breadcrumbPath(index: number): string {
	return breadcrumbs.slice(0, index + 1).join('/');
}

function selectDirectory(dir: string) {
	selectedDir = dir;
	selectedFile = null;
}

function selectFile(file: ArchiveEntry) {
	selectedFile = file;
}

function navigateIntoDir(dir: string) {
	navigateTo(dir);
}

// ── Loading ────────────────────────────────────────────────────────────

function resetState() {
	abortController?.abort();
	abortController = new AbortController();
	error = null;
	prefix = '';
	entryList = [];
	scanCount = 0;
	zipEntryMap.clear();
	tarBuffer = null;
	remoteUrl = '';
	initializing = true;
	scanning = false;
	selectedDir = null;
	selectedFile = null;
}

function pushEntries(batch: ArchiveEntry[]) {
	entryList.push(...batch);
	scanCount = entryList.length;
	if (initializing) initializing = false;
}

async function loadArchive() {
	resetState();

	try {
		format = detectArchiveFormat(tab.name);

		if (format === 'zip') {
			await loadZip();
		} else if (format === 'tar') {
			await loadTar();
		} else if (format === 'tar.gz') {
			await loadTarGz();
		} else {
			error = t('archive.unsupported');
		}
	} catch (err) {
		if ((err as DOMException)?.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
	} finally {
		scanning = false;
		if (initializing) initializing = false;
	}
}

async function loadZip() {
	const signal = abortController!.signal;

	if (tab.source === 'remote') {
		const url = buildHttpsUrl(tab);
		try {
			scanning = true;
			for await (const batch of streamZipEntriesFromUrl(url, signal)) {
				for (const ze of batch.zipEntries) zipEntryMap.set(ze.filename, ze);
				pushEntries(batch.archiveEntries);
			}
			loadMethod = 'range';
			return;
		} catch (err) {
			if ((err as DOMException)?.name === 'AbortError') throw err;
			entryList = [];
			scanCount = 0;
			zipEntryMap.clear();
			scanning = false;
		}
	}

	const adapter = getAdapter(tab.source, tab.connectionId);
	const data = await adapter.read(tab.path);
	const result = await readZipEntriesFromBuffer(data);
	for (const e of result.entries) zipEntryMap.set(e.filename, e);
	entryList = result.entryList;
	scanCount = entryList.length;
	loadMethod = 'full';
}

async function loadTar() {
	const signal = abortController!.signal;

	if (tab.source === 'remote') {
		const url = buildHttpsUrl(tab);
		try {
			scanning = true;
			remoteUrl = url;
			for await (const batch of streamTarEntriesFromUrl(url, signal)) {
				pushEntries(batch);
			}
			loadMethod = 'range';
			return;
		} catch (err) {
			if ((err as DOMException)?.name === 'AbortError') throw err;
			entryList = [];
			scanCount = 0;
			remoteUrl = '';
			scanning = false;
		}
	}

	const adapter = getAdapter(tab.source, tab.connectionId);
	const data = await adapter.read(tab.path);
	const result = readTarEntriesFromBuffer(data);
	entryList = result.entryList;
	scanCount = entryList.length;
	tarBuffer = data;
	loadMethod = 'full';
}

async function loadTarGz() {
	const signal = abortController!.signal;

	// For remote URLs: stream-fetch → decompress → parse progressively
	if (tab.source === 'remote' || tab.source === 'url') {
		const url = buildHttpsUrl(tab);
		try {
			scanning = true;
			const decompressedChunks: Uint8Array[] = [];
			for await (const { entries, chunk } of streamTarGzEntriesFromUrl(url, signal)) {
				pushEntries(entries);
				decompressedChunks.push(chunk);
			}
			// Assemble decompressed buffer for file downloads
			const totalLen = decompressedChunks.reduce((sum, c) => sum + c.length, 0);
			const assembled = new Uint8Array(totalLen);
			let pos = 0;
			for (const c of decompressedChunks) {
				assembled.set(c, pos);
				pos += c.length;
			}
			tarBuffer = assembled;
			loadMethod = 'full';
			return;
		} catch (err) {
			if ((err as DOMException)?.name === 'AbortError') throw err;
			// Fall through to full-buffer approach
			entryList = [];
			scanCount = 0;
			scanning = false;
		}
	}

	// Fallback: full download + in-memory decompress
	const adapter = getAdapter(tab.source, tab.connectionId);
	const compressed = await adapter.read(tab.path);
	const data = await decompressGzip(compressed);
	const result = readTarEntriesFromBuffer(data);
	entryList = result.entryList;
	scanCount = entryList.length;
	tarBuffer = data;
	loadMethod = 'full';
}

// ── Download ───────────────────────────────────────────────────────────

async function handleDownload(archiveEntry: ArchiveEntry) {
	if (archiveEntry.directory) return;
	const key = archiveEntry.filename;
	if (downloading.has(key)) return;

	downloading = new Set([...downloading, key]);
	try {
		if (format === 'zip') {
			const zipEntry = zipEntryMap.get(key);
			if (zipEntry) await downloadZipEntry(zipEntry);
		} else if (format === 'tar' && remoteUrl) {
			await downloadTarEntryFromUrl(remoteUrl, archiveEntry);
		} else if ((format === 'tar' || format === 'tar.gz') && tarBuffer) {
			downloadTarEntryFromBuffer(tarBuffer, archiveEntry);
		}
	} finally {
		const next = new Set(downloading);
		next.delete(key);
		downloading = next;
	}
}

const formatLabel = $derived(format === 'tar.gz' ? 'TAR.GZ' : format.toUpperCase());
const totalDirs = $derived(contents.directories.length);
const totalFiles = $derived(contents.files.length);
</script>

{#snippet fileDetails()}
	{#if selectedFile}
		{@const fileName = selectedFile.filename.split('/').pop()}
		<div
			class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
		>
			{t('archive.fileDetails')}
		</div>
		<div class="flex-1 overflow-auto p-3">
			<dl class="space-y-2 text-xs">
				<div>
					<dt class="text-muted-foreground">{t('archive.fileName')}</dt>
					<dd class="break-all font-mono text-[11px]">{fileName}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">{t('archive.path')}</dt>
					<dd class="break-all font-mono text-[10px] text-muted-foreground">{selectedFile.filename}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">{t('archive.size')}</dt>
					<dd>{formatFileSize(selectedFile.uncompressedSize)}</dd>
				</div>
				{#if selectedFile.compressedSize > 0 && selectedFile.compressedSize !== selectedFile.uncompressedSize}
					<div>
						<dt class="text-muted-foreground">{t('archive.compressed')}</dt>
						<dd>{formatFileSize(selectedFile.compressedSize)}</dd>
					</div>
				{/if}
				{#if selectedFile.lastModified}
					<div>
						<dt class="text-muted-foreground">{t('archive.modified')}</dt>
						<dd class="text-[11px]">{selectedFile.lastModified.toLocaleString()}</dd>
					</div>
				{/if}
			</dl>

			<button
				class="mt-4 w-full rounded bg-primary/90 px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40"
				onclick={() => handleDownload(selectedFile!)}
				disabled={downloading.has(selectedFile.filename)}
			>
				{#if downloading.has(selectedFile.filename)}
					<Loader class="mr-1 inline-block h-3 w-3 animate-spin" />
					Downloading...
				{:else}
					<Download class="mr-1 inline-block h-3 w-3" />
					{t('archive.download')}
				{/if}
			</button>
		</div>
	{:else}
		<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
			{t('archive.selectFile')}
		</div>
	{/if}
{/snippet}

<div class="flex h-full flex-col">
	<!-- Header bar -->
	<div class="shrink-0 border-b border-zinc-200 px-3 py-2 sm:px-4 dark:border-zinc-800">
		<div class="flex items-center gap-1.5 sm:gap-2">
			<Archive class="h-4 w-4 shrink-0 text-amber-500" />
			<span class="max-w-[140px] truncate text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">
				{tab.name}
			</span>
			<Badge variant="outline" class="text-[10px]">{formatLabel}</Badge>

			{#if scanCount > 0}
				<span class="text-xs text-muted-foreground">
					{scanCount.toLocaleString()} {t('archive.entries')}
				</span>
			{/if}

			{#if scanning}
				<span class="flex items-center gap-1 text-xs text-amber-500">
					<Loader class="h-3 w-3 animate-spin" />
					<span class="hidden sm:inline">{t('archive.scanning')}</span>
				</span>
			{/if}

			{#if loadMethod === 'range' && !scanning}
				<Badge variant="outline" class="border-emerald-200 text-[10px] text-emerald-600 dark:border-emerald-800 dark:text-emerald-400">
					{t('archive.streamed')}
				</Badge>
			{:else if loadMethod === 'full' && format === 'tar.gz' && !scanning}
				<Badge variant="outline" class="border-amber-200 text-[10px] text-amber-600 dark:border-amber-800 dark:text-amber-400">
					{t('archive.fullDownload')}
				</Badge>
			{/if}
		</div>

		<!-- Breadcrumb -->
		{#if breadcrumbs.length > 0}
			<nav class="mt-1.5">
				<ol class="flex flex-wrap items-center gap-1 text-xs">
					<li>
						<button
							class="text-muted-foreground hover:text-foreground"
							onclick={() => navigateTo('')}
						>
							<Archive class="inline-block h-3 w-3" />
						</button>
					</li>
					{#each breadcrumbs as crumb, i}
						<li class="flex items-center gap-1">
							<ChevronRight class="h-3 w-3 text-muted-foreground/50" />
							{#if i === breadcrumbs.length - 1}
								<span class="font-medium">{crumb}</span>
							{:else}
								<button
									class="text-muted-foreground hover:text-foreground"
									onclick={() => navigateTo(breadcrumbPath(i))}
								>
									{crumb}
								</button>
							{/if}
						</li>
					{/each}
				</ol>
			</nav>
		{/if}
	</div>

	<!-- Content area -->
	{#if initializing}
		<div class="flex flex-1 items-center justify-center gap-2">
			<Loader class="h-5 w-5 animate-spin text-zinc-400" />
			<span class="text-sm text-zinc-400">{t('archive.loading')}</span>
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center px-4">
			<p class="text-sm text-red-400">{error}</p>
		</div>
	{:else}
		<!-- Column browser (resizable) -->
		<ResizablePaneGroup direction="horizontal" class="min-h-0 flex-1">
			<!-- Column 1: Current path entries -->
			<ResizablePane defaultSize={35} minSize={20}>
				<div class="flex h-full flex-col">
					<div
						class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
					>
						{t('archive.contents')}
						<span class="ms-1 normal-case tracking-normal">({(totalDirs + totalFiles).toLocaleString()})</span>
					</div>
					<div class="flex-1 overflow-auto">
						{#if contents.directories.length === 0 && contents.files.length === 0 && !scanning}
							<div class="p-4 text-center text-xs text-muted-foreground">
								{t('archive.empty')}
							</div>
						{/if}

						{#each contents.directories as dir, i}
							{#if i < MAX_ITEMS}
								{@const dirName = dir.split('/').pop()}
								<button
									class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
									class:bg-zinc-100={selectedDir === dir}
									class:dark:bg-zinc-800={selectedDir === dir}
									onclick={() => selectDirectory(dir)}
									ondblclick={() => navigateIntoDir(dir)}
								>
									<Folder class="size-3.5 shrink-0 text-amber-500/70" />
									<span class="truncate font-medium">{dirName}</span>
									<ChevronRight class="ms-auto size-3 shrink-0 text-muted-foreground" />
								</button>
							{:else if i === MAX_ITEMS}
								<div class="px-3 py-1.5 text-[10px] text-muted-foreground">
									+{contents.directories.length - MAX_ITEMS} more
								</div>
							{/if}
						{/each}

						{#each contents.files as file, i}
							{#if i < MAX_ITEMS}
								{@const fileName = file.filename.split('/').pop()}
								<button
									class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
									class:bg-zinc-100={selectedFile?.filename === file.filename}
									class:dark:bg-zinc-800={selectedFile?.filename === file.filename}
									onclick={() => selectFile(file)}
								>
									<File class="size-3.5 shrink-0 text-muted-foreground/70" />
									<span class="truncate">{fileName}</span>
									<span class="ms-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
										{formatFileSize(file.uncompressedSize)}
									</span>
								</button>
							{:else if i === MAX_ITEMS}
								<div class="px-3 py-1.5 text-[10px] text-muted-foreground">
									+{contents.files.length - MAX_ITEMS} more
								</div>
							{/if}
						{/each}

						{#if scanning}
							<div class="flex items-center gap-2 px-3 py-2 text-[10px] text-muted-foreground">
								<Loader class="h-3 w-3 animate-spin" />
								<span>{t('archive.scanningProgress', { count: scanCount.toLocaleString() })}</span>
							</div>
						{/if}
					</div>
				</div>
			</ResizablePane>

			<ResizableHandle />

			<!-- Column 2: Selected directory contents -->
			<ResizablePane defaultSize={35} minSize={20}>
				<div class="flex h-full flex-col">
					{#if selectedDir}
						{@const dirName = selectedDir.split('/').pop()}
						<div
							class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
						>
							{dirName}
							<span class="ms-1 normal-case tracking-normal">({(selectedDirContents.directories.length + selectedDirContents.files.length).toLocaleString()})</span>
						</div>
						<div class="flex-1 overflow-auto">
							{#if selectedDirContents.directories.length === 0 && selectedDirContents.files.length === 0}
								<div class="p-4 text-center text-xs text-muted-foreground">
									{t('archive.empty')}
								</div>
							{/if}

							{#each selectedDirContents.directories as subDir, i}
								{#if i < MAX_ITEMS}
									{@const subDirName = subDir.split('/').pop()}
									<button
										class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
										onclick={() => navigateIntoDir(subDir)}
									>
										<Folder class="size-3.5 shrink-0 text-amber-500/70" />
										<span class="truncate font-medium">{subDirName}</span>
										<ChevronRight class="ms-auto size-3 shrink-0 text-muted-foreground" />
									</button>
								{/if}
							{/each}

							{#each selectedDirContents.files as file, i}
								{#if i < MAX_ITEMS}
									{@const fileName = file.filename.split('/').pop()}
									<button
										class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
										class:bg-zinc-100={selectedFile?.filename === file.filename}
										class:dark:bg-zinc-800={selectedFile?.filename === file.filename}
										onclick={() => selectFile(file)}
									>
										<File class="size-3.5 shrink-0 text-muted-foreground/70" />
										<span class="truncate">{fileName}</span>
										<span class="ms-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
											{formatFileSize(file.uncompressedSize)}
										</span>
									</button>
								{/if}
							{/each}
						</div>
					{:else}
						<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
							{t('archive.selectFolder')}
						</div>
					{/if}
				</div>
			</ResizablePane>

			<ResizableHandle />

			<!-- Column 3: File details -->
			<ResizablePane defaultSize={30} minSize={15}>
				<div class="flex h-full flex-col">
					{@render fileDetails()}
				</div>
			</ResizablePane>
		</ResizablePaneGroup>
	{/if}
</div>
