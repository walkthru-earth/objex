<script lang="ts">
import { t } from '../../../i18n/index.svelte.js';
import { formatDate } from '../../../utils/format.js';
import type { DatetimeFacet, FacetState } from '../../../utils/stac-facets.js';
import { RangeSlider } from '../../ui/slider/index.js';

/**
 * Datetime range picker that sits above the item strip. Replaces the older
 * preset dropdown ("last 7 days / 30 days / ...") with a continuous slider
 * over the loaded items' min/max datetime, plus two `<input type="date">`
 * fields for exact start / end picking. The histogram of loaded items is
 * drawn behind the slider so the user can see where data is dense.
 *
 * State flows one-way: this component reads `facet` (built from the loaded
 * items) and `state.datetime`, and emits `onChange(next)` with the merged
 * `FacetState`. The parent decides how to apply it (push-down vs client-side).
 *
 * **Bbox scoping**: The parent (`StacMosaicViewer`) builds `facet` from
 * `committedViews`, which is bbox-scoped in `api` and `parquet` modes (those
 * sources push the viewport bbox to the server / SQL). So in viewport modes
 * the histogram always reflects "what's available in the current bbox" and
 * a pan triggers a fresh build via `reloadViewport()`. In `static` mode the
 * histogram is global to the catalog by design (see the parent's `facets`
 * derivation comment for why we do not client-side clip there).
 */
let {
	facet,
	state,
	onChange
}: {
	/** DatetimeFacet built from the loaded items, or null when no datetime variance. */
	facet: DatetimeFacet | null;
	state: FacetState;
	onChange: (next: FacetState) => void;
} = $props();

const bounds = $derived(
	facet ? ([Date.parse(facet.min), Date.parse(facet.max)] as [number, number]) : null
);

const sliderValue = $derived.by((): [number, number] | null => {
	if (!bounds) return null;
	const [lo, hi] = bounds;
	const stateLo = state.datetime?.min ? Date.parse(state.datetime.min) : lo;
	const stateHi = state.datetime?.max ? Date.parse(state.datetime.max) : hi;
	return [Number.isFinite(stateLo) ? stateLo : lo, Number.isFinite(stateHi) ? stateHi : hi];
});

function emit(min: string | undefined, max: string | undefined): void {
	onChange({
		...state,
		datetime: min || max ? { min, max } : undefined
	});
}

function setSlider(next: [number, number]): void {
	if (!bounds) return;
	const lo = next[0] <= bounds[0] ? undefined : new Date(next[0]).toISOString();
	const hi = next[1] >= bounds[1] ? undefined : new Date(next[1]).toISOString();
	emit(lo, hi);
}

/** ISO 8601 → `YYYY-MM-DD` for `<input type="date">` value. */
function isoToDateInput(iso: string | undefined): string {
	if (!iso) return '';
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	return new Date(t).toISOString().slice(0, 10);
}

/** `<input type="date">` value → ISO 8601 (start of UTC day for min, end for max). */
function dateInputToIso(value: string, kind: 'min' | 'max'): string | undefined {
	if (!value) return undefined;
	const stamp = kind === 'min' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
	const t = Date.parse(stamp);
	return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function onMinInput(e: Event): void {
	const v = (e.target as HTMLInputElement).value;
	emit(dateInputToIso(v, 'min'), state.datetime?.max);
}

function onMaxInput(e: Event): void {
	const v = (e.target as HTMLInputElement).value;
	emit(state.datetime?.min, dateInputToIso(v, 'max'));
}

function clearRange(): void {
	emit(undefined, undefined);
}

/** `YYYY-MM-DD` for today (UTC) — used as the max-input default. */
function todayDateInput(): string {
	return new Date().toISOString().slice(0, 10);
}

// Display defaults when the user has not set a filter yet:
//   - min input falls back to the earliest datetime in the loaded data
//     (`facet.min`), so the input hints at the available range instead of
//     showing `mm / dd / yyyy`.
//   - max input falls back to "today" so the visible window always extends
//     to "now" regardless of whether items in the current viewport are
//     stale. Both fallbacks are display-only — the actual `state.datetime`
//     stays undefined until the user picks a value, so an empty `state`
//     means "no filter" not "filter by today".
const minInputValue = $derived(
	isoToDateInput(state.datetime?.min) || (facet ? isoToDateInput(facet.min) : '')
);
const maxInputValue = $derived(isoToDateInput(state.datetime?.max) || todayDateInput());
const isActive = $derived(Boolean(state.datetime?.min || state.datetime?.max));

function fmtDate(ms: number): string {
	if (!Number.isFinite(ms)) return '-';
	return formatDate(ms);
}

const granularityLabel = $derived.by((): string | null => {
	if (!facet) return null;
	const word = t(`stac.granularity.${facet.granularity}`);
	return t('stac.granularityLabel', { granularity: word });
});
</script>

<div
	class="pointer-events-auto flex flex-col gap-1.5 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-card-foreground shadow backdrop-blur-sm"
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<span class="font-medium">{t('stac.filterDatetime')}</span>
		<div class="flex flex-wrap items-center gap-1.5">
			<input
				type="date"
				value={minInputValue}
				onchange={onMinInput}
				class="min-h-8 rounded border border-input bg-background px-2 py-1 text-xs tabular-nums sm:min-h-0 sm:px-1.5 sm:py-0.5 sm:text-[11px]"
				aria-label={t('stac.filterDatetime')}
			/>
			<span class="text-muted-foreground">&rarr;</span>
			<input
				type="date"
				value={maxInputValue}
				onchange={onMaxInput}
				class="min-h-8 rounded border border-input bg-background px-2 py-1 text-xs tabular-nums sm:min-h-0 sm:px-1.5 sm:py-0.5 sm:text-[11px]"
				aria-label={t('stac.filterDatetime')}
			/>
			{#if isActive}
				<button
					type="button"
					class="inline-flex min-h-8 items-center rounded border border-input px-2 py-1 text-xs hover:bg-accent sm:min-h-0 sm:px-1.5 sm:py-0.5 sm:text-[10px]"
					style="touch-action: manipulation;"
					onclick={clearRange}
				>
					{t('stac.resetFilters')}
				</button>
			{/if}
		</div>
	</div>

	{#if facet && bounds && sliderValue}
		<RangeSlider
			min={bounds[0]}
			max={bounds[1]}
			value={sliderValue}
			step={86_400_000}
			histogram={facet.bins}
			formatLabel={fmtDate}
			onValueCommit={setSlider}
		/>
		{#if granularityLabel}
			<div class="text-[10px] text-muted-foreground">{granularityLabel}</div>
		{/if}
	{:else}
		<div class="text-[10px] text-muted-foreground">{t('stac.facetNoneAvailable')}</div>
	{/if}
</div>
