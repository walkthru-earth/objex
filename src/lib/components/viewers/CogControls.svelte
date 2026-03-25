<script lang="ts">
import { t } from '../../i18n/index.svelte.js';
import {
	type BandConfig,
	COLOR_RAMP_STOPS,
	type ColorRampId,
	rampToGradientCss
} from '../../utils/cog.js';

let {
	bandCount,
	bandConfig,
	onConfigChange
}: {
	bandCount: number;
	bandConfig: BandConfig;
	onConfigChange: (config: BandConfig) => void;
} = $props();

const RAMP_IDS: ColorRampId[] = ['grayscale', 'terrain', 'viridis', 'magma', 'turbo', 'spectral'];

function bandOptions(count: number): { value: number; label: string }[] {
	return Array.from({ length: count }, (_, i) => ({
		value: i,
		label: `${t('cog.band')} ${i + 1}`
	}));
}

function setMode(mode: 'rgb' | 'single') {
	onConfigChange({ ...bandConfig, mode });
}

function setBand(key: 'rBand' | 'gBand' | 'bBand' | 'band', value: number) {
	onConfigChange({ ...bandConfig, [key]: value });
}

function setRamp(id: ColorRampId) {
	onConfigChange({ ...bandConfig, colorRamp: id });
}
</script>

<div
	class="absolute right-2 top-10 z-10 w-52 rounded bg-card/90 p-2.5 text-xs text-card-foreground backdrop-blur-sm"
>
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
			<span class="text-muted-foreground">{t('cog.colorRamp')}</span>
			<div class="grid grid-cols-2 gap-1">
				{#each RAMP_IDS as id}
					<button
						class="flex flex-col items-stretch rounded border px-1 py-0.5 transition-colors {bandConfig.colorRamp === id ? 'border-primary bg-muted' : 'border-transparent'}"
						onclick={() => setRamp(id)}
						title={id}
					>
						<div
							class="h-2.5 w-full rounded-sm"
							style="background: {rampToGradientCss(id)}"
						></div>
						<span class="mt-0.5 text-center text-[10px] capitalize text-muted-foreground">
							{id}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
