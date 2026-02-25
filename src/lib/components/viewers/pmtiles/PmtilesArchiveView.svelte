<script lang="ts">
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import type { PMTiles } from 'pmtiles';
import { tileIdToZxy } from 'pmtiles';
import {
	ResizableHandle,
	ResizablePane,
	ResizablePaneGroup
} from '$lib/components/ui/resizable/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import type { PmtilesMetadata } from '$lib/utils/pmtiles';
import { highlightCode } from '$lib/utils/shiki';

let {
	metadata,
	pmtiles,
	onOpenInspector
}: {
	metadata: PmtilesMetadata;
	pmtiles: PMTiles;
	onOpenInspector?: (z: number, x: number, y: number) => void;
} = $props();

interface ZoomSummary {
	zoom: number;
	count: number;
}

interface DirectoryEntry {
	tileId: number;
	z: number;
	x: number;
	y: number;
	offset: number;
	length: number;
	runLength: number;
}

let zoomSummaries = $state<ZoomSummary[]>([]);
let selectedZoom = $state<number | null>(null);
let zoomEntries = $state<DirectoryEntry[]>([]);
let selectedEntry = $state<DirectoryEntry | null>(null);
let loadingEntries = $state(false);
let showJson = $state(false);
let highlightedJson = $state('');
let errorMsg = $state('');

// Build zoom summaries from directory on mount
$effect(() => {
	if (!pmtiles) return;
	buildZoomSummaries();
});

async function buildZoomSummaries() {
	const header = metadata.header;
	const entries = await pmtiles.cache.getDirectory(
		pmtiles.source,
		header.rootDirectoryOffset,
		header.rootDirectoryLength,
		header
	);

	// Expand root entries into per-zoom counts
	const zoomCounts = new Map<number, number>();
	for (const e of entries) {
		if (e.runLength === 0) {
			const [z] = tileIdToZxy(e.tileId);
			zoomCounts.set(z, (zoomCounts.get(z) ?? 0) + 1);
		} else {
			for (let r = 0; r < e.runLength; r++) {
				const [z] = tileIdToZxy(e.tileId + r);
				zoomCounts.set(z, (zoomCounts.get(z) ?? 0) + 1);
			}
		}
	}

	const summaries: ZoomSummary[] = [];
	for (let z = metadata.minZoom; z <= metadata.maxZoom; z++) {
		summaries.push({ zoom: z, count: zoomCounts.get(z) ?? 0 });
	}
	zoomSummaries = summaries;
}

