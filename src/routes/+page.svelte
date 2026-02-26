<script lang="ts">
import CheckIcon from '@lucide/svelte/icons/check';
import CloudIcon from '@lucide/svelte/icons/cloud';
import CopyIcon from '@lucide/svelte/icons/copy';
import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
import PlusIcon from '@lucide/svelte/icons/plus';
import SearchIcon from '@lucide/svelte/icons/search';
import XIcon from '@lucide/svelte/icons/x';
import { cubicOut } from 'svelte/easing';
import { fly } from 'svelte/transition';
import { base } from '$app/paths';
import FileTreeSidebar from '$lib/components/browser/FileTreeSidebar.svelte';
import Sidebar from '$lib/components/layout/Sidebar.svelte';
import StatusBar from '$lib/components/layout/StatusBar.svelte';
import TabBar from '$lib/components/layout/TabBar.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import * as Sheet from '$lib/components/ui/sheet/index.js';
import ViewerRouter from '$lib/components/viewers/ViewerRouter.svelte';
import { getFileTypeInfo } from '$lib/file-icons/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { connections } from '$lib/stores/connections.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import {
	clearUrlState,
	getUrlPrefix,
	getUrlView,
	setRawUrlParam,
	syncUrlParam,
	updateUrlView
} from '$lib/utils/url-state.js';

const initialFilePath = getUrlPrefix();

function openUrlTab(rawUrl: string) {
	const fileName = rawUrl.split('/').pop()?.split('?')[0] || '';
	const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
	if (!ext) return;
	const info = getFileTypeInfo(ext);
	if (info.viewer === 'raw') return;
	const tabId = `url:${rawUrl}`;
	tabs.open({
		id: tabId,
		name: fileName,
		path: rawUrl,
		source: 'url',
		extension: ext
	});
	fetch(rawUrl, { method: 'HEAD' })
		.then((res) => {
			const cl = res.headers.get('content-length');
			if (cl) tabs.update(tabId, { size: Number(cl) });
		})
		.catch(() => {});
}

// Open direct file URL tab eagerly — must run before layout renders
// so it works on mobile where Sidebar is inside a Sheet (not mounted).
{
	const rawUrl = new URL(window.location.href).searchParams.get('url');
	if (rawUrl) openUrlTab(rawUrl);
}

const EXAMPLE_URL =
	'https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/walkthru-earth/opensensor-space/share/suitability_analysis_of_aq.parquet';

function handleTryExample(e: MouseEvent) {
	e.preventDefault();
	openUrlTab(EXAMPLE_URL);
}

let hasActiveTab = $derived(tabs.active !== null && tabs.active !== undefined);
let hasBrowserConnection = $derived(browser.activeConnection !== null);
let mobileSheetOpen = $state(false);
let desktopSidebarOpen = $state(false);

// Extension cycling for the URL hint animation
// Each entry shows the extension + its default #view hash
const FORMAT_HINTS = [
	{ ext: '.parquet', hash: '#table', color: 'text-purple-400' },
	{ ext: '.parquet', hash: '#map', color: 'text-purple-400' },
	{ ext: '.csv', hash: '#table', color: 'text-green-400' },
	{ ext: '.geojson', hash: '#map', color: 'text-emerald-400' },
	{ ext: '.tif', hash: '', color: 'text-amber-400' },
	{ ext: '.fgb', hash: '', color: 'text-cyan-400' },
	{ ext: '.pmtiles', hash: '', color: 'text-blue-400' },
	{ ext: '.pdf', hash: '', color: 'text-red-400' },
	{ ext: '.laz', hash: '', color: 'text-emerald-400' },
	{ ext: '.json', hash: '#code', color: 'text-yellow-400' },
	{ ext: '.json', hash: '#maputnik', color: 'text-yellow-400' },
	{ ext: '.json', hash: '#stac-browser', color: 'text-yellow-400' },
	{ ext: '.json', hash: '#kepler', color: 'text-yellow-400' },
	{ ext: '.glb', hash: '', color: 'text-orange-400' }
] as const;
let extIndex = $state(0);
let copied = $state(false);
const currentFormat = $derived(FORMAT_HINTS[extIndex]);
// Auto-detect host + base path (works on any host, including /objex/ subpath)
const appBase = typeof window !== 'undefined' ? window.location.origin + base : '';
const displayHost = typeof window !== 'undefined' ? window.location.host + base : '';

$effect(() => {
	if (hasActiveTab) return;
	const id = setInterval(() => {
		extIndex = (extIndex + 1) % FORMAT_HINTS.length;
	}, 2000);
	return () => clearInterval(id);
});

