<script lang="ts">
import { t } from '../../i18n/index.svelte.js';
import type { PresetDef } from '../../utils/channel-composite.js';
import {
	type BandConfig,
	type ColorRampId,
	DEFAULT_NODATA_CONFIG,
	DEFAULT_RESCALE,
	type NodataConfig,
	type NodataMode,
	type RescaleConfig
} from '../../utils/cog.js';
import type { ChannelComposite, ChannelRef, CogAsset } from '../../utils/cog-asset.js';
import {
	COLORMAP_INDEX,
	COLORMAP_NAMES,
	COLORMAP_SPRITE_LAYERS,
	COLORMAP_SPRITE_URL
} from '../../utils/colormap-sprite.js';
import { RangeSlider } from '../ui/slider/index.js';
import ChannelPicker from './cog/ChannelPicker.svelte';

type Props = {
	/** All raster-COG-ish assets on the current item (or `[selfAsset]` for plain CogViewer). */
	assets: CogAsset[];
	/** Current RGB composite. Always present. */
	composite: ChannelComposite;
	onCompositeChange: (next: ChannelComposite) => void;
	/** Presets that resolve on this item. Empty when no preset applies. */
	presets: PresetDef[];
	activePresetId: string;
	onPresetChange: (id: string) => void;
	/** Rendering mode toggle: 'rgb' uses the channel pickers; 'single' the band+ramp picker. */
	mode: 'rgb' | 'single';
	onModeChange: (m: 'rgb' | 'single') => void;
	/** Band/ramp config used when mode === 'single'. Optional for RGB-only callers. */
	bandConfig?: BandConfig | null;
	bandCount?: number;
	onBandConfigChange?: (next: BandConfig) => void;
	rescale: RescaleConfig;
	rescaleApplicable: boolean;
	onRescaleChange: (next: RescaleConfig) => void;
	histogram?: Uint32Array | null;
	/** Optional 4th channel UI affordance (alpha). When false, alpha row is hidden. */
	showAlpha?: boolean;
	/** User-selected nodata config. Default `{ mode: 'auto' }`. */
	nodata?: NodataConfig;
	/**
	 * Value resolved by the viewer for Auto mode (typically the GeoTIFF's
	 * GDAL_NODATA tag). Surfaced as a hint pill next to the segmented control.
	 * `null` means the file has no GDAL_NODATA tag.
	 */
	autoNodata?: number | null;
	/** Fired when the user changes nodata mode or value. */
	onNodataChange?: (next: NodataConfig) => void;
};

const props: Props = $props();

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

function setChannel(channel: 'r' | 'g' | 'b' | 'a', next: ChannelRef): void {
	if (channel === 'a') {
		const c = { ...props.composite, a: next.assetKey ? next : undefined };
		props.onCompositeChange(c);
		return;
	}
	props.onCompositeChange({ ...props.composite, [channel]: next });
}

function setMode(m: 'rgb' | 'single'): void {
	props.onModeChange(m);
}

function setBand(value: number): void {
	if (!props.bandConfig || !props.onBandConfigChange) return;
	props.onBandConfigChange({ ...props.bandConfig, band: value });
}

function setRamp(id: ColorRampId): void {
	if (!props.bandConfig || !props.onBandConfigChange) return;
	props.onBandConfigChange({ ...props.bandConfig, colorRamp: id });
}

function bandOptions(count: number): { value: number; label: string }[] {
	return Array.from({ length: count }, (_, i) => ({
		value: i,
		label: `${t('cog.band')} ${i + 1}`
	}));
}

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

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

function setRescaleMin(value: number): void {
	const clamped = clamp01(value);
	const next = Math.min(clamped, props.rescale.max - 0.001);
	props.onRescaleChange({ min: Number.isFinite(next) ? next : 0, max: props.rescale.max });
}

function setRescaleMax(value: number): void {
	const clamped = clamp01(value);
	const next = Math.max(clamped, props.rescale.min + 0.001);
	props.onRescaleChange({ min: props.rescale.min, max: Number.isFinite(next) ? next : 1 });
}

function setRescaleRange(next: [number, number]): void {
	const lo = clamp01(next[0]);
	const hi = clamp01(next[1]);
	props.onRescaleChange({ min: Math.min(lo, hi), max: Math.max(lo, hi) });
}

function resetRescale(): void {
	props.onRescaleChange({ ...DEFAULT_RESCALE });
}

function fmtRescale(n: number): string {
	return n.toFixed(2);
}

const nodataCfg = $derived(props.nodata ?? DEFAULT_NODATA_CONFIG);

function fmtAutoNodata(v: number | null | undefined): string {
	if (v === null || v === undefined) return '';
	if (Number.isNaN(v)) return 'NaN';
	return String(v);
}

function setNodataMode(mode: NodataMode): void {
	if (!props.onNodataChange) return;
	if (mode === nodataCfg.mode) return;
	if (mode === 'value') {
		const seed =
			typeof nodataCfg.value === 'number'
				? nodataCfg.value
				: typeof props.autoNodata === 'number' && Number.isFinite(props.autoNodata)
					? props.autoNodata
					: 0;
		props.onNodataChange({ mode: 'value', value: seed });
		return;
	}
	props.onNodataChange({ mode });
}

