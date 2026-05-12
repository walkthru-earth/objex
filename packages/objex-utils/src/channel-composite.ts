/**
 * Preset definitions, URL round-trip, and preset application for the unified
 * RGB picker. Pure TypeScript, publishable via objex-utils.
 *
 * Presets describe a SEMANTIC band slot triple (`red`/`green`/`blue` for
 * Natural Color, `nir`/`red`/`green` for False-Color IR, ...). Resolving a
 * preset against a specific item walks `BAND_KEY_FALLBACKS` in `utils/stac.ts`
 * to map slots to actual asset keys on that item. NDVI and other single-band
 * derived presets are intentionally NOT in this list for this slice.
 */

import type { ChannelComposite, CogAsset } from '../../../src/lib/utils/cog-asset.js';
import {
	type BandSlot,
	type RasterBandAsset,
	resolvePresetComposite
} from '../../../src/lib/utils/stac.js';

export interface PresetDef {
	id: string;
	labelKey: string;
	slots: { r: BandSlot; g: BandSlot; b: BandSlot };
}

export const PRESETS: PresetDef[] = [
	{
		id: 'natural-color',
		labelKey: 'map.multiCogPreset.trueColor',
		slots: { r: 'red', g: 'green', b: 'blue' }
	},
	{
		id: 'false-color-ir',
		labelKey: 'map.multiCogPreset.falseColorIR',
		slots: { r: 'nir', g: 'red', b: 'green' }
	},
	{
		id: 'swir',
		labelKey: 'map.multiCogPreset.swir',
		slots: { r: 'swir2', g: 'swir1', b: 'red' }
	},
	{
		id: 'vegetation',
		labelKey: 'map.multiCogPreset.vegetation',
		slots: { r: 'nir', g: 'swir1', b: 'red' }
	},
	{
		id: 'agriculture',
		labelKey: 'map.multiCogPreset.agriculture',
		slots: { r: 'swir1', g: 'nir', b: 'blue' }
	}
];

function toRasterBandAssets(assets: CogAsset[]): RasterBandAsset[] {
	return assets.map((a) => ({
		key: a.key,
		href: a.href,
		commonName: a.eoCommon[0],
		bandCount: a.bandCount,
		roles: a.roles,
		mediaType: a.mediaType,
		title: a.title
	}));
}

/** Subset of PRESETS whose slot triple resolves on this item. */
export function availablePresets(assets: CogAsset[]): PresetDef[] {
	const rba = toRasterBandAssets(assets);
	return PRESETS.filter((p) => resolvePresetComposite(rba, p.slots) !== null);
}

/** Resolve a preset to a ChannelComposite for this item. Returns null when not applicable. */
export function applyPreset(assets: CogAsset[], preset: PresetDef): ChannelComposite | null {
	const rba = toRasterBandAssets(assets);
	const r = resolvePresetComposite(rba, preset.slots);
	if (!r) return null;
	return {
		r: { assetKey: r.r, bandIndex: 0 },
		g: { assetKey: r.g, bandIndex: 0 },
		b: { assetKey: r.b, bandIndex: 0 }
	};
}

/** True when the preset's resolved composite still matches the user's current picks. */
export function presetMatchesComposite(
	preset: PresetDef,
	c: ChannelComposite,
	assets: CogAsset[]
): boolean {
	const resolved = applyPreset(assets, preset);
	if (!resolved) return false;
	return (
		resolved.r.assetKey === c.r.assetKey &&
		resolved.g.assetKey === c.g.assetKey &&
		resolved.b.assetKey === c.b.assetKey &&
		c.r.bandIndex === 0 &&
		c.g.bandIndex === 0 &&
		c.b.bandIndex === 0
	);
}

/**
 * Decode a `URLSearchParams` chunk into a ChannelComposite.
 *
 * Format: `r=<asset>&g=<asset>&b=<asset>&band_r=<n>&band_g=<n>&band_b=<n>` plus
 * optional `a=<asset>&band_a=<n>`. `band_*` defaults to 0 when absent so
 * legacy MultiCog URLs (`?r=red&g=green&b=blue&preset=true-color`) keep
 * round-tripping. Returns null when any required asset key is missing from
 * the current item's asset list.
 */
export function compositeFromUrl(
	params: URLSearchParams,
	assets: CogAsset[]
): ChannelComposite | null {
	const r = params.get('r');
	const g = params.get('g');
	const b = params.get('b');
	if (!r || !g || !b) return null;
	const known = new Map(assets.map((a) => [a.key, a]));
	const ra = known.get(r);
	const ga = known.get(g);
	const ba = known.get(b);
	if (!ra || !ga || !ba) return null;
	const out: ChannelComposite = {
		r: { assetKey: r, bandIndex: clampBand(params.get('band_r'), ra.bandCount) },
		g: { assetKey: g, bandIndex: clampBand(params.get('band_g'), ga.bandCount) },
		b: { assetKey: b, bandIndex: clampBand(params.get('band_b'), ba.bandCount) }
	};
	const a = params.get('a');
	if (a) {
		const aa = known.get(a);
		if (aa) out.a = { assetKey: a, bandIndex: clampBand(params.get('band_a'), aa.bandCount) };
	}
	return out;
}

/** Encode a composite + active preset id into URLSearchParams for the hash. */
export function compositeToUrl(c: ChannelComposite, presetId: string | null): URLSearchParams {
	const p = new URLSearchParams();
	p.set('r', c.r.assetKey);
	p.set('g', c.g.assetKey);
	p.set('b', c.b.assetKey);
	if (c.r.bandIndex !== 0) p.set('band_r', String(c.r.bandIndex));
	if (c.g.bandIndex !== 0) p.set('band_g', String(c.g.bandIndex));
	if (c.b.bandIndex !== 0) p.set('band_b', String(c.b.bandIndex));
	if (c.a) {
		p.set('a', c.a.assetKey);
		if (c.a.bandIndex !== 0) p.set('band_a', String(c.a.bandIndex));
	}
	if (presetId) p.set('preset', presetId);
	return p;
}

function clampBand(raw: string | null, bandCount: number): number {
	if (!raw) return 0;
	const n = Number(raw);
	if (!Number.isFinite(n)) return 0;
	const i = Math.floor(n);
	if (i < 0) return 0;
	if (i >= bandCount) return Math.max(0, bandCount - 1);
	return i;
}
