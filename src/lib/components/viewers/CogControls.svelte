<script lang="ts">
import { t } from '../../i18n/index.svelte.js';
import {
	type BandConfig,
	type ColorRampId,
	DEFAULT_RESCALE,
	type RescaleConfig
} from '../../utils/cog.js';
import {
	COLORMAP_INDEX,
	COLORMAP_NAMES,
	COLORMAP_SPRITE_LAYERS,
	COLORMAP_SPRITE_URL
} from '../../utils/colormap-sprite.js';
import type { RasterBandAsset } from '../../utils/stac.js';
import { RangeSlider } from '../ui/slider/index.js';

/** Channel slot for a multi-COG composite. */
export type MultiChannel = 'r' | 'g' | 'b' | 'a';
/** Composite asset-key map handed to MultiCOGLayer's `composite` prop. */
export type AssetComposite = { r: string; g: string; b: string; a?: string };

/**
 * Discriminated-union props so the band/picker shape lines up with the mode.
 * `single` drives single-COG band selectors + color ramp; `multi` drives the
 * STAC asset-key picker for MultiCOGLayer composition. Both modes share the
 * rescale slider + (optional) histogram overlay.
 */
type SingleProps = {
	mode: 'single';
	bandCount: number;
	bandConfig: BandConfig;
	onConfigChange: (config: BandConfig) => void;
	rescale: RescaleConfig;
	rescaleApplicable: boolean;
	onRescaleChange: (rescale: RescaleConfig) => void;
	/** Optional histogram bins (single-band only) for the slider overlay. */
	histogram?: Uint32Array | null;
	/**
	 * Optional STAC asset picker for mosaic-mode usage. When supplied with ≥2
	 * entries, an Asset `<select>` renders above the band/ramp UI so the user
	 * can swap which single-asset COG drives each item in the mosaic.
	 */
	assets?: RasterBandAsset[];
	assetKey?: string | null;
	onAssetChange?: (assetKey: string) => void;
};

type MultiProps = {
	mode: 'multi';
	/** Asset list available on the current STAC Item. */
	assets: RasterBandAsset[];
	composite: AssetComposite;
	onCompositeChange: (channel: MultiChannel, assetKey: string) => void;
	rescale: RescaleConfig;
	rescaleApplicable: boolean;
	onRescaleChange: (rescale: RescaleConfig) => void;
	histogram?: Uint32Array | null;
};

const props: SingleProps | MultiProps = $props();
const isSingle = $derived(props.mode === 'single');
const isMulti = $derived(props.mode === 'multi');
// Narrowed views — Svelte's $derived plus runtime guards keep TS happy.
const single = $derived(props.mode === 'single' ? (props as SingleProps) : null);
const multi = $derived(props.mode === 'multi' ? (props as MultiProps) : null);

const rescale = $derived(props.rescale);
const rescaleApplicable = $derived(props.rescaleApplicable);
const onRescaleChange = $derived(props.onRescaleChange);
const histogram = $derived(props.histogram ?? null);

function multiAssetLabel(a: RasterBandAsset): string {
	return a.commonName ? `${a.key} (${a.commonName})` : a.key;
}

// ─── Ramp picker state ──────────────────────────────────────────
// Keep a curated set pinned at the top for familiarity; the full set of
// 107 is searchable underneath. Pinned names match the old UI exactly so
// existing muscle memory holds.
const PINNED_RAMPS: ColorRampId[] = [
	'gray',
	'terrain',
	'viridis',
	'magma',
	'turbo',
	'spectral',
	'inferno',
	'plasma',
	'cividis',
	'rdylgn'
];

let rampQuery = $state('');

const filteredRamps = $derived.by(() => {
	const q = rampQuery.trim().toLowerCase();
	if (!q) return COLORMAP_NAMES;
	return COLORMAP_NAMES.filter((name) => name.toLowerCase().includes(q));
});

// ─── Helpers ────────────────────────────────────────────────────

function bandOptions(count: number): { value: number; label: string }[] {
	return Array.from({ length: count }, (_, i) => ({
		value: i,
		label: `${t('cog.band')} ${i + 1}`
	}));
}

function setSingleMode(m: 'rgb' | 'single') {
	if (!single) return;
	single.onConfigChange({ ...single.bandConfig, mode: m });
}

function setBand(key: 'rBand' | 'gBand' | 'bBand' | 'band', value: number) {
	if (!single) return;
	single.onConfigChange({ ...single.bandConfig, [key]: value });
}

function setRamp(id: ColorRampId) {
	if (!single) return;
	single.onConfigChange({ ...single.bandConfig, colorRamp: id });
}

