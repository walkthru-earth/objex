<script lang="ts">
import { onDestroy, untrack } from 'svelte';
import { t } from '../../../i18n/index.svelte.js';
import { formatDate } from '../../../utils/format.js';
import type { StacItemView } from '../../../utils/stac-facets.js';

/**
 * Bottom-anchored, horizontally-scrolling strip of STAC items. Each card
 * shows a thumbnail (when available), the id, datetime, and cloud cover.
 * Hovering a card highlights the matching footprint via `onHover`,
 * clicking selects/pins it via `onSelect`.
 *
 * Thumbnails are presigned via the parent's `presign` callback (the same
 * helper the mosaic uses) so private buckets work without a duplicate
 * cache. Errors are swallowed quietly, a missing thumbnail is just an
 * empty box, never a console flood.
 *
 * Layout choice: the strip is `position: absolute` instead of part of the
 * MapContainer's flow because both the inspector (right slide-over) and
 * the existing pixel inspector (`bottom-2 left-2`) need to coexist with
 * it on the same map surface. `bottom-12` leaves room above the pixel
 * inspector overlay.
 */
let {
	views,
	hoveredId,
	selectedId,
	presign,
	onHover,
	onSelect
}: {
	views: readonly StacItemView[];
	hoveredId: string | null;
	selectedId: string | null;
	presign: (href: string) => Promise<string>;
	onHover: (id: string | null) => void;
	onSelect: (id: string | null) => void;
} = $props();

// Resolved thumbnail URLs, keyed by item id. Held as a Map in $state.raw
// so per-resolve writes are O(1) instead of the O(n) object-spread the
// previous `{...thumbs, [id]: url}` did (which accumulated to O(n²) over a
// viewport of 1000+ items, per the project's $state.raw rule for large
// collections). Reactivity is triggered by bumping `thumbsTick`; readers
// in the template subscribe to that tick + read `thumbs.get(id)`.
const thumbs = new Map<string, string | null>();
let thumbsTick = $state(0);
const inflight = new Set<string>();
// Mirror of the current `views[].id` set. The .then() handler for each
// presign checks against this so a presign that settles AFTER its item
// scrolled out of the viewport does not re-insert a stale entry into
// `thumbs` (which the cleanup $effect just removed). Mutated by the
// cleanup effect, read by load handlers.
let liveIds = new Set<string>();

function loadThumbnail(view: StacItemView): void {
	if (!view.thumbnailHref) return;
	if (thumbs.has(view.id)) return;
	if (inflight.has(view.id)) return;
	inflight.add(view.id);
	presign(view.thumbnailHref)
		.then((url) => {
			if (!liveIds.has(view.id)) return;
			thumbs.set(view.id, url);
			thumbsTick++;
		})
		.catch(() => {
			if (!liveIds.has(view.id)) return;
			thumbs.set(view.id, null);
			thumbsTick++;
		})
		.finally(() => {
			inflight.delete(view.id);
		});
}

// Eagerly kick presigning for every view as soon as it appears. `presign`
// is local crypto (SigV4 query-string sign or HTTPS pass-through), not a
// network call, so resolving all thumbnails up-front is cheap. Each
// resulting `<img>` carries `loading="lazy"`, so the actual GET is still
// deferred to scroll-into-view by the browser. The previous mouseenter /
// focus trigger never fired on touch devices and required the user to
// hover every card individually on desktop.
$effect(() => {
	for (const view of views) loadThumbnail(view);
});

// Drop thumbs for items no longer in the views list. Without this, panning
// across a STAC API would grow `thumbs` forever as the user discovers new
// regions, and the cache would dominate memory before any other leak.
$effect(() => {
	const ids = new Set(views.map((v) => v.id));
	liveIds = ids;
	untrack(() => {
		let mutated = false;
		for (const id of thumbs.keys()) {
			if (!ids.has(id)) {
				thumbs.delete(id);
				mutated = true;
			}
		}
		if (mutated) thumbsTick++;
	});
});

