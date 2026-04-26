<script lang="ts">
import { onDestroy } from 'svelte';
import { t } from '../../../i18n/index.svelte.js';

/**
 * Dual-handle numeric range slider with optional histogram bars rendered
 * behind the track. Pure Svelte + DOM, no external dependency. Emits
 * normalized `[min, max]` numbers (the parent decides whether to interpret
 * them as timestamps, percentages, or anything else).
 *
 * Pointer model: each handle owns a `pointermove` listener attached to
 * `window` only while a drag is in progress, with `setPointerCapture` so
 * the user can drag past the track edges without the slider losing focus.
 * `Escape` cancels a drag, `Home` / `End` jump to clamped bounds.
 */
let {
	min,
	max,
	value,
	step = 1,
	histogram,
	formatLabel,
	onChange
}: {
	min: number;
	max: number;
	value: [number, number];
	step?: number;
	/** Optional bin counts to draw behind the track. Length is independent of step. */
	histogram?: readonly number[] | null;
	/** Per-handle label formatter, defaults to integer rounding. */
	formatLabel?: (n: number) => string;
	onChange: (next: [number, number]) => void;
} = $props();

let trackEl: HTMLDivElement | null = $state(null);
let dragging = $state<'lo' | 'hi' | null>(null);
let dragStartValue: [number, number] | null = null;

const span = $derived(Math.max(1e-9, max - min));
const loPct = $derived(((value[0] - min) / span) * 100);
const hiPct = $derived(((value[1] - min) / span) * 100);
const histMax = $derived(histogram?.length ? Math.max(1, ...histogram) : 1);

function clamp(n: number): number {
	return Math.max(min, Math.min(max, n));
}

function snap(n: number): number {
	if (step <= 0) return clamp(n);
	const snapped = Math.round((n - min) / step) * step + min;
	return clamp(snapped);
}

function pctToValue(pct: number): number {
	return snap(min + (pct / 100) * span);
}

function trackPctFromEvent(e: PointerEvent): number {
	if (!trackEl) return 0;
	const rect = trackEl.getBoundingClientRect();
	if (rect.width <= 0) return 0;
	// RTL flips the direction so the lo/hi handles still feel "left = older".
	const dir = getComputedStyle(trackEl).direction;
	const x = e.clientX - rect.left;
	const ratio = dir === 'rtl' ? 1 - x / rect.width : x / rect.width;
	return Math.max(0, Math.min(100, ratio * 100));
}

function startDrag(handle: 'lo' | 'hi', e: PointerEvent): void {
	dragging = handle;
	dragStartValue = [value[0], value[1]];
	(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	window.addEventListener('pointermove', onPointerMove);
	window.addEventListener('pointerup', endDrag);
	window.addEventListener('keydown', onCancelKey);
}

function onPointerMove(e: PointerEvent): void {
	if (!dragging) return;
	const next = pctToValue(trackPctFromEvent(e));
	if (dragging === 'lo') {
		const lo = Math.min(next, value[1]);
		if (lo !== value[0]) onChange([lo, value[1]]);
	} else {
		const hi = Math.max(next, value[0]);
		if (hi !== value[1]) onChange([value[0], hi]);
	}
}

function endDrag(): void {
	dragging = null;
	dragStartValue = null;
	window.removeEventListener('pointermove', onPointerMove);
	window.removeEventListener('pointerup', endDrag);
	window.removeEventListener('keydown', onCancelKey);
}

function onCancelKey(e: KeyboardEvent): void {
	if (e.key === 'Escape' && dragStartValue) {
		onChange(dragStartValue);
		endDrag();
	}
}

function onHandleKey(handle: 'lo' | 'hi', e: KeyboardEvent): void {
	const arrow = e.key;
	const big = e.shiftKey ? 10 : 1;
	const delta =
		arrow === 'ArrowLeft' || arrow === 'ArrowDown'
			? -step * big
			: arrow === 'ArrowRight' || arrow === 'ArrowUp'
				? step * big
				: 0;
	if (delta !== 0) {
		e.preventDefault();
		if (handle === 'lo') {
			const lo = Math.min(value[1], snap(value[0] + delta));
			if (lo !== value[0]) onChange([lo, value[1]]);
		} else {
			const hi = Math.max(value[0], snap(value[1] + delta));
			if (hi !== value[1]) onChange([value[0], hi]);
		}
		return;
	}
	if (arrow === 'Home') {
		e.preventDefault();
		if (handle === 'lo') onChange([min, value[1]]);
		else onChange([value[0], Math.max(value[0], min)]);
	} else if (arrow === 'End') {
		e.preventDefault();
		if (handle === 'lo') onChange([Math.min(max, value[1]), value[1]]);
		else onChange([value[0], max]);
	}
}

const labelFn = $derived(formatLabel ?? ((n: number) => Math.round(n).toString()));

onDestroy(endDrag);
</script>

<div class="flex flex-col gap-1.5">
	<div class="relative h-10 select-none px-2">
		<div class="relative h-full" bind:this={trackEl}>
			{#if histogram && histogram.length > 0}
				<div class="absolute inset-x-0 top-0 flex h-6 items-end gap-px">
					{#each histogram as count, i (i)}
						<div
							class="flex-1 rounded-sm bg-muted-foreground/30"
							style="height: {Math.max(2, (count / histMax) * 100)}%"
						></div>
					{/each}
				</div>
			{/if}
			<div class="absolute inset-x-0 bottom-2 h-1 rounded-full bg-muted">
				<div
					class="absolute h-full rounded-full bg-primary"
					style="inset-inline-start: {loPct}%; width: {Math.max(0, hiPct - loPct)}%"
				></div>
			</div>
			<button
				type="button"
				class="absolute bottom-0.5 z-10 size-4 -translate-x-1/2 cursor-pointer rounded-full border-2 border-primary bg-background shadow-md focus:outline-none focus:ring-2 focus:ring-primary/50"
				class:cursor-grabbing={dragging === 'lo'}
				style="inset-inline-start: {loPct}%"
				aria-label={t('stac.rangeLowerBound')}
				role="slider"
				aria-valuemin={min}
				aria-valuemax={value[1]}
				aria-valuenow={value[0]}
				onpointerdown={(e) => startDrag('lo', e)}
				onkeydown={(e) => onHandleKey('lo', e)}
			></button>
			<button
				type="button"
				class="absolute bottom-0.5 z-10 size-4 -translate-x-1/2 cursor-pointer rounded-full border-2 border-primary bg-background shadow-md focus:outline-none focus:ring-2 focus:ring-primary/50"
				class:cursor-grabbing={dragging === 'hi'}
				style="inset-inline-start: {hiPct}%"
				aria-label={t('stac.rangeUpperBound')}
				role="slider"
				aria-valuemin={value[0]}
				aria-valuemax={max}
				aria-valuenow={value[1]}
				onpointerdown={(e) => startDrag('hi', e)}
				onkeydown={(e) => onHandleKey('hi', e)}
			></button>
		</div>
	</div>
	<div class="flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
		<span>{labelFn(value[0])}</span>
		<span>{labelFn(value[1])}</span>
	</div>
</div>
