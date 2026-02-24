<script lang="ts">
import { Archive, ChevronRight, Download, File, Folder, Loader } from '@lucide/svelte';
import type { Entry } from '@zip.js/zip.js';
import { onDestroy, untrack } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
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
	streamZipEntriesFromUrl
} from '$lib/utils/archive';
import { formatFileSize } from '$lib/utils/format';
import { buildHttpsUrl } from '$lib/utils/url.js';

let { tab }: { tab: Tab } = $props();

const MAX_DIRS = 500;
const MAX_FILES = 500;

// ── State ──────────────────────────────────────────────────────────────

let error = $state<string | null>(null);
let entryList = $state<ArchiveEntry[]>([]);
let prefix = $state('');
let loadMethod = $state<'range' | 'full' | ''>('');
let format = $state<ArchiveFormat>('unsupported');
let downloading = $state<Set<string>>(new Set());
let remoteUrl = $state('');
let tarBuffer = $state<Uint8Array | null>(null);

/** true while the initial setup/fetch is happening (before any entries appear) */
let initializing = $state(true);
/** true while entries are still being discovered (progressive scan) */
let scanning = $state(false);
/** number of entries found so far — drives reactivity for the listing */
let scanCount = $state(0);

// ZIP entry lookup for downloads (non-reactive, just a Map)
let zipEntryMap = new Map<string, Entry>();
let abortController: AbortController | null = null;

// Derived listing — re-evaluates when scanCount or prefix changes
let contents = $derived.by(() => {
	void scanCount; // explicit dependency on scan progress
	return listContents(entryList, prefix);
});
let breadcrumbs = $derived(prefix.length > 0 ? prefix.split('/').filter(Boolean) : []);

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
}

/** Push a batch of entries and trigger a reactive update */
function pushEntries(batch: ArchiveEntry[]) {
	entryList.push(...batch);
	scanCount = entryList.length;
	// Once we have any entries, we're past the "initializing" spinner phase
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
			// Range requests failed — fall back to full download
			entryList = [];
			scanCount = 0;
			zipEntryMap.clear();
			scanning = false;
		}
	}

	// Buffer fallback — parsing in-memory is fast, no streaming needed
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
	// tar.gz requires full download — gzip has no random access
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
</script>

<div class="flex h-full flex-col">
	<!-- Header bar -->
	<div class="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800">
		<Archive class="h-4 w-4 shrink-0 text-amber-500" />
		<span class="max-w-[140px] truncate text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">
			{tab.name}
		</span>
		<Badge variant="secondary">{t('archive.badge')}</Badge>

		{#if scanCount > 0}
			<span class="text-xs text-zinc-400">
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
			<Badge variant="outline" class="border-emerald-200 text-emerald-600 dark:border-emerald-800 dark:text-emerald-400">
				{t('archive.streamed')}
			</Badge>
		{:else if loadMethod === 'full' && format === 'tar.gz' && !scanning}
			<Badge variant="outline" class="border-amber-200 text-amber-600 dark:border-amber-800 dark:text-amber-400">
				{t('archive.fullDownload')}
			</Badge>
		{/if}

		{#if format !== 'zip' && format !== 'unsupported'}
			<span class="hidden text-[10px] uppercase tracking-wider text-zinc-400 sm:inline">{format}</span>
		{/if}
	</div>

	<!-- Content area -->
	<div class="flex-1 overflow-auto">
		{#if initializing}
			<!-- Full-page spinner only before first entries arrive -->
			<div class="flex h-full items-center justify-center gap-2">
				<Loader class="h-5 w-5 animate-spin text-zinc-400" />
				<span class="text-sm text-zinc-400">{t('archive.loading')}</span>
			</div>
		{:else if error}
			<div class="flex h-full items-center justify-center px-4">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else}
			<!-- Breadcrumbs -->
			<nav class="border-b border-zinc-100 px-3 py-2 sm:px-4 dark:border-zinc-800/60">
				<ol class="flex flex-wrap items-center gap-1 text-sm">
					<li class="shrink-0">
						{#if breadcrumbs.length > 0}
							<button
								class="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
								onclick={() => navigateTo('')}
							>
								<Archive class="inline-block h-3.5 w-3.5" />
								<span class="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500 dark:decoration-zinc-600 dark:hover:decoration-zinc-400">{tab.name}</span>
							</button>
						{:else}
							<span class="text-zinc-600 dark:text-zinc-300">
								<Archive class="inline-block h-3.5 w-3.5" />
								{tab.name}
							</span>
						{/if}
					</li>
					{#each breadcrumbs as crumb, i}
						<li class="flex items-center gap-1">
							<ChevronRight class="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
							{#if i === breadcrumbs.length - 1}
								<span class="text-zinc-600 dark:text-zinc-300">{crumb}</span>
							{:else}
								<button
									class="text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-700 hover:decoration-zinc-500 dark:text-zinc-400 dark:decoration-zinc-600 dark:hover:text-zinc-200 dark:hover:decoration-zinc-400"
									onclick={() => navigateTo(breadcrumbPath(i))}
								>
									{crumb}
								</button>
							{/if}
						</li>
					{/each}
				</ol>
			</nav>

			<!-- File listing -->
			<div class="divide-y divide-zinc-50 dark:divide-zinc-800/40">
				{#if contents.directories.length === 0 && contents.files.length === 0 && !scanning}
					<div class="px-4 py-8 text-center text-sm text-zinc-400">
						{t('archive.empty')}
					</div>
				{/if}

				<!-- Directories -->
				{#each contents.directories as dir, i}
					{#if i < MAX_DIRS}
						{@const dirName = dir.split('/').pop()}
						<button
							class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-800/50"
							onclick={() => navigateTo(dir)}
						>
							<Folder class="h-4 w-4 shrink-0 text-amber-500/70" />
							<span class="truncate font-medium text-zinc-700 dark:text-zinc-300">{dirName}</span>
							<ChevronRight class="ms-auto h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
						</button>
					{:else if i === MAX_DIRS}
						<div class="px-4 py-1.5 text-xs text-zinc-400">
							+{contents.directories.length - MAX_DIRS} more directories
						</div>
					{/if}
				{/each}

				<!-- Files -->
				{#each contents.files as file, i}
					{#if i < MAX_FILES}
						{@const fileName = file.filename.split('/').pop()}
						<div class="flex items-center gap-2 px-3 py-1.5 text-sm sm:px-4">
							<File class="h-4 w-4 shrink-0 text-zinc-400/70" />
							<span class="truncate text-zinc-600 dark:text-zinc-400">{fileName}</span>
							<span class="ms-auto shrink-0 text-xs text-zinc-400">
								{formatFileSize(file.uncompressedSize)}
							</span>
							<button
								class="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
								onclick={() => handleDownload(file)}
								disabled={downloading.has(file.filename)}
								title="Download"
							>
								{#if downloading.has(file.filename)}
									<Loader class="h-3.5 w-3.5 animate-spin" />
								{:else}
									<Download class="h-3.5 w-3.5" />
								{/if}
							</button>
						</div>
					{:else if i === MAX_FILES}
						<div class="px-4 py-1.5 text-xs text-zinc-400">
							+{contents.files.length - MAX_FILES} more files
						</div>
					{/if}
				{/each}

				<!-- Scanning progress at bottom of listing -->
				{#if scanning}
					<div class="flex items-center gap-2 px-4 py-3 text-xs text-zinc-400">
						<Loader class="h-3 w-3 animate-spin" />
						<span>{t('archive.scanningProgress', { count: scanCount.toLocaleString() })}</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
