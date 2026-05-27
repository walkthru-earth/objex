<script lang="ts">
import {
	type FacetSet,
	type FacetState,
	formatDate,
	hasActiveFilters
} from '@walkthru-earth/objex-utils';
import type { Snippet } from 'svelte';
import { t } from '../../../i18n/index.svelte.js';
import { RangeSlider } from '../../ui/slider/index.js';

/**
 * Auto-faceted filter panel. Reads a `FacetSet` derived from the loaded
 * item views and renders only the controls that have variance for *this*
 * dataset. Currently surfaces:
 *   - Datetime range slider with histogram (when `facets.datetime` set)
 *   - Numeric range sliders for cloud cover / GSD (when present)
 *   - Enum chip lists for collection / platform / constellation /
 *     instruments / asset roles (when ≥2 distinct values)
 *
 * Mode awareness: this component does NOT push down to the API itself,
 * the parent decides whether the current `state` should be applied
 * client-side via `applyFacets` or translated to native query params via
 * `toNativeQuery`. We just edit `state` and emit `onChange`.
 */
let {
	facets,
	state,
	onChange,
	onClose,
	onReset,
	footer
}: {
	facets: FacetSet;
	state: FacetState;
	onChange: (next: FacetState) => void;
	onClose: () => void;
	onReset: () => void;
	/** Optional footer slot for fetch options (timeRange, itemLimit, mode label). */
	footer?: Snippet;
} = $props();

const NUMERIC_LABEL_KEYS: Record<string, string> = {
	cloudCover: 'stac.cloudCover',
	gsd: 'stac.gsd'
};

const ENUM_LABEL_KEYS: Record<string, string> = {
	collection: 'stac.collection',
	platform: 'stac.platform',
	constellation: 'stac.constellation',
	instruments: 'stac.instruments',
	assetRoles: 'stac.assetRoles'
};

function setDatetime(next: [number, number]): void {
	if (!facets.datetime) return;
	const minMs = Date.parse(facets.datetime.min);
	const maxMs = Date.parse(facets.datetime.max);
	const lo = next[0] <= minMs ? undefined : new Date(next[0]).toISOString();
	const hi = next[1] >= maxMs ? undefined : new Date(next[1]).toISOString();
	onChange({
		...state,
		datetime: lo || hi ? { min: lo, max: hi } : undefined
	});
}

function setNumeric(
	field: string,
	next: [number, number],
	facetMin: number,
	facetMax: number
): void {
	const lo = next[0] <= facetMin ? undefined : next[0];
	const hi = next[1] >= facetMax ? undefined : next[1];
	const numeric = { ...(state.numeric ?? {}) };
	if (lo == null && hi == null) {
		delete (numeric as Record<string, unknown>)[field];
	} else {
		(numeric as Record<string, unknown>)[field] = { min: lo, max: hi };
	}
	onChange({
		...state,
		numeric: Object.keys(numeric).length > 0 ? numeric : undefined
	});
}

function toggleEnum(field: string, value: string): void {
	const enums = { ...(state.enums ?? {}) };
	const current = (enums as Record<string, string[] | undefined>)[field] ?? [];
	const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
	if (next.length === 0) {
		delete (enums as Record<string, unknown>)[field];
	} else {
		(enums as Record<string, unknown>)[field] = next;
	}
	onChange({
		...state,
		enums: Object.keys(enums).length > 0 ? enums : undefined
	});
}

function isEnumActive(field: string, value: string): boolean {
	const list = (state.enums as Record<string, string[] | undefined> | undefined)?.[field];
	return Array.isArray(list) && list.includes(value);
}

const datetimeBounds = $derived(
	facets.datetime
		? ([Date.parse(facets.datetime.min), Date.parse(facets.datetime.max)] as [number, number])
		: null
);

const datetimeValue = $derived.by((): [number, number] | null => {
	if (!datetimeBounds) return null;
	const [lo, hi] = datetimeBounds;
	const stateLo = state.datetime?.min ? Date.parse(state.datetime.min) : lo;
	const stateHi = state.datetime?.max ? Date.parse(state.datetime.max) : hi;
	return [Number.isFinite(stateLo) ? stateLo : lo, Number.isFinite(stateHi) ? stateHi : hi];
});

function fmtDate(ms: number): string {
	if (!Number.isFinite(ms)) return '-';
	return formatDate(ms);
}

