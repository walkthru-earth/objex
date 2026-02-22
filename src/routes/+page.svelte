<script lang="ts">
import DatabaseIcon from '@lucide/svelte/icons/database';
import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
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
import { t } from '$lib/i18n/index.svelte.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import { getUrlPrefix } from '$lib/utils/url-state.js';

const initialFilePath = getUrlPrefix();

let hasActiveTab = $derived(tabs.active !== null && tabs.active !== undefined);
let hasBrowserConnection = $derived(browser.activeConnection !== null);
let mobileSheetOpen = $state(false);

// Auto-close mobile sheet when a file is opened
$effect(() => {
	if (tabs.active) {
		mobileSheetOpen = false;
	}
});
</script>

<div class="flex flex-1 overflow-hidden">
	<!-- Narrow Icon Rail Sidebar — hidden on mobile -->
	<div class="hidden sm:flex">
		<Sidebar />
	</div>

	<!-- Resizable main area: File Tree + Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		<div class="flex flex-1 overflow-hidden">
			{#if hasBrowserConnection && browser.activeConnection}
				<!-- Desktop: Resizable panes -->
				<div class="hidden flex-1 sm:flex">
					<ResizablePaneGroup direction="horizontal" class="flex-1">
						<!-- File Tree Panel -->
						<ResizablePane defaultSize={22} minSize={15} maxSize={35}>
							<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
						</ResizablePane>

						<ResizableHandle withHandle />

						<!-- Viewer Content Panel -->
						<ResizablePane defaultSize={78} minSize={50}>
							<div class="flex h-full flex-col">
								<TabBar />
								<div class="relative flex-1 overflow-auto">
									{#if hasActiveTab && tabs.active}
										<div class="absolute inset-0">
											<ViewerRouter tab={tabs.active} />
										</div>
									{:else}
										<div class="flex h-full items-center justify-center">
											<div class="flex flex-col items-center gap-3 text-center">
												<div class="flex size-14 items-center justify-center rounded-2xl bg-muted">
													<SearchIcon class="size-7 text-muted-foreground" />
												</div>
												<div class="flex flex-col gap-1">
													<h2 class="text-base font-semibold">{t('page.selectFile')}</h2>
													<p class="max-w-xs text-sm text-muted-foreground">
														{t('page.selectFileDescription')}
													</p>
												</div>
											</div>
										</div>
									{/if}
								</div>
								<StatusBar />
							</div>
						</ResizablePane>
					</ResizablePaneGroup>
				</div>

				<!-- Mobile: Content only + Sheet for file tree -->
				<div class="flex flex-1 flex-col sm:hidden">
					<TabBar>
						{#snippet leading()}
							<Button
								variant="ghost"
								size="sm"
								class="h-7 px-1.5 sm:hidden"
								onclick={() => (mobileSheetOpen = true)}
								title={t('mobile.openSidebar')}
							>
								<PanelLeftIcon class="size-4" />
							</Button>
						{/snippet}
					</TabBar>
					<div class="relative flex-1 overflow-auto">
						{#if hasActiveTab && tabs.active}
							<div class="absolute inset-0">
								<ViewerRouter tab={tabs.active} />
							</div>
						{:else}
							<div class="flex h-full items-center justify-center">
								<div class="flex flex-col items-center gap-3 text-center">
									<div class="flex size-14 items-center justify-center rounded-2xl bg-muted">
										<SearchIcon class="size-7 text-muted-foreground" />
									</div>
									<div class="flex flex-col gap-1">
										<h2 class="text-base font-semibold">{t('page.selectFile')}</h2>
										<p class="max-w-xs text-sm text-muted-foreground">
											{t('page.selectFileDescription')}
										</p>
									</div>
								</div>
							</div>
						{/if}
					</div>
					<StatusBar />
				</div>

				<!-- Mobile Sheet for file tree + sidebar -->
				<Sheet.Root bind:open={mobileSheetOpen}>
					<Sheet.Content side="left" class="w-[85vw] gap-0 p-0 sm:hidden [&>button:last-child]:hidden">
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
							<div class="flex-1 overflow-hidden">
								{#if browser.activeConnection}
									<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
								{/if}
							</div>
						</div>
					</Sheet.Content>
				</Sheet.Root>
			{:else}
				<!-- No connection selected: full-width content area -->
				<div class="flex h-full flex-1 flex-col">
					<!-- Mobile sidebar toggle -->
					<div class="flex sm:hidden">
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
					</div>
					<div class="hidden sm:flex">
						<TabBar />
					</div>

					<div class="relative flex-1 overflow-auto">
						{#if hasActiveTab && tabs.active}
							<div class="absolute inset-0">
								<ViewerRouter tab={tabs.active} />
							</div>
						{:else}
							<div class="flex h-full items-center justify-center">
								<div class="flex flex-col items-center gap-4 text-center">
									<div class="flex size-16 items-center justify-center rounded-2xl bg-muted">
										<DatabaseIcon class="size-8 text-muted-foreground" />
									</div>
									<div class="flex flex-col gap-1.5">
										<h2 class="text-lg font-semibold">{t('page.noFileOpen')}</h2>
										<p class="max-w-sm text-sm text-muted-foreground">
											{t('page.noFileDescription')}
										</p>
									</div>
									<div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
										<SearchIcon class="size-3.5" />
										<span>{t('page.supportsFormats')}</span>
									</div>
								</div>
							</div>
						{/if}
					</div>

					<StatusBar />
				</div>

				<!-- Mobile Sheet for sidebar (no connection) -->
				<Sheet.Root bind:open={mobileSheetOpen}>
					<Sheet.Content side="left" class="w-[75vw] gap-0 p-0 sm:hidden [&>button:last-child]:hidden">
						<Sheet.Header class="flex flex-row items-center justify-between border-b px-3 py-2">
							<Sheet.Title class="text-sm font-medium">{t('mobile.fileExplorer')}</Sheet.Title>
							<button
								class="rounded-sm p-0.5 opacity-70 hover:opacity-100"
								onclick={() => (mobileSheetOpen = false)}
							>
								<XIcon class="size-4" />
							</button>
						</Sheet.Header>
						<div class="min-h-0 flex-1">
							<Sidebar />
						</div>
					</Sheet.Content>
				</Sheet.Root>
			{/if}
		</div>
	</div>
</div>
