<script lang="ts">
import CloudIcon from '@lucide/svelte/icons/cloud';
import DatabaseIcon from '@lucide/svelte/icons/database';
import GlobeIcon from '@lucide/svelte/icons/globe';
import PencilIcon from '@lucide/svelte/icons/pencil';
import PlusIcon from '@lucide/svelte/icons/plus';
import SettingsIcon from '@lucide/svelte/icons/settings';
import TrashIcon from '@lucide/svelte/icons/trash-2';
import { type DetectedHost, detectHostBucket, parseStorageUrl } from '@walkthru-earth/objex-utils';
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
import { t } from '$lib/i18n/index.svelte.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { appConfig } from '$lib/stores/config.svelte.js';
import { connections } from '$lib/stores/connections.svelte.js';
import { credentialStore, loadFromNative } from '$lib/stores/credentials.svelte.js';
import { eagerUrlTabId, tabs } from '$lib/stores/tabs.svelte.js';
import type { Connection } from '$lib/types.js';
import { clearUrlState, syncUrlParam } from '$lib/utils/url-state.js';
import AboutSheet from './AboutSheet.svelte';
import ConnectionDialog from './ConnectionDialog.svelte';
import LocaleToggle from './LocaleToggle.svelte';
import ThemeToggle from './ThemeToggle.svelte';

// Settings panel is owned by +page.svelte so it stays reachable even when the
// connection rail is hidden; the gear button just requests it be opened.
let { onOpenSettings }: { onOpenSettings?: () => void } = $props();

let aboutOpen = $state(false);
let dialogOpen = $state(false);
let editingConnection = $state<Connection | null>(null);
let detectedHost = $state<DetectedHost | null>(null);
let autoConnecting = $state(false);

$effect(() => {
	connections.load().then(async () => {
		await handleAutoDetection();
		// On first visit (no connections, no URL params), seed connections from config
		if (connections.items.length === 0 && !new URL(window.location.href).searchParams.has('url')) {
			await loadConfigConnections();
		}
	});
});

// Allow other components to request opening the new-connection dialog
$effect(() => {
	if (connections.dialogRequested) {
		connections.clearDialogRequest();
		handleAddConnection();
	}
});

// Auto-detected ?url= buckets are saved anonymously (zero-click demo flow).
// If the first LIST returns 401/403, the bucket is actually private — flip
// the connection to non-anonymous and open the credential dialog so the
// user can paste keys instead of seeing a silent failure.
$effect(() => {
	const conn = browser.authRequired;
	if (!conn) return;
	handleAuthRequired(conn);
});

async function handleAuthRequired(conn: Connection) {
	browser.clearAuthRequired();
	await connections.update(conn.id, {
		name: conn.name,
		provider: conn.provider,
		endpoint: conn.endpoint,
		bucket: conn.bucket,
		region: conn.region,
		anonymous: false,
		authMethod: conn.authMethod,
		rootPrefix: conn.rootPrefix
	});
	const updated = connections.getById(conn.id);
	if (!updated) return;
	await ensureCredentials(updated);
}

