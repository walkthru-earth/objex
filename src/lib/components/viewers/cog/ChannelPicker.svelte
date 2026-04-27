<script lang="ts">
import { t } from '../../../i18n/index.svelte.js';
import type { ChannelRef, CogAsset } from '../../../utils/cog-asset.js';

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

<div class="flex items-center gap-2">
	<span class="w-3 font-bold {colorClass}">{label}</span>
	<select
		class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
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
			class="min-w-24 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
			aria-label={`${label} ${t('cog.band')}`}
			value={value.bandIndex}
			onchange={(e) => setBand(Number((e.target as HTMLSelectElement).value))}
		>
			{#each bandIndices as i (i)}
				<option value={i}>{bandLabel(i, currentAsset)}</option>
			{/each}
		</select>
	{:else if currentAsset}
		<span class="min-w-24 px-1.5 py-0.5 text-[10px] text-muted-foreground">
			{t('cog.band')} 1
		</span>
	{/if}
</div>