function setNodataValue(raw: string): void {
	if (!props.onNodataChange) return;
	const trimmed = raw.trim().toLowerCase();
	if (trimmed === 'nan') {
		props.onNodataChange({ mode: 'value', value: Number.NaN });
		return;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) && !Number.isNaN(parsed)) return;
	props.onNodataChange({ mode: 'value', value: parsed });
}

// B4: Track viewport width to downsample the histogram on narrow phones.
// We only flip when crossing the `sm` breakpoint (640px) so the $derived
// below only re-runs on rotate/resize-across-threshold, not on every px.
let narrowViewport = $state(false);

$effect(() => {
	if (typeof window === 'undefined') return;
	const compute = () => {
		narrowViewport = window.innerWidth < 640;
	};
	compute();
	window.addEventListener('resize', compute);
	return () => window.removeEventListener('resize', compute);
});

// Fold 128-bin histogram down to 64 on narrow viewports so each bar gets
// at least ~2px of width inside the slimmed-down panel.
const effectiveHistogram = $derived.by<Uint32Array | null | undefined>(() => {
	const h = props.histogram;
	if (!h) return h;
	if (!narrowViewport || h.length !== 128) return h;
	const out = new Uint32Array(64);
	for (let i = 0; i < 64; i++) out[i] = h[2 * i] + h[2 * i + 1];
	return out;
});

const histogramBars = $derived.by(() => {
	const h = effectiveHistogram;
	if (!h || h.length === 0) return null;
	let max = 0;
	for (const v of h) if (v > max) max = v;
	if (max === 0) return null;
	return Array.from(h, (count) => count / max);
});
</script>

<div
	class="absolute right-2 top-10 z-10 w-[min(18rem,calc(100vw-1rem))] max-h-[calc(100vh-6rem)] overflow-y-auto rounded bg-card/90 p-2.5 text-xs text-card-foreground backdrop-blur-sm sm:w-72"