async function handleAutoDetection() {
	const url = new URL(window.location.href);
	const rawUrl = url.searchParams.get('url');

	const detected = detectHostBucket();
	if (!detected) {
		// No recognizable host — let the eager URL tab handle it
		return;
	}

	const hasUrlParam = url.searchParams.has('url');

	// A recognizable storage provider was detected. Close the eagerly-opened
	// URL tab (if any) so we can re-open it with a proper connectionId that
	// provides S3 credentials and endpoint config for DuckDB httpfs.
	// Mark the close + reopen as a migration so the tab-sync effect in
	// +page.svelte doesn't clear `?url=` / `#hash` during the empty-tabs
	// window between close and open. We end migration in `finally` so an
	// abandoned credential prompt or thrown error still resets the flag.
	const isMigrating = hasUrlParam;
	if (isMigrating) tabs.beginMigration();

	if (rawUrl) {
		const eagerTabId = eagerUrlTabId(rawUrl);
		const eagerTab = tabs.items.find((t) => t.id === eagerTabId);
		if (eagerTab) {
			tabs.close(eagerTabId);
		}
	}

	if (hasUrlParam) {
		// Auto-connect immediately for ?url= param (zero-friction)
		autoConnecting = true;
		try {
			// TODO(stac-storage-ext): when `rawUrl` resolves to STAC content,
			// peek-fetch the JSON, classify with `classifyStac`, pick the first
			// item with non-empty hints, and pass `detected` through
			// `applyStacItemStorageHints(detected, item)` BEFORE
			// `saveHostConnection` so `storage:region` / `storage:platform` /
			// `storage:requester_pays` flow into the auto-created connection.
			// Helper lives in `utils/host-detection.ts` -- modular, callers opt in.
			const connId = await connections.saveHostConnection(detected);
			const conn = connections.getById(connId);
			if (!conn) return;

			if (!(await ensureCredentials(conn))) return;

			const parsed = parseStorageUrl(url.searchParams.get('url')!);
			const prefixParam = parsed.prefix;

			if (prefixParam && !prefixParam.endsWith('/')) {
				const fileName = prefixParam.split('/').pop() || prefixParam;
				const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
				if (ext) {
					// It's a file — browse to its parent folder and open it
					const parentPrefix = prefixParam.includes('/')
						? prefixParam.replace(/\/[^/]*$/, '/')
						: '';
					browser.browse(conn, parentPrefix || undefined);
					const tabId = `${conn.id}:${prefixParam}`;
					tabs.open({
						id: tabId,
						name: fileName,
						path: prefixParam,
						source: 'remote',
						connectionId: conn.id,
						extension: ext
					});
					// Fire-and-forget: fetch file size via HEAD request
					fetch(url.searchParams.get('url')!, { method: 'HEAD' })
						.then((res) => {
							const cl = res.headers.get('content-length');
							if (cl) tabs.update(tabId, { size: Number(cl) });
						})
						.catch(() => {});
				} else {
					// No extension — likely a directory (e.g. Zarr store without .zarr suffix).
					// Browse into it and let FileBrowser's auto-detection handle Zarr/etc.
					const dirPrefix = `${prefixParam}/`;
					browser.browse(conn, dirPrefix);
				}
			} else if (prefixParam) {
				// It's a directory prefix
				browser.browse(conn, prefixParam);
			} else {
				browser.browse(conn);
			}
			syncUrlParam(conn, prefixParam || undefined);
		} finally {
			autoConnecting = false;
			if (isMigrating) tabs.endMigration();
		}
	} else {
		// Show indicator for hostname-detected bucket
		detectedHost = detected;
		if (isMigrating) tabs.endMigration();
	}
}

async function loadConfigConnections() {
	const seeds = appConfig.value.connections;
	if (seeds.length === 0) {
		// No configured connections (e.g. config failed to load): preserve the
		// historic first-run demo bucket so the empty app is never a dead end.
		await loadDemoConnection();
		return;
	}
	let firstAnon: Connection | null = null;
	for (const seed of seeds) {
		const { id } = await connections.save({
			name: seed.name,
			provider: seed.provider,
			endpoint: seed.endpoint ?? '',
			bucket: seed.bucket,
			region: seed.region ?? '',
			anonymous: seed.anonymous ?? false,
			...(seed.authMethod ? { authMethod: seed.authMethod } : {}),
			...(seed.rootPrefix ? { rootPrefix: seed.rootPrefix } : {})
		});
		const conn = connections.getById(id);
		if (conn?.anonymous && !firstAnon) firstAnon = conn;
	}
	// Auto-open the first public bucket so the demo flow stays zero-click.
	// Private seeds remain as un-browsed rows; clicking one runs the normal
	// ensureCredentials prompt via handleBrowseConnection.
	if (firstAnon) {
		browser.browse(firstAnon);
		syncUrlParam(firstAnon);
	}
}