/**
 * CSS `background` declaration that renders one sprite row at the
 * container's full height. Sprite is 256 wide × 107 tall (one 1px row per
 * ramp); we scale it vertically by the target height and offset to land on
 * the requested layer.
 */
function rampBg(name: ColorRampId, heightPx: number): string {
	const index = COLORMAP_INDEX[name];
	if (index === undefined) return '';
	const totalHeight = COLORMAP_SPRITE_LAYERS * heightPx;
	const yOffset = index * heightPx;
	return [
		`background-image: url("${COLORMAP_SPRITE_URL}")`,
		'background-repeat: no-repeat',
		`background-size: 100% ${totalHeight}px`,
		`background-position: 0 -${yOffset}px`
	].join('; ');
}

// ─── Rescale / histogram ────────────────────────────────────────

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

function setRescaleMin(value: number) {
	const clamped = clamp01(value);
	const next = Math.min(clamped, rescale.max - 0.001);
	onRescaleChange({ min: Number.isFinite(next) ? next : 0, max: rescale.max });
}

function setRescaleMax(value: number) {
	const clamped = clamp01(value);
	const next = Math.max(clamped, rescale.min + 0.001);
	onRescaleChange({ min: rescale.min, max: Number.isFinite(next) ? next : 1 });
}

function setRescaleRange(next: [number, number]) {
	const lo = clamp01(next[0]);
	const hi = clamp01(next[1]);
	onRescaleChange({ min: Math.min(lo, hi), max: Math.max(lo, hi) });
}

function resetRescale() {
	onRescaleChange({ ...DEFAULT_RESCALE });
}

function fmtRescale(n: number): string {
	return n.toFixed(2);
}

const histogramBars = $derived.by(() => {
	if (!histogram || histogram.length === 0) return null;
	let max = 0;
	for (const v of histogram) if (v > max) max = v;
	if (max === 0) return null;
	const bins = Array.from(histogram, (count) => count / max);
	return bins;
});
</script>

<div
	class="absolute right-2 top-10 z-10 w-60 rounded bg-card/90 p-2.5 text-xs text-card-foreground backdrop-blur-sm"
