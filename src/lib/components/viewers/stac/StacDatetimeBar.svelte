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

const minInputValue = $derived(isoToDateInput(state.datetime?.min));
const maxInputValue = $derived(isoToDateInput(state.datetime?.max));
const isActive = $derived(Boolean(state.datetime?.min || state.datetime?.max));

function fmtDate(ms: number): string {
	if (!Number.isFinite(ms)) return '-';
	return formatDate(ms);
}
</script>

<div
	class="pointer-events-auto flex flex-col gap-1.5 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-card-foreground shadow backdrop-blur-sm"
>
	<div class="flex items-center justify-between gap-2">
		<span class="font-medium">{t('stac.filterDatetime')}</span>
		<div class="flex items-center gap-1.5">
			<input
				type="date"
				value={minInputValue}
				onchange={onMinInput}
				class="rounded border border-input bg-background px-1.5 py-0.5 text-[11px] tabular-nums"
				aria-label={t('stac.filterDatetime')}
			/>
			<span class="text-muted-foreground">&rarr;</span>
			<input
				type="date"
				value={maxInputValue}
				onchange={onMaxInput}
				class="rounded border border-input bg-background px-1.5 py-0.5 text-[11px] tabular-nums"
				aria-label={t('stac.filterDatetime')}
			/>
			{#if isActive}
				<button
					type="button"
					class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
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
	{:else}
		<div class="text-[10px] text-muted-foreground">{t('stac.facetNoneAvailable')}</div>
	{/if}
</div>
