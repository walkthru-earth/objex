<script lang="ts">
import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
import XIcon from '@lucide/svelte/icons/x';
import type { PMTiles } from 'pmtiles';
import { t } from '$lib/i18n/index.svelte.js';
import type { PmtilesMetadata } from '$lib/utils/pmtiles';
import {
	type DecodedTile,
	decodeMvtTile,
	layerHue,
	tileMimeType,
	tileToImageUrl
} from '$lib/utils/pmtiles-tile.js';
import SvgTileRenderer from './SvgTileRenderer.svelte';

let {
	metadata,
	pmtiles,
	initialZ,
	initialX,
	initialY
}: {
	metadata: PmtilesMetadata;
	pmtiles: PMTiles;
	initialZ?: number;
	initialX?: number;
	initialY?: number;
} = $props();

let inputZ = $state(0);
let inputX = $state(0);
let inputY = $state(0);

// Initialize from props (using derived to track prop changes)
const _initZ = $derived(initialZ ?? metadata.minZoom);
const _initX = $derived(initialX ?? 0);
const _initY = $derived(initialY ?? 0);

// Seed inputs once on mount
let seeded = false;
$effect(() => {
	if (!seeded) {
		inputZ = _initZ;
		inputX = _initX;
		inputY = _initY;
		seeded = true;
	}
});

let tile = $state<DecodedTile | null>(null);
let rasterUrl = $state<string | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);
let tileSize = $state(0);

let selectedLayerName = $state<string | null>(null);
let selectedFeatureIdx = $state<number | null>(null);
let showLayerPanel = $state(true);
let layerVisibility = $state<Record<string, boolean>>({});

const isVector = $derived(metadata.format === 'mvt');

// Auto-fetch when initial coordinates arrive from archive view
let lastInitKey = '';
$effect(() => {
	const key = `${initialZ}/${initialX}/${initialY}`;
	if (
		key !== lastInitKey &&
		initialZ !== undefined &&
		initialX !== undefined &&
		initialY !== undefined
	) {
		lastInitKey = key;
		inputZ = initialZ;
		inputX = initialX;
		inputY = initialY;
		fetchTile();
	}
});

async function fetchTile() {
	loading = true;
	error = null;
	tile = null;
	rasterUrl = null;
	selectedLayerName = null;
	selectedFeatureIdx = null;

	try {
		if (isVector) {
			const result = await decodeMvtTile(pmtiles, inputZ, inputX, inputY);
			if (!result) {
				error = t('pmtiles.tileNotFound');
			} else {
				tile = result;
				tileSize = result.rawSize;
				// Init visibility
				const vis: Record<string, boolean> = {};
				for (const l of result.layers) vis[l.name] = true;
				layerVisibility = vis;
			}
		} else {
			const mime = tileMimeType(metadata.format);
			const url = await tileToImageUrl(pmtiles, inputZ, inputX, inputY, mime);
			if (!url) {
				error = t('pmtiles.tileNotFound');
			} else {
				rasterUrl = url;
				const resp = await pmtiles.getZxy(inputZ, inputX, inputY);
				tileSize = resp ? new Uint8Array(resp.data).length : 0;
			}
		}
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	} finally {
		loading = false;
	}
}

function navigateParent() {
	if (inputZ <= 0) return;
	inputZ = inputZ - 1;
	inputX = Math.floor(inputX / 2);
	inputY = Math.floor(inputY / 2);
	fetchTile();
}

function navigateChild(dx: number, dy: number) {
	inputZ = inputZ + 1;
	inputX = inputX * 2 + dx;
	inputY = inputY * 2 + dy;
	fetchTile();
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Enter') fetchTile();
}

function selectFeature(layerName: string, featureIndex: number) {
	selectedLayerName = layerName;
	selectedFeatureIdx = featureIndex;
}

const selectedFeature = $derived.by(() => {
	if (!tile || selectedLayerName === null || selectedFeatureIdx === null) return null;
	const layer = tile.layers.find((l) => l.name === selectedLayerName);
	if (!layer || selectedFeatureIdx >= layer.features.length) return null;
	return layer.features[selectedFeatureIdx];
});

const selectedFeatureKey = $derived(
	selectedLayerName !== null && selectedFeatureIdx !== null
		? `${selectedLayerName}:${selectedFeatureIdx}`
		: null
);

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatValue(v: unknown): string {
	if (v === null || v === undefined) return 'NULL';
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
}
</script>