function copyUrlPattern() {
	const f = currentFormat;
	const text = `${appBase}/?url=https://example.com/data${f.ext}${f.hash}`;
	navigator.clipboard.writeText(text);
	copied = true;
	setTimeout(() => (copied = false), 1500);
}

// Responsive: use matchMedia instead of CSS dual-rendering
// so viewers are mounted only once (not duplicated in hidden DOM).
let isDesktop = $state(false);
$effect(() => {
	const mq = window.matchMedia('(min-width: 640px)');
	isDesktop = mq.matches;
	const handler = (e: MediaQueryListEvent) => {
		isDesktop = e.matches;
	};
	mq.addEventListener('change', handler);
	return () => mq.removeEventListener('change', handler);
});

// Auto-close mobile sheet when a DIFFERENT file is opened.
// Track activeTabId (primitive) instead of tabs.active (derived from array)
// so that metadata-only updates (e.g. size from HEAD request) don't re-trigger.
let prevMobileTabId: string | null = tabs.activeTabId;
$effect(() => {
	const id = tabs.activeTabId;
	if (id && id !== prevMobileTabId) {
		mobileSheetOpen = false;
	}
	prevMobileTabId = id;
});

// Auto-open desktop sidebar when a connection is activated
$effect(() => {
	if (hasBrowserConnection) {
		desktopSidebarOpen = true;
	}
});

// Keep the full URL (?url= and #hash) in sync with the active tab.
// Save/restore view mode per tab so switching back preserves the view.
let prevActiveTabId = '';
const tabViewModes = new Map<string, string>();
$effect(() => {
	const tab = tabs.active;
	const id = tab?.id ?? '';

	if (prevActiveTabId && prevActiveTabId !== id) {
		// Save the current view mode for the tab we're leaving
		tabViewModes.set(prevActiveTabId, getUrlView());
	}

	if (!tab) {
		clearUrlState();
	} else {
		// Restore view mode hash for the tab we're switching to
		updateUrlView(tabViewModes.get(id) ?? '');

		// Sync ?url= param
		if (tab.source === 'url') {
			setRawUrlParam(tab.path);
		} else if (tab.connectionId) {
			const conn = connections.getById(tab.connectionId);
			if (conn) syncUrlParam(conn, tab.path);
		}
	}

	prevActiveTabId = id;
});

// Keep-alive tabs: only the most recently used tabs stay mounted.
// Switching between alive tabs is instant (no re-loading).
const aliveTabs = $derived(tabs.aliveTabs);

// Dynamic page title based on active tab
const pageTitle = $derived.by(() => {
	const tab = tabs.active;
	if (!tab) return 'objex — Cloud Storage Explorer';
	const info = getFileTypeInfo(tab.extension);
	return `${tab.name} — ${info.label} | objex`;
});
const pageDescription = $derived.by(() => {
	const tab = tabs.active;
	if (!tab)
		return 'Browse, query, and visualize Parquet, GeoTIFF, PMTiles, CSV, PDF, 3D models and more in S3, GCS, Azure — directly in your browser.';
	const info = getFileTypeInfo(tab.extension);
	return `Viewing ${tab.name} (${info.label}) in objex cloud storage explorer`;
});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
</svelte:head>