>
	{#if props.presets.length > 0 && props.mode === 'rgb'}
		<div class="mb-2 flex items-center gap-2">
			<span class="text-muted-foreground">{t('map.multiCogPreset.label')}</span>
			<select
				class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				value={props.activePresetId}
				onchange={(e) => props.onPresetChange((e.target as HTMLSelectElement).value)}
			>
				{#if !props.activePresetId}
					<option value="">{t('map.multiCogPreset.custom')}</option>
				{/if}
				{#each props.presets as p (p.id)}
					<option value={p.id}>{t(p.labelKey)}</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if props.bandConfig && props.onBandConfigChange}
		<div class="mb-2 flex gap-1">
			<button
				class="flex-1 rounded px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
				class:bg-primary={props.mode === 'rgb'}
				class:text-primary-foreground={props.mode === 'rgb'}
				class:bg-muted={props.mode !== 'rgb'}
				onclick={() => setMode('rgb')}
			>
				RGB
			</button>
			<button
				class="flex-1 rounded px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
				class:bg-primary={props.mode === 'single'}
				class:text-primary-foreground={props.mode === 'single'}
				class:bg-muted={props.mode !== 'single'}
				onclick={() => setMode('single')}
			>
				{t('cog.singleBand')}
			</button>
		</div>
	{/if}

	{#if props.mode === 'rgb'}
		<div class="space-y-1">
			<ChannelPicker
				channel="r"
				label="R"
				colorClass="text-red-400"
				assets={props.assets}
				value={props.composite.r}
				onChange={(next) => setChannel('r', next)}
			/>
			<ChannelPicker
				channel="g"
				label="G"
				colorClass="text-green-400"
				assets={props.assets}
				value={props.composite.g}
				onChange={(next) => setChannel('g', next)}
			/>
			<ChannelPicker
				channel="b"
				label="B"
				colorClass="text-blue-400"
				assets={props.assets}
				value={props.composite.b}
				onChange={(next) => setChannel('b', next)}
			/>
			{#if props.showAlpha}
				<ChannelPicker
					channel="a"
					label="A"
					colorClass="text-muted-foreground"
					assets={props.assets}
					value={props.composite.a ?? { assetKey: '', bandIndex: 0 }}
					onChange={(next) => setChannel('a', next)}
					allowNone
				/>
			{/if}
		</div>
	{:else if props.bandConfig && typeof props.bandCount === 'number'}
		<div class="mb-2 flex items-center gap-2">
			<span class="text-muted-foreground">{t('cog.band')}</span>
			<select
				class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				value={props.bandConfig.band}
				onchange={(e) => setBand(Number((e.target as HTMLSelectElement).value))}
			>
				{#each bandOptions(props.bandCount) as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<div class="space-y-1">
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{t('cog.colorRamp')}</span>
				<span class="text-[10px] text-muted-foreground tabular-nums">
					{filteredRamps.length}/{COLORMAP_NAMES.length}
				</span>
			</div>

			{#if !rampQuery}
				<div class="grid grid-cols-2 gap-1">
					{#each PINNED_RAMPS as id (id)}
						<button
							class="flex flex-col items-stretch rounded border px-1 py-0.5 transition-colors {props.bandConfig.colorRamp === id ? 'border-primary bg-muted' : 'border-transparent hover:border-border'}"
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

			<input
				type="search"
				placeholder={t('cog.colorRampSearch')}
				class="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
				value={rampQuery}
				oninput={(e) => (rampQuery = (e.target as HTMLInputElement).value)}
			/>
			<div class="max-h-40 overflow-y-auto rounded border border-border">
				{#each filteredRamps as id (id)}
					<button
						class="flex w-full items-center gap-2 px-1.5 py-0.5 text-left text-[11px] transition-colors {props.bandConfig.colorRamp === id ? 'bg-muted' : 'hover:bg-muted/60'}"
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

	{#if props.rescaleApplicable}
		<div class="mt-2 space-y-1 border-t border-border pt-2">
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{t('cog.rescale.label')}</span>
				<button
					class="rounded text-[10px] text-muted-foreground hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
					onclick={resetRescale}
				>
					{t('cog.rescale.reset')}
				</button>
			</div>

			<RangeSlider
				min={0}
				max={1}
				step={0.01}
				value={[props.rescale.min, props.rescale.max]}
				histogram={histogramBars}
				formatLabel={fmtRescale}
				onValueChange={setRescaleRange}
			/>

			<div class="flex items-center gap-1.5">
				<label class="flex flex-1 items-center gap-1 text-[10px] text-muted-foreground">
					<span class="w-6">min</span>
					<input
						type="number"
						inputmode="decimal"
						min="0"
						max="1"
						step="0.01"
						class="min-h-11 w-full rounded border border-border bg-background px-2 py-1.5 text-sm tabular-nums sm:min-h-0 sm:px-1 sm:py-0.5 sm:text-[11px]"
						value={props.rescale.min}
						oninput={(e) => setRescaleMin(Number((e.target as HTMLInputElement).value))}
					/>
				</label>
				<label class="flex flex-1 items-center gap-1 text-[10px] text-muted-foreground">
					<span class="w-6">max</span>
					<input
						type="number"
						inputmode="decimal"
						min="0"
						max="1"
						step="0.01"
						class="min-h-11 w-full rounded border border-border bg-background px-2 py-1.5 text-sm tabular-nums sm:min-h-0 sm:px-1 sm:py-0.5 sm:text-[11px]"
						value={props.rescale.max}
						oninput={(e) => setRescaleMax(Number((e.target as HTMLInputElement).value))}
					/>
				</label>
			</div>
		</div>
	{/if}

	{#if props.onNodataChange}
		<div class="mt-2 space-y-1 border-t border-border pt-2">
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{t('cog.nodata.label')}</span>
				{#if nodataCfg.mode === 'auto'}
					<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{props.autoNodata === null || props.autoNodata === undefined
							? t('cog.nodata.autoNone')
							: t('cog.nodata.autoHint', { value: fmtAutoNodata(props.autoNodata) })}
					</span>
				{/if}
			</div>

			<div
				class="flex w-full gap-1"
				role="radiogroup"
				aria-label={t('cog.nodata.label')}
				tabindex={-1}
				onkeydown={(e) => {
					const modes = ['auto', 'value', 'off'] as const;
					const i = modes.indexOf(nodataCfg.mode);
					let next: NodataMode | null = null;
					if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = modes[(i + 1) % 3];
					else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = modes[(i + 2) % 3];
					else if (e.key === 'Home') next = modes[0];
					else if (e.key === 'End') next = modes[2];
					if (next) {
						e.preventDefault();
						setNodataMode(next);
						const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
							'button[role="radio"]'
						);
						buttons[modes.indexOf(next)]?.focus();
					}
				}}
			>
				{#each ['auto', 'value', 'off'] as const as mode (mode)}
					<button
						type="button"
						role="radio"
						aria-checked={nodataCfg.mode === mode}
						tabindex={nodataCfg.mode === mode ? 0 : -1}
						class="min-h-11 flex-1 rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:min-h-0 sm:py-1.5"
						class:bg-primary={nodataCfg.mode === mode}
						class:text-primary-foreground={nodataCfg.mode === mode}
						class:bg-muted={nodataCfg.mode !== mode}
						onclick={() => setNodataMode(mode)}
					>
						{t(`cog.nodata.${mode}`)}
					</button>
				{/each}
			</div>

			{#if nodataCfg.mode === 'value'}
				<input
					type="text"
					inputmode="decimal"
					placeholder={t('cog.nodata.valuePlaceholder')}
					class="min-h-11 w-full rounded border border-border bg-background px-2 py-1.5 text-sm tabular-nums sm:min-h-0 sm:px-1.5 sm:py-1 sm:text-[11px]"
					value={Number.isNaN(nodataCfg.value as number) ? 'NaN' : (nodataCfg.value ?? '')}
					oninput={(e) => setNodataValue((e.target as HTMLInputElement).value)}
				/>
			{/if}
		</div>
	{/if}
</div>
