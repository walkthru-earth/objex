<script lang="ts">
import DatabaseIcon from '@lucide/svelte/icons/database';
import SearchIcon from '@lucide/svelte/icons/search';
import FileTreeSidebar from '$lib/components/browser/FileTreeSidebar.svelte';
import Sidebar from '$lib/components/layout/Sidebar.svelte';
import StatusBar from '$lib/components/layout/StatusBar.svelte';
import TabBar from '$lib/components/layout/TabBar.svelte';
import {
	ResizableHandle,
	ResizablePane,
	ResizablePaneGroup
} from '$lib/components/ui/resizable/index.js';
import ViewerRouter from '$lib/components/viewers/ViewerRouter.svelte';
import { browser } from '$lib/stores/browser.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import { getUrlPrefix } from '$lib/utils/url-state.js';

const initialFilePath = getUrlPrefix();

let hasActiveTab = $derived(tabs.active !== null && tabs.active !== undefined);
let hasBrowserConnection = $derived(browser.activeConnection !== null);
</script>

<div class="flex flex-1 overflow-hidden">
	<!-- Narrow Icon Rail Sidebar (fixed width) -->
	<Sidebar />

	<!-- Resizable main area: File Tree + Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		<div class="flex flex-1 overflow-hidden">
			{#if hasBrowserConnection && browser.activeConnection}
				<ResizablePaneGroup direction="horizontal" class="flex-1">
					<!-- File Tree Panel -->
					<ResizablePane defaultSize={22} minSize={15} maxSize={35}>
						<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
					</ResizablePane>

					<ResizableHandle withHandle />

					<!-- Viewer Content Panel -->
					<ResizablePane defaultSize={78} minSize={50}>
						<div class="flex h-full flex-col">
							<!-- Tab Bar -->
							<TabBar />

							<!-- Content Area -->
							<div class="relative flex-1 overflow-auto">
								{#if hasActiveTab && tabs.active}
									<div class="absolute inset-0">
										<ViewerRouter tab={tabs.active} />
									</div>
								{:else}
									<!-- Empty State: connection selected but no file open -->
									<div class="flex h-full items-center justify-center">
										<div class="flex flex-col items-center gap-3 text-center">
											<div
												class="flex size-14 items-center justify-center rounded-2xl bg-muted"
											>
												<SearchIcon class="size-7 text-muted-foreground" />
											</div>
											<div class="flex flex-col gap-1">
												<h2 class="text-base font-semibold">Select a file</h2>
												<p class="max-w-xs text-sm text-muted-foreground">
													Browse the file tree on the left and click a file to open it.
												</p>
											</div>
										</div>
									</div>
								{/if}
							</div>

							<!-- Status Bar -->
							<StatusBar />
						</div>
					</ResizablePane>
				</ResizablePaneGroup>
			{:else}
				<!-- No connection selected: full-width content area -->
				<div class="flex h-full flex-1 flex-col">
					<!-- Tab Bar -->
					<TabBar />

					<!-- Content Area -->
					<div class="relative flex-1 overflow-auto">
						{#if hasActiveTab && tabs.active}
							<div class="absolute inset-0">
								<ViewerRouter tab={tabs.active} />
							</div>
						{:else}
							<!-- Empty State -->
							<div class="flex h-full items-center justify-center">
								<div class="flex flex-col items-center gap-4 text-center">
									<div
										class="flex size-16 items-center justify-center rounded-2xl bg-muted"
									>
										<DatabaseIcon class="size-8 text-muted-foreground" />
									</div>
									<div class="flex flex-col gap-1.5">
										<h2 class="text-lg font-semibold">No file open</h2>
										<p class="max-w-sm text-sm text-muted-foreground">
											Open a Parquet file from the sidebar, add a cloud storage
											connection, or drag and drop a file to get started.
										</p>
									</div>
									<div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
										<SearchIcon class="size-3.5" />
										<span>Supports Parquet, CSV, and Arrow IPC formats</span>
									</div>
								</div>
							</div>
						{/if}
					</div>

					<!-- Status Bar -->
					<StatusBar />
				</div>
			{/if}
		</div>
	</div>
</div>