{#snippet viewerContent()}
	<div class="relative flex-1 overflow-auto">
		{#if aliveTabs.length > 0}
			{#each aliveTabs as aliveTab (aliveTab.id)}
				<div
					class="absolute inset-0"
					class:hidden={aliveTab.id !== tabs.activeTabId}
				>
					<ViewerRouter tab={aliveTab} />
				</div>
			{/each}
		{/if}
		{#if !hasActiveTab}
			<div class="flex h-full items-center justify-center px-6">
				<div class="flex flex-col items-center gap-3 text-center">
					<div class="flex size-14 items-center justify-center rounded-2xl bg-muted">
						{#if hasBrowserConnection}
							<SearchIcon class="size-7 text-muted-foreground" />
						{:else}
							<CloudIcon class="size-8 text-muted-foreground" />
						{/if}
					</div>
					<div class="flex flex-col items-center gap-1">
						{#if hasBrowserConnection}
							<h2 class="text-base font-semibold">{t('page.selectFile')}</h2>
							<p class="max-w-xs text-sm text-muted-foreground">
								{t('page.selectFileDescription')}
							</p>
						{:else}
							<h2 class="text-lg font-semibold">{t('page.noFileOpen')}</h2>
							<p class="max-w-sm text-sm text-muted-foreground">
								{t('page.noFileDescription')}
							</p>

							<!-- URL pattern hint with cycling extension -->
							<button
								dir="ltr"
								onclick={copyUrlPattern}
								class="group mt-4 flex w-full max-w-md items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/70"
							>
								<code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] sm:text-xs">
									<span class="text-muted-foreground/50">{displayHost}/</span><span class="text-muted-foreground">?url=…/data</span><span class="relative inline-block w-[var(--ext-w)] overflow-hidden align-bottom transition-[width] duration-300" style="height: 1lh; --ext-w: {currentFormat.ext.length * 0.62}em">{#key currentFormat.ext}<span
												class="absolute inset-x-0 top-0 font-bold {currentFormat.color}"
												in:fly={{ y: 18, duration: 300, easing: cubicOut }}
												out:fly={{ y: -18, duration: 300, easing: cubicOut }}
											>{currentFormat.ext}</span>{/key}</span>{#if currentFormat.hash}<span class="relative inline-block w-[var(--hash-w)] overflow-hidden align-bottom transition-[width] duration-300" style="height: 1lh; --hash-w: {currentFormat.hash.length * 0.62}em">{#key currentFormat.hash}<span
												class="absolute inset-x-0 top-0 text-muted-foreground/70"
												in:fly={{ y: 18, duration: 300, easing: cubicOut }}
												out:fly={{ y: -18, duration: 300, easing: cubicOut }}
											>{currentFormat.hash}</span>{/key}</span>{/if}
								</code>
								<span class="shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground">
									{#if copied}
										<CheckIcon class="size-3.5 text-green-500" />
									{:else}
										<CopyIcon class="size-3.5" />
									{/if}
								</span>
							</button>

							<div class="mt-4 flex items-center gap-2">
								<button
									onclick={() => {
									if (!isDesktop) mobileSheetOpen = true;
									connections.requestDialog();
								}}
									class="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
								>
									<PlusIcon class="size-3" />
									{t('page.addConnection')}
								</button>
								<button
									onclick={handleTryExample}
									class="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/30 px-4 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
								>
									<ExternalLinkIcon class="size-3" />
									{t('page.tryExample')}
								</button>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<div class="flex flex-1 overflow-hidden">
	{#if isDesktop}
		<!-- Desktop layout: Icon Rail + Stable Flex Layout -->
		<Sidebar />
		<div class="flex flex-1 overflow-hidden">
			{#if desktopSidebarOpen && hasBrowserConnection && browser.activeConnection}
				<div class="h-full w-64 shrink-0 border-e border-zinc-200 xl:w-72 dark:border-zinc-800">
					<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
				</div>
			{/if}
			<div class="flex h-full min-w-0 flex-1 flex-col">
				<TabBar>
					{#snippet leading()}
						{#if hasBrowserConnection}
							<Button
								variant="ghost"
								size="sm"
								class="h-7 px-1.5"
								onclick={() => (desktopSidebarOpen = !desktopSidebarOpen)}
								title={t('mobile.openSidebar')}
							>
								<PanelLeftIcon class="size-4" />
							</Button>
						{/if}
					{/snippet}
				</TabBar>
				{@render viewerContent()}
				<StatusBar />
			</div>
		</div>
	{:else}
		<!-- Mobile layout: Full-width content + Sheet sidebar -->
		<div class="flex flex-1 flex-col">
			<TabBar>
				{#snippet leading()}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 px-1.5"
						onclick={() => (mobileSheetOpen = true)}
						title={t('mobile.openSidebar')}
					>
						<PanelLeftIcon class="size-4" />
					</Button>
				{/snippet}
			</TabBar>
			{@render viewerContent()}
			<StatusBar />
		</div>

		<Sheet.Root bind:open={mobileSheetOpen}>
			<Sheet.Content
				side="left"
				class="w-[85vw] gap-0 p-0 [&>button:last-child]:hidden"
				onInteractOutside={(e: Event) => {
					// Prevent bits-ui DismissibleLayer from closing the sheet when
					// portaled elements (tooltips, context menus) trigger outside-interaction.
					// The overlay click still works because we only block non-overlay targets.
					const target = e.target as HTMLElement | null;
					if (target && !target.closest('[data-slot="sheet-overlay"]')) {
						e.preventDefault();
					}
				}}
			>
				<Sheet.Header class="flex flex-row items-center justify-between border-b px-3 py-2">
					<Sheet.Title class="text-sm font-medium">{t('mobile.fileExplorer')}</Sheet.Title>
					<button
						class="rounded-sm p-0.5 opacity-70 hover:opacity-100"
						onclick={() => (mobileSheetOpen = false)}
					>
						<XIcon class="size-4" />
					</button>
				</Sheet.Header>
				<div class="flex min-h-0 flex-1">
					<Sidebar />
					{#if hasBrowserConnection && browser.activeConnection}
						<div class="flex-1 overflow-hidden">
							<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
						</div>
					{/if}
				</div>
			</Sheet.Content>
		</Sheet.Root>
	{/if}
</div>