function fmtNumber(n: number): string {
	if (!Number.isFinite(n)) return '-';
	if (Math.abs(n) >= 100) return Math.round(n).toString();
	return n.toFixed(2);
}

const active = $derived(hasActiveFilters(state));
</script>

<div
	class="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex max-h-[70vh] flex-col gap-3 overflow-hidden rounded-t-xl border border-border bg-card/95 p-3 text-xs text-card-foreground shadow-lg backdrop-blur-sm sm:inset-x-auto sm:bottom-auto sm:end-2 sm:top-12 sm:max-h-[calc(100%-3.5rem)] sm:w-[min(360px,calc(100%-1rem))] sm:rounded-md"
>
	<header class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<span class="font-medium">{t('stac.filters')}</span>
			<span class="text-[10px] text-muted-foreground tabular-nums">
				{t('stac.facetTotal', { count: facets.total })}
			</span>
		</div>
		<div class="flex items-center gap-1">
			{#if active}
				<button
					class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
					onclick={onReset}
				>
					{t('stac.resetFilters')}
				</button>
			{/if}
			<button
				class="inline-flex min-h-9 min-w-9 items-center justify-center rounded p-0.5 text-base text-muted-foreground hover:bg-accent hover:text-card-foreground sm:min-h-0 sm:min-w-0 sm:text-xs"
				onclick={onClose}
				aria-label={t('stac.close')}
				style="touch-action: manipulation;"
			>
				&times;
			</button>
		</div>
	</header>

	<div class="overflow-y-auto pr-1">
		{#if !facets.datetime && facets.numeric.length === 0 && facets.enums.length === 0}
			<div class="text-[10px] text-muted-foreground">{t('stac.facetNoneAvailable')}</div>
		{/if}

		{#if facets.datetime && datetimeBounds && datetimeValue}
			<section class="mb-3">
				<div class="mb-1 flex items-baseline justify-between">
					<span class="text-muted-foreground">{t('stac.filterDatetime')}</span>
					<span class="text-[10px] tabular-nums text-muted-foreground">
						{facets.datetime.count}
					</span>
				</div>
				<RangeSlider
					min={datetimeBounds[0]}
					max={datetimeBounds[1]}
					value={datetimeValue}
					step={86_400_000}
					histogram={facets.datetime.bins}
					formatLabel={fmtDate}
					onValueCommit={setDatetime}
				/>
			</section>
		{/if}

		{#each facets.numeric as facet (facet.field)}
			{@const stateRange = state.numeric?.[facet.field]}
			{@const lo = stateRange?.min ?? facet.min}
			{@const hi = stateRange?.max ?? facet.max}
			<section class="mb-3">
				<div class="mb-1 flex items-baseline justify-between">
					<span class="text-muted-foreground">{t(NUMERIC_LABEL_KEYS[facet.field] ?? facet.field)}</span>
					<span class="text-[10px] tabular-nums text-muted-foreground">{facet.count}</span>
				</div>
				<RangeSlider
					min={facet.min}
					max={facet.max}
					value={[lo, hi]}
					step={Math.max((facet.max - facet.min) / 200, 0.01)}
					formatLabel={fmtNumber}
					onValueCommit={(next) => setNumeric(facet.field, next, facet.min, facet.max)}
				/>
			</section>
		{/each}

		{#each facets.enums as facet (facet.field)}
			<section class="mb-3">
				<div class="mb-1 text-muted-foreground">
					{t(ENUM_LABEL_KEYS[facet.field] ?? facet.field)}
				</div>
				<div class="flex flex-wrap gap-1">
					{#each facet.values as entry (entry.value)}
						{@const on = isEnumActive(facet.field, entry.value)}
						<button
							type="button"
							class="rounded-full border px-2 py-0.5 text-[10px] transition-colors"
							class:border-primary={on}
							class:bg-primary={on}
							class:text-primary-foreground={on}
							class:border-input={!on}
							class:hover:bg-accent={!on}
							onclick={() => toggleEnum(facet.field, entry.value)}
						>
							{entry.value}
							<span class="ms-1 text-[9px] opacity-70 tabular-nums">{entry.count}</span>
						</button>
					{/each}
				</div>
			</section>
		{/each}

		{#if footer}
			<div class="mt-2 border-t border-border pt-3">
				{@render footer()}
			</div>
		{/if}
	</div>
</div>
