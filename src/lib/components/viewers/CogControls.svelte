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

let {
	bandCount,
	bandConfig,
	onConfigChange,
	rescale,
	rescaleApplicable,
	onRescaleChange,
	histogram = null,
	mode = 'single'
}: {
	bandCount: number;
	/** Required when `mode === 'single'`, ignored when `mode === 'multi'`. */
	bandConfig?: BandConfig;
	onConfigChange: (config: BandConfig) => void;
	rescale: RescaleConfig;
	rescaleApplicable: boolean;
	onRescaleChange: (rescale: RescaleConfig) => void;
	/** Optional histogram bins (normalized, single-band only) for the slider overlay. */
	histogram?: Uint32Array | null;
	mode?: 'single' | 'multi';
} = $props();

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

function setMode(mode: 'rgb' | 'single') {
	if (!bandConfig) return;
	onConfigChange({ ...bandConfig, mode });
}

function setBand(key: 'rBand' | 'gBand' | 'bBand' | 'band', value: number) {
	if (!bandConfig) return;
	onConfigChange({ ...bandConfig, [key]: value });
}

function setRamp(id: ColorRampId) {
	if (!bandConfig) return;
	onConfigChange({ ...bandConfig, colorRamp: id });
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

function resetRescale() {
	onRescaleChange({ ...DEFAULT_RESCALE });
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
{#if mode === 'single' && bandConfig}
	<!-- Mode toggle -->
	<div class="mb-2 flex gap-1">
		<button
			class="flex-1 rounded px-2 py-1 transition-colors"
			class:bg-primary={bandConfig.mode === 'rgb'}
			class:text-primary-foreground={bandConfig.mode === 'rgb'}
			class:bg-muted={bandConfig.mode !== 'rgb'}
			onclick={() => setMode('rgb')}
		>
			RGB
		</button>
		<button
			class="flex-1 rounded px-2 py-1 transition-colors"
			class:bg-primary={bandConfig.mode === 'single'}
			class:text-primary-foreground={bandConfig.mode === 'single'}
			class:bg-muted={bandConfig.mode !== 'single'}
			onclick={() => setMode('single')}
		>
			{t('cog.singleBand')}
		</button>
	</div>

	{#if bandConfig.mode === 'rgb'}
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
						value={bandConfig[ch.key]}
						onchange={(e) =>
							setBand(ch.key, Number((e.target as HTMLSelectElement).value))}
					>
						{#each bandOptions(bandCount) as opt}
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
				value={bandConfig.band}
				onchange={(e) =>
					setBand('band', Number((e.target as HTMLSelectElement).value))}
			>
				{#each bandOptions(bandCount) as opt}
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
							class="flex flex-col items-stretch rounded border px-1 py-0.5 transition-colors {bandConfig.colorRamp === id ? 'border-primary bg-muted' : 'border-transparent hover:border-border'}"
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
						class="flex w-full items-center gap-2 px-1.5 py-0.5 text-left text-[11px] transition-colors {bandConfig.colorRamp === id ? 'bg-muted' : 'hover:bg-muted/60'}"
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

			<!-- Histogram + range visualization -->
			{#if histogramBars}
				<div class="relative h-8 w-full rounded bg-background/60">
					<!-- Histogram bars -->
					<svg
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
						class="absolute inset-0 h-full w-full"
						aria-hidden="true"
					>
						{#each histogramBars as h, i}
							<rect
								x={(i * 100) / histogramBars.length}
								y={100 - h * 100}
								width={100 / histogramBars.length}
								height={h * 100}
								class="fill-primary/40"
							/>
						{/each}
					</svg>
					<!-- Active rescale window -->
					<div
						class="pointer-events-none absolute inset-y-0 border-x border-primary bg-primary/10"
						style="left: {rescale.min * 100}%; right: {(1 - rescale.max) * 100}%;"
					></div>
				</div>
			{/if}

			<div class="flex items-center gap-1.5">
				<input
					type="number"
					min="0"
					max="1"
					step="0.01"
					class="w-14 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
					value={rescale.min}
					oninput={(e) => setRescaleMin(Number((e.target as HTMLInputElement).value))}
				/>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					class="flex-1 accent-primary"
					value={rescale.min}
					oninput={(e) => setRescaleMin(Number((e.target as HTMLInputElement).value))}
				/>
			</div>
			<div class="flex items-center gap-1.5">
				<input
					type="number"
					min="0"
					max="1"
					step="0.01"
					class="w-14 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
					value={rescale.max}
					oninput={(e) => setRescaleMax(Number((e.target as HTMLInputElement).value))}
				/>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					class="flex-1 accent-primary"
					value={rescale.max}
					oninput={(e) => setRescaleMax(Number((e.target as HTMLInputElement).value))}
				/>
			</div>
		</div>
	{/if}
</div>