<div class="flex h-full flex-col overflow-hidden">
	<!-- Navigation bar -->
	<div
		class="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800"
	>
		<!-- Z/X/Y inputs -->
		<div class="flex items-center gap-1 text-xs">
			<span class="text-muted-foreground">z</span>
			<input
				type="number"
				bind:value={inputZ}
				min={0}
				max={30}
				class="w-12 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-center font-mono text-xs dark:border-zinc-700"
				onkeydown={handleKeydown}
			/>
			<span class="text-muted-foreground">x</span>
			<input
				type="number"
				bind:value={inputX}
				min={0}
				class="w-16 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-center font-mono text-xs dark:border-zinc-700"
				onkeydown={handleKeydown}
			/>
			<span class="text-muted-foreground">y</span>
			<input
				type="number"
				bind:value={inputY}
				min={0}
				class="w-16 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-center font-mono text-xs dark:border-zinc-700"
				onkeydown={handleKeydown}
			/>
		</div>

		<button
			class="rounded bg-primary/90 px-3 py-1 text-xs text-primary-foreground hover:bg-primary"
			onclick={fetchTile}
			disabled={loading}
		>
			{loading ? '...' : t('pmtiles.fetchTile')}
		</button>

		<!-- Tile size badge -->
		{#if tileSize > 0}
			<span class="text-[10px] tabular-nums text-muted-foreground">
				{formatBytes(tileSize)}
			</span>
		{/if}

		<div class="ms-auto flex items-center gap-1">
			<!-- Parent -->
			<button
				class="rounded bg-card/80 p-1 text-xs text-card-foreground hover:bg-card disabled:opacity-30"
				onclick={navigateParent}
				disabled={inputZ <= 0}
				title={t('pmtiles.parent')}
			>
				<ChevronUpIcon class="size-3.5" />
			</button>

			<!-- Children 2x2 -->
			<div class="grid grid-cols-2 gap-px">
				{#each [[0, 0], [1, 0], [0, 1], [1, 1]] as [dx, dy]}
					<button
						class="size-4 rounded-sm bg-card/80 text-[8px] leading-none text-card-foreground hover:bg-card"
						onclick={() => navigateChild(dx, dy)}
						title="z{inputZ + 1}/{inputX * 2 + dx}/{inputY * 2 + dy}"
					>
						{dx}{dy}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Main content -->
	<div class="flex min-h-0 flex-1 overflow-hidden">
		{#if loading}
			<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
				Loading tile...
			</div>
		{:else if error}
			<div class="flex flex-1 items-center justify-center text-xs text-red-400">
				{error}
			</div>
		{:else if tile}
			<!-- SVG render area -->
			<div class="relative min-w-0 flex-1 overflow-hidden p-2">
				<SvgTileRenderer
					{tile}
					visibleLayers={layerVisibility}
					{selectedFeatureKey}
					onFeatureClick={selectFeature}
				/>

				<!-- Layer panel overlay -->
				{#if showLayerPanel}
					<div
						class="absolute left-4 top-4 z-10 max-h-[50%] w-44 overflow-auto rounded bg-card/95 p-2 text-xs shadow-lg backdrop-blur-sm"
					>
						<div class="mb-1 flex items-center justify-between">
							<span class="font-medium text-card-foreground">{t('pmtiles.layers')}</span>
							<button
								class="rounded p-0.5 text-zinc-400 hover:text-zinc-200"
								onclick={() => (showLayerPanel = false)}
							>
								<XIcon class="size-3" />
							</button>
						</div>
						{#each tile.layers as layer, i}
							<label
								class="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-zinc-800/50"
							>
								<input
									type="checkbox"
									checked={layerVisibility[layer.name] !== false}
									onchange={() => (layerVisibility[layer.name] = !layerVisibility[layer.name])}
									class="size-3 accent-primary"
								/>
								<span
									class="inline-block size-2 shrink-0 rounded-sm"
									style="background: hsl({layerHue(i)}, 70%, 55%)"
								></span>
								<span class="truncate text-card-foreground">{layer.name}</span>
								<span class="ms-auto text-[10px] text-muted-foreground">
									{layer.features.length}
								</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Feature properties panel -->
			<div
				class="flex w-56 shrink-0 flex-col border-s border-zinc-200 lg:w-64 dark:border-zinc-800"
			>
				<div
					class="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground dark:border-zinc-800"
				>
					{t('pmtiles.featureProperties')}
				</div>
				{#if selectedFeature && selectedLayerName !== null}
					<div class="flex-1 overflow-auto">
						<div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
							<div class="flex items-center gap-1.5 text-xs">
								<span
									class="inline-block size-2 rounded-sm"
									style="background: hsl({layerHue(tile.layers.findIndex((l) => l.name === selectedLayerName))}, 70%, 55%)"
								></span>
								<span class="font-medium">{selectedLayerName}</span>
							</div>
							<div class="mt-0.5 text-[10px] text-muted-foreground">
								{selectedFeature.type}
								{#if selectedFeature.id !== undefined}
									· ID: {selectedFeature.id}
								{/if}
								· #{selectedFeatureIdx}
							</div>
						</div>
						<div class="divide-y divide-zinc-100 dark:divide-zinc-800">
							{#each Object.entries(selectedFeature.properties) as [key, value]}
								<div class="px-3 py-1.5">
									<div class="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
										{key}
									</div>
									<div
										class="break-all text-xs text-zinc-700 dark:text-zinc-300"
										title={formatValue(value)}
									>
										{formatValue(value)}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div
						class="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground"
					>
						{t('pmtiles.selectFeature')}
					</div>
				{/if}
			</div>
		{:else if rasterUrl}
			<!-- Raster tile preview -->
			<div class="flex flex-1 items-center justify-center bg-zinc-950 p-4">
				<img
					src={rasterUrl}
					alt="Tile {inputZ}/{inputX}/{inputY}"
					class="max-h-full max-w-full rounded border border-zinc-800"
					style="image-rendering: pixelated;"
				/>
			</div>
		{:else}
			<div
				class="flex flex-1 items-center justify-center text-xs text-muted-foreground"
			>
				{t('pmtiles.noTileLoaded')}
			</div>
		{/if}
	</div>
</div>
