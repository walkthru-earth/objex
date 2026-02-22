<script lang="ts">
import CloudIcon from '@lucide/svelte/icons/cloud';
import DatabaseIcon from '@lucide/svelte/icons/database';
import GlobeIcon from '@lucide/svelte/icons/globe';
import PencilIcon from '@lucide/svelte/icons/pencil';
import PlusIcon from '@lucide/svelte/icons/plus';
import TrashIcon from '@lucide/svelte/icons/trash-2';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger
} from '$lib/components/ui/context-menu/index.js';
import { Separator } from '$lib/components/ui/separator/index.js';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger
} from '$lib/components/ui/tooltip/index.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { connections } from '$lib/stores/connections.svelte.js';
import { credentialStore, loadFromNative } from '$lib/stores/credentials.svelte.js';
import { tabs } from '$lib/stores/tabs.svelte.js';
import type { Connection } from '$lib/types.js';
import { type DetectedHost, detectHostBucket } from '$lib/utils/host-detection.js';
import { parseStorageUrl } from '$lib/utils/storage-url.js';
import { clearUrlState, syncUrlParam } from '$lib/utils/url-state.js';
import ConnectionDialog from './ConnectionDialog.svelte';
import ThemeToggle from './ThemeToggle.svelte';

let dialogOpen = $state(false);
let editingConnection = $state<Connection | null>(null);
let detectedHost = $state<DetectedHost | null>(null);
let autoConnecting = $state(false);

$effect(() => {
	connections.load().then(() => {
		handleAutoDetection();
	});
});

async function handleAutoDetection() {
	const detected = detectHostBucket();
	if (!detected) return;

	const url = new URL(window.location.href);
	const hasUrlParam = url.searchParams.has('url');

	if (hasUrlParam) {
		// Auto-connect immediately for ?url= param (zero-friction)
		autoConnecting = true;
		try {
			const connId = await connections.saveHostConnection(detected);
			const conn = connections.getById(connId);
			if (!conn) return;

			// If the connection requires credentials but they're not in memory
			// (e.g. page refresh), try restoring from browser password manager first.
			if (!conn.anonymous && !credentialStore.has(conn.id)) {
				const native = await loadFromNative(conn.id);
				if (native) {
					credentialStore.set(conn.id, native);
				} else {
					editingConnection = conn;
					dialogOpen = true;
					return;
				}
			}

			const parsed = parseStorageUrl(url.searchParams.get('url')!);
			const prefixParam = parsed.prefix;

			if (prefixParam && !prefixParam.endsWith('/')) {
				// It's a file — browse to its parent folder and open it
				const parentPrefix = prefixParam.includes('/') ? prefixParam.replace(/\/[^/]*$/, '/') : '';
				browser.browse(conn, parentPrefix || undefined);
				const fileName = prefixParam.split('/').pop() || prefixParam;
				const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
				tabs.open({
					id: `${conn.id}:${prefixParam}`,
					name: fileName,
					path: prefixParam,
					source: 'remote',
					connectionId: conn.id,
					extension: ext
				});
			} else if (prefixParam) {
				// It's a directory prefix
				browser.browse(conn, prefixParam);
			} else {
				browser.browse(conn);
			}
			syncUrlParam(conn, prefixParam || undefined);
		} finally {
			autoConnecting = false;
		}
	} else {
		// Show indicator for hostname-detected bucket
		detectedHost = detected;
	}
}

async function handleConnectDetected() {
	if (!detectedHost || autoConnecting) return;
	autoConnecting = true;
	try {
		const connId = await connections.saveHostConnection(detectedHost);
		const conn = connections.getById(connId);
		if (conn) {
			browser.browse(conn);
			syncUrlParam(conn);
		}
		detectedHost = null;
	} finally {
		autoConnecting = false;
	}
}

function handleAddConnection() {
	editingConnection = null;
	dialogOpen = true;
}

function handleEditConnection(connection: Connection) {
	editingConnection = connection;
	dialogOpen = true;
}

async function handleDeleteConnection(connection: Connection) {
	if (!confirm(`Delete connection "${connection.name}"?`)) return;
	await connections.remove(connection.id);
	if (browser.activeConnection?.id === connection.id) {
		browser.clear();
		clearUrlState();
	}
}

function handleBrowseConnection(connection: Connection) {
	browser.browse(connection);
	syncUrlParam(connection);
}
</script>

<TooltipProvider>
	<div class="flex h-full w-12 flex-col items-center bg-sidebar py-2">
		<!-- App icon -->
		<div class="mb-2 flex size-8 items-center justify-center">
			<DatabaseIcon class="size-5 text-sidebar-primary" />
		</div>

		<Separator class="mx-2 mb-2" />

		<!-- Connections -->
		<div class="flex flex-1 flex-col items-center gap-1 overflow-auto">
			<!-- Detected host indicator -->
			{#if detectedHost}
				<Tooltip>
					<TooltipTrigger>
						<button
							class="group relative flex size-8 items-center justify-center rounded-lg border border-dashed border-primary/50 text-primary transition-colors hover:bg-primary/10"
							class:animate-pulse={!autoConnecting}
							onclick={handleConnectDetected}
							disabled={autoConnecting}
						>
							<GlobeIcon class="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">
						Browse detected bucket: {detectedHost.bucket}
					</TooltipContent>
				</Tooltip>
			{/if}

			{#each connections.items as connection (connection.id)}
				{@const isActive = browser.activeConnection?.id === connection.id}
				<ContextMenu>
					<ContextMenuTrigger>
						<Tooltip>
							<TooltipTrigger>
								<button
									class="group relative flex size-8 items-center justify-center rounded-lg transition-colors {isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
									onclick={() => handleBrowseConnection(connection)}
								>
									<CloudIcon class="size-4" />
									{#if isActive}
										<div class="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-primary"></div>
									{/if}
								</button>
							</TooltipTrigger>
							<TooltipContent side="right">
								{connection.name}
							</TooltipContent>
						</Tooltip>
					</ContextMenuTrigger>
					<ContextMenuContent class="w-40">
						<ContextMenuItem onclick={() => handleEditConnection(connection)}>
							<PencilIcon class="mr-2 size-3.5" />
							Edit
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							class="text-destructive data-[highlighted]:text-destructive"
							onclick={() => handleDeleteConnection(connection)}
						>
							<TrashIcon class="mr-2 size-3.5" />
							Delete
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			{/each}

			<!-- Add connection button -->
			<Tooltip>
				<TooltipTrigger>
					<button
						class="flex size-8 items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 text-muted-foreground transition-colors hover:border-foreground/50 hover:text-foreground"
						onclick={handleAddConnection}
					>
						<PlusIcon class="size-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="right">Add connection</TooltipContent>
			</Tooltip>
		</div>

		<!-- Bottom actions -->
		<div class="mt-auto flex flex-col items-center gap-1 pt-2">
			<ThemeToggle />
		</div>
	</div>
</TooltipProvider>

<ConnectionDialog
	bind:open={dialogOpen}
	editConnection={editingConnection}
	onSaved={() => { connections.reload(); handleAutoDetection(); }}
/>