async function selectZoom(zoom: number) {
	selectedZoom = zoom;
	selectedEntry = null;
	loadingEntries = true;
	errorMsg = '';

	const header = metadata.header;
	const allEntries = await pmtiles.cache.getDirectory(
		pmtiles.source,
		header.rootDirectoryOffset,
		header.rootDirectoryLength,
		header
	);

	const result: DirectoryEntry[] = [];
	for (const e of allEntries) {
		if (e.runLength === 0) {
			const [z] = tileIdToZxy(e.tileId);
			if (z === zoom) {
				try {
					const leafEntries = await pmtiles.cache.getDirectory(
						pmtiles.source,
						header.leafDirectoryOffset + e.offset,
						e.length,
						header
					);
					for (const le of leafEntries) {
						for (let r = 0; r < le.runLength; r++) {
							const [lz, lx, ly] = tileIdToZxy(le.tileId + r);
							if (lz === zoom) {
								result.push({
									tileId: le.tileId + r,
									z: lz,
									x: lx,
									y: ly,
									offset: le.offset,
									length: le.length,
									runLength: le.runLength
								});
							}
						}
						if (result.length > 5000) break;
					}
				} catch (err) {
					errorMsg = err instanceof Error ? err.message : String(err);
				}
			}
		} else {
			for (let r = 0; r < e.runLength; r++) {
				const [z, x, y] = tileIdToZxy(e.tileId + r);
				if (z === zoom) {
					result.push({
						tileId: e.tileId + r,
						z,
						x,
						y,
						offset: e.offset,
						length: e.length,
						runLength: e.runLength
					});
				}
			}
		}
		if (result.length > 5000) break;
	}

	zoomEntries = result;
	loadingEntries = false;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

const maxCount = $derived(Math.max(1, ...zoomSummaries.map((s) => s.count)));
const dedupRatio = $derived(
	metadata.numAddressedTiles > 0
		? ((1 - metadata.numTileContents / metadata.numAddressedTiles) * 100).toFixed(1)
		: '0'
);
</script>

{#snippet entryDetails()}
	{#if selectedEntry}
		<div
			class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
		>
			{t('pmtiles.entryDetails')}
		</div>
		<div class="flex-1 overflow-auto p-3">
			<dl class="space-y-2 text-xs">
				<div>
					<dt class="text-muted-foreground">Tile</dt>
					<dd class="font-mono">{selectedEntry.z}/{selectedEntry.x}/{selectedEntry.y}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Tile ID</dt>
					<dd class="font-mono text-[11px]">{selectedEntry.tileId.toLocaleString()}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">{t('pmtiles.offset')}</dt>
					<dd class="font-mono text-[11px]">0x{selectedEntry.offset.toString(16).toUpperCase()}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">{t('pmtiles.length')}</dt>
					<dd>{formatBytes(selectedEntry.length)}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Run Length</dt>
					<dd>{selectedEntry.runLength}</dd>
				</div>
			</dl>

			{#if onOpenInspector}
				<button
					class="mt-4 w-full rounded bg-primary/90 px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary"
					onclick={() => onOpenInspector?.(selectedEntry!.z, selectedEntry!.x, selectedEntry!.y)}
				>
					{t('pmtiles.openInInspector')}
				</button>
			{/if}
		</div>
	{:else}
		<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
			Select an entry
		</div>
	{/if}
{/snippet}

<div class="flex h-full flex-col overflow-hidden">
	<!-- Stats grid -->
	<div
		class="shrink-0 border-b border-zinc-200 px-3 py-3 sm:px-4 dark:border-zinc-800"
	>
		<div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
			<div>
				<div class="text-muted-foreground">{t('mapInfo.tileFormat')}</div>
				<div class="font-medium">{metadata.formatLabel}</div>
			</div>
			<div>
				<div class="text-muted-foreground">{t('mapInfo.zoomRange')}</div>
				<div class="font-medium">z{metadata.minZoom} – z{metadata.maxZoom}</div>
			</div>
			<div>
				<div class="text-muted-foreground">{t('mapInfo.addressedTiles')}</div>
				<div class="font-medium">{metadata.numAddressedTiles.toLocaleString()}</div>
			</div>
			<div>
				<div class="text-muted-foreground">{t('mapInfo.uniqueContents')}</div>
				<div class="font-medium">{metadata.numTileContents.toLocaleString()}</div>
			</div>
			<div>
				<div class="text-muted-foreground">{t('pmtiles.dedupRatio')}</div>
				<div class="font-medium">{dedupRatio}%</div>
			</div>
			<div>
				<div class="text-muted-foreground">{t('mapInfo.tileCompression')}</div>
				<div class="font-medium">{metadata.tileCompression}</div>
			</div>
		</div>

		<!-- Header layout -->
		<div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
			{#each [
				{ label: t('pmtiles.rootDirectory'), offset: metadata.header.rootDirectoryOffset, length: metadata.header.rootDirectoryLength },
				{ label: t('pmtiles.metadata'), offset: metadata.header.jsonMetadataOffset, length: metadata.header.jsonMetadataLength },
				{ label: t('pmtiles.leafDirectories'), offset: metadata.header.leafDirectoryOffset, length: metadata.header.leafDirectoryLength ?? 0 },
				{ label: t('pmtiles.tileData'), offset: metadata.header.tileDataOffset, length: metadata.header.tileDataLength ?? 0 }
			] as section}
				<div class="flex items-baseline gap-1">
					<span class="text-muted-foreground">{section.label}:</span>
					<span class="font-mono text-[10px]">{formatBytes(section.length)}</span>
				</div>
			{/each}
		</div>

		<!-- JSON metadata toggle -->
		{#if metadata.jsonMetadata && Object.keys(metadata.jsonMetadata).length > 0}
			<button
				class="mt-2 text-[11px] text-blue-400 hover:text-blue-300"
				onclick={async () => {
					showJson = !showJson;
					if (showJson && !highlightedJson) {
						const raw = JSON.stringify(metadata.jsonMetadata, null, 2);
						highlightedJson = await highlightCode(raw, 'json');
					}
				}}
			>
				{showJson ? '▾' : '▸'} {t('pmtiles.jsonMetadata')}
			</button>
			{#if showJson}
				<div class="json-metadata mt-1 max-h-48 overflow-auto rounded text-[11px]">
					{@html highlightedJson || `<pre class="rounded bg-zinc-100 p-2 font-mono text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">${JSON.stringify(metadata.jsonMetadata, null, 2)}</pre>`}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Column browser (resizable) -->
	<ResizablePaneGroup direction="horizontal" class="min-h-0 flex-1">
		<!-- Column 1: Zoom levels -->
		<ResizablePane defaultSize={28} minSize={15}>
			<div class="flex h-full flex-col">
				<div
					class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
				>
					{t('pmtiles.zoomLevels')}
				</div>
				<div class="flex-1 overflow-auto">
					{#each zoomSummaries as s}
						<button
							class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
							class:bg-zinc-100={selectedZoom === s.zoom}
							class:dark:bg-zinc-800={selectedZoom === s.zoom}
							onclick={() => selectZoom(s.zoom)}
						>
							<span class="w-7 shrink-0 font-mono text-muted-foreground">z{s.zoom}</span>
							<div class="min-w-0 flex-1">
								<div
									class="h-1.5 rounded-full bg-blue-500/60"
									style="width: {Math.max(2, (s.count / maxCount) * 100)}%"
								></div>
							</div>
							<span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
								{s.count.toLocaleString()}
							</span>
							<ChevronRightIcon class="size-3 shrink-0 text-muted-foreground" />
						</button>
					{/each}
				</div>
			</div>
		</ResizablePane>

		<ResizableHandle />

		<!-- Column 2: Entries at zoom -->
		<ResizablePane defaultSize={42} minSize={20}>
			<div class="flex h-full flex-col">
				{#if selectedZoom !== null}
					<div
						class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
					>
						{t('pmtiles.tilesAtZoom').replace('{zoom}', String(selectedZoom))}
						<span class="ms-1 normal-case tracking-normal">({zoomEntries.length.toLocaleString()})</span>
					</div>
					<div class="flex-1 overflow-auto">
						{#if loadingEntries}
							<div class="p-4 text-center text-xs text-muted-foreground">Loading...</div>
						{:else if errorMsg}
							<div class="p-4 text-center text-xs text-red-400">{errorMsg}</div>
						{:else if zoomEntries.length === 0}
							<div class="p-4 text-center text-xs text-muted-foreground">{t('pmtiles.noEntries')}</div>
						{:else}
							{#each zoomEntries as entry}
								<button
									class="flex w-full items-center gap-2 px-3 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
									class:bg-zinc-100={selectedEntry?.tileId === entry.tileId}
									class:dark:bg-zinc-800={selectedEntry?.tileId === entry.tileId}
									onclick={() => (selectedEntry = entry)}
								>
									<span class="shrink-0 truncate font-mono text-[11px]">
										{entry.z}/{entry.x}/{entry.y}
									</span>
									<span class="ms-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
										{formatBytes(entry.length)}
									</span>
									<ChevronRightIcon class="size-3 shrink-0 text-muted-foreground" />
								</button>
							{/each}
						{/if}
					</div>
				{:else}
					<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
						Select a zoom level
					</div>
				{/if}
			</div>
		</ResizablePane>

		<ResizableHandle />

		<!-- Column 3: Entry details -->
		<ResizablePane defaultSize={30} minSize={15}>
			<div class="flex h-full flex-col">
				{@render entryDetails()}
			</div>
		</ResizablePane>
	</ResizablePaneGroup>
</div>

<style>
	.json-metadata :global(pre) {
		margin: 0;
		padding: 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.6875rem;
		line-height: 1.5;
	}

	.json-metadata :global(code) {
		font-size: inherit;
	}
</style>