// Scroll the selected card into view when selection comes from outside
// (footprint click). Only fires when the id changes, not on every render.
let scrollContainer: HTMLDivElement | null = $state(null);
let lastScrolled: string | null = null;
$effect(() => {
	if (!selectedId || selectedId === lastScrolled) return;
	if (!scrollContainer) return;
	const el = scrollContainer.querySelector(`[data-item-id="${CSS.escape(selectedId)}"]`);
	if (el && 'scrollIntoView' in el) {
		(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
		lastScrolled = selectedId;
	}
});

onDestroy(() => {
	thumbs.clear();
	inflight.clear();
	liveIds = new Set();
});

function formatItemDate(iso: string | null): string {
	if (!iso) return '';
	const t = Date.parse(iso);
	return Number.isFinite(t) ? formatDate(t) : iso;
}

/**
 * Template reader for the thumbs Map. Reading `thumbsTick` first registers
 * a Svelte reactive dependency on the tick counter, so any tick bump
 * (resolve / failure / cleanup) re-evaluates this call site without us
 * having to wrap the entire Map in a reactive Proxy via `$state(Map)`.
 * Returns the same tri-state the template branches on:
 *   string → resolved URL, render `<img>`
 *   null   → presign failed, render "no thumbnail" placeholder
 *   undefined → still in flight (or has no thumbnailHref), render "loading"
 */
function thumbFor(id: string): string | null | undefined {
	void thumbsTick;
	return thumbs.get(id);
}
</script>

<div
	class="pointer-events-auto rounded-md bg-card/90 shadow-lg backdrop-blur-sm"
>
	<div class="flex items-center justify-between border-b border-border px-2 py-1 text-xs text-muted-foreground sm:text-[10px]">
		<span class="tabular-nums">{t('stac.stripCount', { count: views.length })}</span>
		{#if selectedId}
			<button
				class="inline-flex min-h-8 items-center rounded px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground sm:min-h-0 sm:px-1.5 sm:py-0.5 sm:text-[10px]"
				style="touch-action: manipulation;"
				onclick={() => onSelect(null)}
			>
				{t('stac.clearSelection')}
			</button>
		{/if}
	</div>
	<div
		bind:this={scrollContainer}
		role="list"
		class="flex snap-x snap-mandatory gap-1.5 overflow-x-auto overscroll-x-contain px-2 py-1.5"
		style="-webkit-overflow-scrolling: touch;"
		onmouseleave={() => onHover(null)}
	>
		{#each views as view (view.id)}
			{@const thumb = thumbFor(view.id)}
			<button
				type="button"
				data-item-id={view.id}
				class="group relative flex w-24 shrink-0 snap-start flex-col gap-1 overflow-hidden rounded border bg-background text-left transition-colors sm:w-32"
				class:border-border={view.id !== hoveredId && view.id !== selectedId}
				class:border-white={view.id === hoveredId && view.id !== selectedId}
				class:border-amber-400={view.id === selectedId}
				class:ring-1={view.id === selectedId}
				class:ring-amber-400={view.id === selectedId}
				onmouseenter={() => onHover(view.id)}
				onfocus={() => onHover(view.id)}
				onclick={() => onSelect(view.id)}
			>
				<div class="relative aspect-square w-full bg-muted">
					{#if thumb}
						<img
							src={thumb}
							alt=""
							loading="lazy"
							decoding="async"
							fetchpriority="low"
							class="h-full w-full object-cover"
							onerror={() => {
								thumbs.set(view.id, null);
								thumbsTick++;
							}}
						/>
					{:else if thumb === null}
						<div class="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
							{t('stac.thumbNone')}
						</div>
					{:else if view.thumbnailHref}
						<div class="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
							{t('stac.thumbLoading')}
						</div>
					{:else}
						<div class="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
							{t('stac.thumbNone')}
						</div>
					{/if}
					{#if view.cloudCover != null}
						<span
							class="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] tabular-nums text-white"
							title={t('stac.cloudCover')}
						>
							{Math.round(view.cloudCover)}%
						</span>
					{/if}
				</div>
				<div class="px-1.5 pb-1 text-[10px] leading-tight">
					<div class="truncate font-medium" title={view.id}>{view.id}</div>
					<div class="truncate text-muted-foreground">{formatItemDate(view.datetime)}</div>
				</div>
			</button>
		{/each}
	</div>
</div>