>
{#if isSingle && single}
	{#if single.assets && single.assets.length > 1 && single.onAssetChange}
		<!-- Mosaic asset picker: which single STAC asset drives every item. -->
		<div class="mb-2 flex items-center gap-2">
			<span class="text-muted-foreground">{t('map.mosaicAsset')}</span>
			<select
				class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				value={single.assetKey ?? ''}
				onchange={(e) => single.onAssetChange?.((e.target as HTMLSelectElement).value)}
			>
				{#each single.assets as asset (asset.key)}
					<option value={asset.key}>{multiAssetLabel(asset)}</option>
				{/each}
			</select>
		</div>
	{/if}
	<!-- Mode toggle -->
	<div class="mb-2 flex gap-1">
		<button
			class="flex-1 rounded px-2 py-1 transition-colors"
			class:bg-primary={single.bandConfig.mode === 'rgb'}
			class:text-primary-foreground={single.bandConfig.mode === 'rgb'}
			class:bg-muted={single.bandConfig.mode !== 'rgb'}
			onclick={() => setSingleMode('rgb')}
		>
			RGB
		</button>
		<button
			class="flex-1 rounded px-2 py-1 transition-colors"
			class:bg-primary={single.bandConfig.mode === 'single'}
			class:text-primary-foreground={single.bandConfig.mode === 'single'}
			class:bg-muted={single.bandConfig.mode !== 'single'}
			onclick={() => setSingleMode('single')}
		>
			{t('cog.singleBand')}
		</button>
	</div>

	{#if single.bandConfig.mode === 'rgb'}
		<!-- RGB band selectors -->
		<div class="space-y-1">
			{#each [
				{ key: 'rBand' as const, label: 'R', color: 'text-red-400' },
				{ key: 'gBand' as const, label: 'G', color: 'text-green-400' },
				{ key: 'bBand' as const, label: 'B', color: 'text-blue-400' }
			] as ch}
				<div class="flex items-center gap-2">
					<span class="w-3 font-bold {ch.color}">{ch.label}</span>
					<select
						class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
						value={single.bandConfig[ch.key]}
						onchange={(e) =>
							setBand(ch.key, Number((e.target as HTMLSelectElement).value))}
					>
						{#each bandOptions(single.bandCount) as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
			{/each}
		</div>
	{:else}
		<!-- Single band selector -->
		<div class="mb-2 flex items-center gap-2">
			<span class="text-muted-foreground">{t('cog.band')}</span>
			<select
				class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				value={single.bandConfig.band}
				onchange={(e) =>
					setBand('band', Number((e.target as HTMLSelectElement).value))}
			>
				{#each bandOptions(single.bandCount) as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<!-- Color ramp picker -->
		<div class="space-y-1">
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{t('cog.colorRamp')}</span>
				<span class="text-[10px] text-muted-foreground tabular-nums">
					{filteredRamps.length}/{COLORMAP_NAMES.length}
				</span>
			</div>

			<!-- Pinned quick-access (only when no search active) -->
			{#if !rampQuery}
				<div class="grid grid-cols-2 gap-1">
					{#each PINNED_RAMPS as id}
						<button
							class="flex flex-col items-stretch rounded border px-1 py-0.5 transition-colors {single.bandConfig.colorRamp === id ? 'border-primary bg-muted' : 'border-transparent hover:border-border'}"
							onclick={() => setRamp(id)}
							title={id}
						>
							<div class="h-2.5 w-full rounded-sm" style={rampBg(id, 10)}></div>
							<span class="mt-0.5 text-center text-[10px] capitalize text-muted-foreground">
								{id}
							</span>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Search + all-ramps scroll list -->
			<input
				type="search"
				placeholder={t('cog.colorRampSearch')}
				class="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
				value={rampQuery}
				oninput={(e) => (rampQuery = (e.target as HTMLInputElement).value)}
			/>
			<div class="max-h-40 overflow-y-auto rounded border border-border">
				{#each filteredRamps as id}
					<button
						class="flex w-full items-center gap-2 px-1.5 py-0.5 text-left text-[11px] transition-colors {single.bandConfig.colorRamp === id ? 'bg-muted' : 'hover:bg-muted/60'}"
						onclick={() => setRamp(id)}
						title={id}
					>
						<div class="h-2.5 w-14 flex-shrink-0 rounded-sm" style={rampBg(id, 10)}></div>
						<span class="truncate text-muted-foreground">{id}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
{/if}

{#if isMulti && multi}
	<!-- STAC asset → channel picker for MultiCOG composites. -->
	<div class="mb-2 text-muted-foreground">{t('map.multiCogBands')}</div>
	<div class="space-y-1">
		{#each [
			{ ch: 'r' as const, label: 'R', color: 'text-red-400' },
			{ ch: 'g' as const, label: 'G', color: 'text-green-400' },
			{ ch: 'b' as const, label: 'B', color: 'text-blue-400' },
			{ ch: 'a' as const, label: 'A', color: 'text-muted-foreground' }
		] as row}
			<div class="flex items-center gap-2">
				<span class="w-3 font-bold {row.color}">{row.label}</span>
				<select
					class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
					value={multi.composite[row.ch] ?? ''}
					onchange={(e) =>
						multi.onCompositeChange(row.ch, (e.target as HTMLSelectElement).value)}
				>
					{#if row.ch === 'a'}
						<option value="">{t('map.multiCogChannelNone')}</option>
					{/if}
					{#each multi.assets as asset (asset.key)}
						<option value={asset.key}>{multiAssetLabel(asset)}</option>
					{/each}
				</select>
			</div>
		{/each}
	</div>
{/if}

	{#if rescaleApplicable}
		<!-- GPU LinearRescale slider with histogram overlay. -->
		<div class="mt-2 space-y-1 border-t border-border pt-2">
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{t('cog.rescale')}</span>
				<button
					class="text-[10px] text-muted-foreground hover:text-card-foreground"
					onclick={resetRescale}
				>
					{t('cog.rescaleReset')}
				</button>
			</div>

			<RangeSlider
				min={0}
				max={1}
				step={0.01}
				value={[rescale.min, rescale.max]}
				histogram={histogramBars}
				formatLabel={fmtRescale}
				onValueChange={setRescaleRange}
			/>

			<div class="flex items-center gap-1.5">
				<label class="flex flex-1 items-center gap-1 text-[10px] text-muted-foreground">
					<span class="w-6">min</span>
					<input
						type="number"
						min="0"
						max="1"
						step="0.01"
						class="w-full rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
						value={rescale.min}
						oninput={(e) => setRescaleMin(Number((e.target as HTMLInputElement).value))}
					/>
				</label>
				<label class="flex flex-1 items-center gap-1 text-[10px] text-muted-foreground">
					<span class="w-6">max</span>
					<input
						type="number"
						min="0"
						max="1"
						step="0.01"
						class="w-full rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
						value={rescale.max}
						oninput={(e) => setRescaleMax(Number((e.target as HTMLInputElement).value))}
					/>
				</label>
			</div>
		</div>
	{/if}
</div>
