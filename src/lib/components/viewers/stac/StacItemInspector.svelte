<script lang="ts">
import { onDestroy } from 'svelte';
import { t } from '../../../i18n/index.svelte.js';
import { copyToClipboard } from '../../../utils/clipboard.js';
import { formatDate, jsonReplacerBigInt } from '../../../utils/format.js';
import type { StacItemView } from '../../../utils/stac-facets.js';

/**
 * Right-side slide-over showing a single STAC item's metadata, asset
 * table, and (collapsible) raw JSON. Rendered when the parent has a
 * non-null `selectedView`. The "x" button calls `onClose` so the parent
 * can clear `selectedId` and trigger a footprint-layer refresh.
 *
 * Asset hrefs are presigned via the parent's `presign` callback before
 * being shown to the user (the "Open" link). Without that, a click on
 * an `s3://` href on a private bucket would 403, and an absolute
 * `https://` href that belongs to the user's own bucket would lose its
 * SigV4 query string. Same helper the strip and mosaic use, so the
 * presign cache is shared and warm.
 */
let {
	view,
	presign,
	onClose,
	onFlyTo
}: {
	view: StacItemView;
	presign: (href: string) => Promise<string>;
	onClose: () => void;
	onFlyTo?: () => void;
} = $props();

let showRaw = $state(false);
let copyLabel = $state<string | null>(null);
// Per-href resolved URL for the asset Open links, fetched on click. We
// don't pre-resolve every asset because most users only open one or two
// per item, and presigning is async + sometimes signs a remote endpoint.
let resolved = $state<Record<string, string>>({});
const inflight = new Set<string>();

function formatDt(iso: string | null): string {
	if (!iso) return '-';
	const t = Date.parse(iso);
	return Number.isFinite(t) ? formatDate(t) : iso;
}

async function openAsset(href: string): Promise<void> {
	let url = resolved[href];
	if (!url && !inflight.has(href)) {
		inflight.add(href);
		try {
			url = await presign(href);
			resolved = { ...resolved, [href]: url };
		} catch {
			url = href;
		} finally {
			inflight.delete(href);
		}
	}
	if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyId(): Promise<void> {
	if (await copyToClipboard(view.id)) {
		copyLabel = t('stac.copied');
		setTimeout(() => {
			copyLabel = null;
		}, 1200);
	}
}

async function copyJson(): Promise<void> {
	const json = JSON.stringify(view.raw, jsonReplacerBigInt, 2);
	if (await copyToClipboard(json)) {
		copyLabel = t('stac.copied');
		setTimeout(() => {
			copyLabel = null;
		}, 1200);
	}
}

onDestroy(() => {
	resolved = {};
	copyLabel = null;
});

const assets = $derived(Object.entries(view.raw.assets ?? {}));
</script>

<aside
	class="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex max-h-[65vh] flex-col gap-2 overflow-hidden rounded-t-xl border border-border bg-card/95 p-3 text-xs text-card-foreground shadow-lg backdrop-blur-sm sm:inset-x-auto sm:bottom-auto sm:end-2 sm:top-12 sm:max-h-[calc(100%-3.5rem)] sm:w-[min(360px,calc(100%-1rem))] sm:rounded-md"
>
	<header class="flex items-start justify-between gap-2">
		<div class="min-w-0 flex-1">
			<div class="truncate font-medium" title={view.id}>{view.id}</div>
			{#if view.collection}
				<div class="truncate text-[10px] text-muted-foreground">{view.collection}</div>
			{/if}
		</div>
		<div class="flex items-center gap-1">
			{#if onFlyTo && view.bbox}
				<button
					class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
					onclick={onFlyTo}
					title={t('stac.flyTo')}
				>
					{t('stac.flyTo')}
				</button>
			{/if}
			<button
				class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
				onclick={copyId}
			>
				{copyLabel ?? t('stac.copyId')}
			</button>
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

	<div class="overflow-y-auto">
		<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
			<dt class="text-muted-foreground">{t('stac.datetime')}</dt>
			<dd class="tabular-nums">{formatDt(view.datetime)}</dd>
			{#if view.endDatetime}
				<dt class="text-muted-foreground">{t('stac.endDatetime')}</dt>
				<dd class="tabular-nums">{formatDt(view.endDatetime)}</dd>
			{/if}
			{#if view.cloudCover != null}
				<dt class="text-muted-foreground">{t('stac.cloudCover')}</dt>
				<dd class="tabular-nums">{view.cloudCover.toFixed(1)}%</dd>
			{/if}
			{#if view.gsd != null}
				<dt class="text-muted-foreground">{t('stac.gsd')}</dt>
				<dd class="tabular-nums">{view.gsd} m</dd>
			{/if}
			{#if view.platform}
				<dt class="text-muted-foreground">{t('stac.platform')}</dt>
				<dd>{view.platform}</dd>
			{/if}
			{#if view.constellation}
				<dt class="text-muted-foreground">{t('stac.constellation')}</dt>
				<dd>{view.constellation}</dd>
			{/if}
			{#if view.instruments.length > 0}
				<dt class="text-muted-foreground">{t('stac.instruments')}</dt>
				<dd>{view.instruments.join(', ')}</dd>
			{/if}
			{#if view.epsg != null}
				<dt class="text-muted-foreground">{t('stac.epsg')}</dt>
				<dd class="tabular-nums">EPSG:{view.epsg}</dd>
			{/if}
			{#if view.bbox}
				<dt class="text-muted-foreground">{t('mapInfo.bounds')}</dt>
				<dd class="tabular-nums text-[10px]">
					W {view.bbox[0].toFixed(3)}, S {view.bbox[1].toFixed(3)}<br />
					E {view.bbox[2].toFixed(3)}, N {view.bbox[3].toFixed(3)}
				</dd>
			{/if}
		</dl>

		{#if assets.length > 0}
			<div class="mt-3">
				<div class="mb-1 text-muted-foreground">
					{t('stac.assets', { count: assets.length })}
				</div>
				<ul class="space-y-1">
					{#each assets as [key, asset] (key)}
						<li class="rounded border border-border px-1.5 py-1">
							<div class="flex items-center justify-between gap-2">
								<span class="truncate font-medium">{key}</span>
								<button
									class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
									onclick={() => void openAsset(asset.href)}
								>
									{t('stac.assetOpen')}
								</button>
							</div>
							{#if asset.title}
								<div class="truncate text-[10px] text-muted-foreground">{asset.title}</div>
							{/if}
							{#if asset.type}
								<div class="truncate text-[10px] text-muted-foreground">{asset.type}</div>
							{/if}
							{#if Array.isArray(asset.roles) && asset.roles.length > 0}
								<div class="mt-0.5 flex flex-wrap gap-1">
									{#each asset.roles as role (role)}
										<span class="rounded bg-muted px-1 text-[9px] text-muted-foreground">{role}</span>
									{/each}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="mt-3 border-t border-border pt-2">
			<button
				class="text-[10px] text-muted-foreground hover:text-card-foreground"
				onclick={() => (showRaw = !showRaw)}
			>
				{showRaw ? t('stac.hideRaw') : t('stac.showRaw')}
			</button>
			{#if showRaw}
				<div class="mt-1 flex justify-end">
					<button
						class="rounded border border-input px-1.5 py-0.5 text-[10px] hover:bg-accent"
						onclick={copyJson}
					>
						{copyLabel ?? t('stac.copyJson')}
					</button>
				</div>
				<pre class="mt-1 max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-[10px] leading-tight">{JSON.stringify(view.raw, jsonReplacerBigInt, 2)}</pre>
			{/if}
		</div>
	</div>
</aside>
