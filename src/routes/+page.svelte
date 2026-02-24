<script lang="ts">
import CloudIcon from '@lucide/svelte/icons/cloud';
import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
import LayersIcon from '@lucide/svelte/icons/layers';
import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
import PlusIcon from '@lucide/svelte/icons/plus';
import SearchIcon from '@lucide/svelte/icons/search';
import XIcon from '@lucide/svelte/icons/x';
import FileTreeSidebar from '$lib/components/browser/FileTreeSidebar.svelte';
import Sidebar from '$lib/components/layout/Sidebar.svelte';
import StatusBar from '$lib/components/layout/StatusBar.svelte';
import TabBar from '$lib/components/layout/TabBar.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import {
	ResizableHandle,
	ResizablePane,
	ResizablePaneGroup
} from '$lib/components/ui/resizable/index.js';
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

// Auto-close mobile sheet when a file is opened
$effect(() => {
	if (tabs.active) {
		mobileSheetOpen = false;
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
			<div class="flex h-full items-center justify-center">
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
							<div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
								<LayersIcon class="size-3.5" />
								<span>{t('page.supportsFormats')}</span>
							</div>
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
		<!-- Desktop layout: Icon Rail + Resizable Panes -->
		<Sidebar />

		{#if hasBrowserConnection && browser.activeConnection}
			<ResizablePaneGroup direction="horizontal" class="flex-1">
				<ResizablePane defaultSize={22} minSize={15} maxSize={35}>
					<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
				</ResizablePane>

				<ResizableHandle withHandle />

				<ResizablePane defaultSize={78} minSize={50}>
					<div class="flex h-full flex-col">
						<TabBar />
						{@render viewerContent()}
						<StatusBar />
					</div>
				</ResizablePane>
			</ResizablePaneGroup>
		{:else}
			<div class="flex h-full flex-1 flex-col">
				<TabBar />
				{@render viewerContent()}
				<StatusBar />
			</div>
		{/if}
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
				class="{hasBrowserConnection ? 'w-[85vw]' : 'w-[75vw]'} gap-0 p-0 [&>button:last-child]:hidden"
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
