<script lang="ts">
import type { ChannelRef, CogAsset } from '@walkthru-earth/objex-utils';
import { t } from '../../../i18n/index.svelte.js';

type Props = {
	channel: 'r' | 'g' | 'b' | 'a';
	label: string;
	colorClass: string;
	assets: CogAsset[];
	value: ChannelRef;
	onChange: (next: ChannelRef) => void;
	allowNone?: boolean;
};

let { channel, label, colorClass, assets, value, onChange, allowNone = false }: Props = $props();

const assetByKey = $derived(new Map(assets.map((a) => [a.key, a])));
const currentAsset = $derived(assetByKey.get(value.assetKey) ?? null);
const bandCount = $derived(currentAsset?.bandCount ?? 1);
const bandIndices = $derived(Array.from({ length: bandCount }, (_, i) => i));

function assetLabel(a: CogAsset): string {
	const cn = a.eoCommon[0];
	const base = cn ? `${a.key} (${cn})` : a.key;
	return a.bandCount > 1 ? `${base} · ${a.bandCount} bands` : base;
}

function bandLabel(i: number, asset: CogAsset | null): string {
	if (!asset) return `${t('cog.band')} ${i + 1}`;
	const cn = asset.eoCommon[i];
	return cn ? `${t('cog.band')} ${i + 1} (${cn})` : `${t('cog.band')} ${i + 1}`;
}

function setAsset(key: string): void {
	if (channel === 'a' && allowNone && key === '') {
		onChange({ assetKey: '', bandIndex: 0 });
		return;
	}
	const target = assetByKey.get(key);
	const maxIdx = Math.max(0, (target?.bandCount ?? 1) - 1);
	const nextBand = Math.min(value.bandIndex, maxIdx);
	onChange({ assetKey: key, bandIndex: nextBand });
}

function setBand(idx: number): void {
	onChange({ assetKey: value.assetKey, bandIndex: idx });
}
</script>

<div class="flex items-start gap-2">
	<span class="mt-1 w-3 shrink-0 font-bold {colorClass}">{label}</span>
	<div class="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center">
		<select
			class="min-w-0 flex-1 truncate rounded border border-border bg-background px-1.5 py-0.5 text-xs"
			aria-label={`${label} ${t('cog.asset')}`}
			value={value.assetKey}
			onchange={(e) => setAsset((e.target as HTMLSelectElement).value)}
		>
			{#if allowNone}
				<option value="">{t('map.multiCogChannelNone')}</option>
			{/if}
			{#each assets as a (a.key)}
				<option value={a.key}>{assetLabel(a)}</option>
			{/each}
		</select>
		{#if currentAsset && bandCount > 1}
			<select
				class="min-w-0 flex-1 truncate rounded border border-border bg-background px-1.5 py-0.5 text-xs sm:flex-[0_1_auto] sm:min-w-24"
				aria-label={`${label} ${t('cog.band')}`}
				value={value.bandIndex}
				onchange={(e) => setBand(Number((e.target as HTMLSelectElement).value))}
			>
				{#each bandIndices as i (i)}
					<option value={i}>{bandLabel(i, currentAsset)}</option>
				{/each}
			</select>
		{:else if currentAsset}
			<span class="min-w-0 truncate px-1.5 py-0.5 text-[10px] text-muted-foreground sm:min-w-24">
				{t('cog.band')} 1
			</span>
		{/if}
	</div>
</div>
