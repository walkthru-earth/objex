<script lang="ts" module>
export type PixelInspectorRow = {
	label: string;
	sublabel?: string;
	value: number | null;
};
</script>

<script lang="ts">
import { t } from '../../../i18n/index.svelte.js';

let {
	lng,
	lat,
	rows,
	footnote,
	extraLine,
	onClose,
	inspecting = false
}: {
	lng: number | null;
	lat: number | null;
	rows: PixelInspectorRow[] | null;
	footnote?: string;
	extraLine?: string;
	onClose: () => void;
	inspecting?: boolean;
} = $props();

// The panel renders whenever we have a coordinate + rows. The "reading" pill
// renders independently while inspecting is true. Both blocks can render at
// once during a follow-up click, this matches the existing per-viewer UX.
const showPanel = $derived(rows !== null && lng !== null && lat !== null);
const showReading = $derived(inspecting);

function formatValue(v: number | null): string {
	if (v === null) return '-';
	return Number.isInteger(v) ? String(v) : v.toFixed(4);
}
</script>

{#if showPanel && rows && lng !== null && lat !== null}
	<div
		class="absolute bottom-2 left-2 z-10 rounded bg-card/90 p-2.5 text-xs text-card-foreground backdrop-blur-sm"
	>
		<div class="mb-1 flex items-center justify-between gap-3">
			<span class="font-medium">{t('cog.pixelValue')}</span>
			<button class="text-muted-foreground hover:text-card-foreground" onclick={onClose}>
				&times;
			</button>
		</div>
		<div class="space-y-0.5 text-muted-foreground">
			<div>{lat.toFixed(6)}&deg;, {lng.toFixed(6)}&deg;</div>
			{#if footnote}
				<div class="text-[10px]">{footnote}</div>
			{/if}
			{#if extraLine}
				<div class="truncate text-[10px]" title={extraLine}>{extraLine}</div>
			{/if}
		</div>
		<div class="mt-1.5 space-y-0.5">
			{#each rows as row}
				<div class="flex justify-between gap-2">
					<span class="text-muted-foreground">
						{row.label}{#if row.sublabel}
							<span class="ml-1 text-[10px] opacity-70">({row.sublabel})</span>
						{/if}
					</span>
					<span class="font-mono tabular-nums">{formatValue(row.value)}</span>
				</div>
			{/each}
		</div>
	</div>
{/if}

{#if showReading}
	<div
		class="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
	>
		{t('cog.reading')}
	</div>
{/if}
