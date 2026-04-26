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

// Resolved thumbnail URLs, keyed by item id. Loaded lazily on first paint
// of each card via `loadThumbnail`. We do not pre-fetch every thumbnail
// because the strip can hold thousands of items and the `<img>` itself
// already has `loading="lazy"`, so only visible cards trigger network.
let thumbs = $state<Record<string, string | null>>({});
const inflight = new Set<string>();

function loadThumbnail(view: StacItemView): void {
	if (!view.thumbnailHref) return;
	if (thumbs[view.id] !== undefined) return;
	if (inflight.has(view.id)) return;
	inflight.add(view.id);
	presign(view.thumbnailHref)
		.then((url) => {
			thumbs = { ...thumbs, [view.id]: url };
		})
		.catch(() => {
			thumbs = { ...thumbs, [view.id]: null };
		})
		.finally(() => {
			inflight.delete(view.id);
		});
}

// Drop thumbs for items no longer in the views list. Without this, panning
// across a STAC API would grow `thumbs` forever as the user discovers new
// regions, and the cache would dominate memory before any other leak.
$effect(() => {
	const ids = new Set(views.map((v) => v.id));
	untrack(() => {
		const stale = Object.keys(thumbs).filter((id) => !ids.has(id));
		if (stale.length === 0) return;
		const next = { ...thumbs };
		for (const id of stale) delete next[id];
		thumbs = next;
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
	thumbs = {};
});

function formatItemDate(iso: string | null): string {
	if (!iso) return '';
	const t = Date.parse(iso);
	return Number.isFinite(t) ? formatDate(t) : iso;
}
</script>

<div
	class="pointer-events-auto rounded-md bg-card/90 shadow-lg backdrop-blur-sm"
>
	<div class="flex items-center justify-between border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
		<span class="tabular-nums">{t('stac.stripCount', { count: views.length })}</span>
		{#if selectedId}
			<button
				class="rounded px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-accent-foreground"
				onclick={() => onSelect(null)}
			>
				{t('stac.clearSelection')}
			</button>
		{/if}
	</div>
	<div
		bind:this={scrollContainer}
		role="list"
		class="flex gap-1.5 overflow-x-auto px-2 py-1.5"
		onmouseleave={() => onHover(null)}
	>
		{#each views as view (view.id)}
			<button
				type="button"
				data-item-id={view.id}
				class="group relative flex w-32 shrink-0 flex-col gap-1 overflow-hidden rounded border bg-background text-left transition-colors"
				class:border-border={view.id !== hoveredId && view.id !== selectedId}
				class:border-white={view.id === hoveredId && view.id !== selectedId}
				class:border-amber-400={view.id === selectedId}
				class:ring-1={view.id === selectedId}
				class:ring-amber-400={view.id === selectedId}
				onmouseenter={() => {
					onHover(view.id);
					loadThumbnail(view);
				}}
				onfocus={() => {
					onHover(view.id);
					loadThumbnail(view);
				}}
				onclick={() => onSelect(view.id)}
			>
				<div class="relative aspect-square w-full bg-muted">
					{#if thumbs[view.id]}
						<img
							src={thumbs[view.id]}
							alt=""
							loading="lazy"
							class="h-full w-full object-cover"
							onerror={() => {
								thumbs = { ...thumbs, [view.id]: null };
							}}
						/>
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