async function loadDemoConnection() {
	const { id } = await connections.save({
		name: 'Source Cooperative',
		provider: 's3',
		endpoint: '',
		bucket: 'us-west-2.opendata.source.coop',
		region: 'us-west-2',
		anonymous: true
	});
	const conn = connections.getById(id);
	if (conn) {
		browser.browse(conn);
		syncUrlParam(conn);
	}
}

async function handleConnectDetected() {
	if (!detectedHost || autoConnecting) return;
	autoConnecting = true;
	try {
		const connId = await connections.saveHostConnection(detectedHost);
		const conn = connections.getById(connId);
		if (conn) {
			if (!(await ensureCredentials(conn))) return;
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
	if (!confirm(t('sidebar.deleteConfirm', { name: connection.name }))) return;
	await connections.remove(connection.id);
	if (browser.activeConnection?.id === connection.id) {
		browser.clear();
		clearUrlState();
	}
}

/**
 * Ensure credentials are available for a non-anonymous connection.
 * Tries the browser password manager first, then opens the dialog.
 * Returns true if credentials are ready, false if the dialog was opened.
 */
async function ensureCredentials(connection: Connection): Promise<boolean> {
	if (connection.anonymous) return true;
	if (credentialStore.has(connection.id)) return true;

	// Try restoring from browser password manager
	const native = await loadFromNative(connection.id);
	if (native) {
		credentialStore.set(connection.id, native);
		return true;
	}

	// No credentials — open the dialog so the user can re-enter them
	editingConnection = connection;
	dialogOpen = true;

	return false;
}

async function handleBrowseConnection(connection: Connection) {
	// Skip if this connection is already being browsed — avoids clearing entries
	// and re-fetching, which causes DOM churn that can close the mobile Sheet.
	if (browser.activeConnection?.id === connection.id) return;
	if (!(await ensureCredentials(connection))) return;
	browser.browse(connection);
	syncUrlParam(connection);
}
</script>

<TooltipProvider>
	<div class="flex h-full w-12 flex-col items-center bg-sidebar py-2">
		<!-- App icon -->
		<Tooltip>
			<TooltipTrigger>
				<button
					class="mb-2 flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/50"
					onclick={() => { aboutOpen = true; }}
				>
					<DatabaseIcon class="size-5 text-sidebar-primary" />
				</button>
			</TooltipTrigger>
			<TooltipContent side="right">{t('about.title')}</TooltipContent>
		</Tooltip>

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
						{t('sidebar.browseDetected', { name: detectedHost.bucket })}
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
							<PencilIcon class="me-2 size-3.5" />
							{t('sidebar.edit')}
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							class="text-destructive data-[highlighted]:text-destructive"
							onclick={() => handleDeleteConnection(connection)}
						>
							<TrashIcon class="me-2 size-3.5" />
							{t('sidebar.delete')}
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
				<TooltipContent side="right">{t('sidebar.addConnection')}</TooltipContent>
			</Tooltip>
		</div>

		<!-- Bottom actions -->
		<div class="mt-auto flex flex-col items-center gap-1 pt-2">
			{#if appConfig.value.ui.showSettings}
				<Tooltip>
					<TooltipTrigger>
						<button
							class="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
							onclick={() => onOpenSettings?.()}
							aria-label={t('settings.tooltip')}
						>
							<SettingsIcon class="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">{t('settings.tooltip')}</TooltipContent>
				</Tooltip>
			{/if}
			<LocaleToggle />
			<ThemeToggle />
		</div>
	</div>
</TooltipProvider>

<AboutSheet bind:open={aboutOpen} />

<ConnectionDialog
	bind:open={dialogOpen}
	editConnection={editingConnection}
	onSaved={() => {
		connections.reload();
		// If we opened the dialog for a credential re-entry, auto-browse after save
		if (editingConnection) {
			const conn = connections.getById(editingConnection.id);
			if (conn && credentialStore.has(conn.id)) {
				browser.browse(conn);
				syncUrlParam(conn);
			}
		}
		editingConnection = null;
		handleAutoDetection();
	}}
	onClose={() => {
		editingConnection = null;
	}}
/>
