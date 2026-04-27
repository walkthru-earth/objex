<script lang="ts">
import { cn } from '$lib/utils.js';
import Slider from './slider.svelte';

/**
 * Dual-thumb numeric range slider with optional histogram bars rendered
 * behind the track and a min/max label row beneath. Composes the shadcn
 * `Slider` primitive (bits-ui) so pointer, keyboard, RTL, and a11y
 * behavior come from the primitive instead of being reimplemented.
 *
 * Used by:
 *   - StacDatetimeBar / StacFilterPanel (datetime + numeric facets, with histogram)
 *   - CogControls (rescale min/max, no histogram, paired number inputs)
 */
let {
	value = $bindable<[number, number]>([0, 1]),
	min,
	max,
	step = 1,
	histogram,
	formatLabel,
	loLabel,
	hiLabel,
	class: className,
	disabled = false,
	onValueChange,
	onValueCommit
}: {
	value?: [number, number];
	min: number;
	max: number;
	step?: number;
	/** Optional bin counts to draw behind the track. */
	histogram?: readonly number[] | null;
	/** Formatter for the default min/max label row. Omit to hide labels. */
	formatLabel?: (n: number) => string;
	/** Override the lower label (takes precedence over `formatLabel(value[0])`). */
	loLabel?: string;
	/** Override the upper label (takes precedence over `formatLabel(value[1])`). */
	hiLabel?: string;
	class?: string;
	disabled?: boolean;
	onValueChange?: (next: [number, number]) => void;
	onValueCommit?: (next: [number, number]) => void;
} = $props();

const histMax = $derived(histogram?.length ? Math.max(1, ...histogram) : 1);
const showLabels = $derived(Boolean(formatLabel) || loLabel != null || hiLabel != null);

function emitChange(next: number[]): void {
	if (next.length >= 2) onValueChange?.([next[0], next[1]]);
}

function emitCommit(next: number[]): void {
	if (next.length >= 2) onValueCommit?.([next[0], next[1]]);
}
</script>

<div class={cn('flex flex-col gap-1.5', className)}>
	<div class="relative px-2">
		{#if histogram && histogram.length > 0}
			<div
				class="pointer-events-none absolute inset-x-2 top-0 flex h-6 items-end gap-px"
				aria-hidden="true"
			>
				{#each histogram as count, i (i)}
					<div
						class="bg-muted-foreground/30 flex-1 rounded-sm"
						style="height: {Math.max(2, (count / histMax) * 100)}%"
					></div>
				{/each}
			</div>
		{/if}
		<Slider
			type="multiple"
			bind:value={value as never}
			{min}
			{max}
			{step}
			{disabled}
			onValueChange={emitChange}
			onValueCommit={emitCommit}
			class={cn(histogram && histogram.length > 0 && 'mt-7')}
		/>
	</div>
	{#if showLabels}
		<div
			class="text-muted-foreground flex items-center justify-between px-2 text-[10px] tabular-nums"
		>
			<span>{loLabel ?? (formatLabel ? formatLabel(value[0]) : '')}</span>
			<span>{hiLabel ?? (formatLabel ? formatLabel(value[1]) : '')}</span>
		</div>
	{/if}
</div>
