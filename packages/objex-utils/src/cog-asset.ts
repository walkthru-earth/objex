/**
 * Generic per-channel asset descriptor for the unified RGB picker.
 *
 * Pure TypeScript. No Svelte dependency. Publishable via objex-utils.
 *
 * `CogAsset` is the canonical shape every viewer (CogViewer, MultiCogViewer,
 * StacMosaicViewer) hands to the shared ChannelPicker UI. Each entry records
 * the STAC asset key (`red`, `B04`, `image`, `visual`, ... or `self` when the
 * viewer is a single bare COG file with no STAC context), the href, the band
 * count (from `raster:bands.length` when STAC populates it, lazily probed from
 * the COG header otherwise), and the optional `eo:bands` common name.
 */

import type { StacItem } from './stac.js';

export interface CogAsset {
	/** STAC asset key, or `self` for a single bare COG without STAC context. */
	key: string;
	/** Absolute or relative href as it appears in the STAC item / URL. */
	href: string;
	/** Number of bands in the asset. 1 by default until probed. */
	bandCount: number;
	/** True when bandCount came from STAC metadata or a probe; false → trust default. */
	bandCountKnown: boolean;
	/** `raster:bands[0].data_type` if known. */
	dtype?: string;
	/** `eo:bands[].common_name` lowercased, aligned to bandIndex order. */
	eoCommon: string[];
	/** STAC asset roles (`data`, `visual`, `reflectance`, ...). */
	roles: string[];
	/** Optional human title. */
	title?: string;
	/** Asset media_type as advertised by STAC. */
	mediaType?: string;
}

/** Per-channel pixel coordinate inside a STAC item. */
export interface ChannelRef {
	assetKey: string;
	bandIndex: number;
}

/** RGB(A) composite expressed as `(asset, bandIndex)` per channel. */
export interface ChannelComposite {
	r: ChannelRef;
	g: ChannelRef;
	b: ChannelRef;
	a?: ChannelRef;
}

const TIFF_MEDIA = /^image\/(tiff|geotiff)\b/i;
const NON_DATA_ROLES = new Set(['thumbnail', 'overview', 'metadata']);

/**
 * Enumerate every TIFF/COG asset on a STAC Item, keeping multi-band assets
 * (NAIP `image`, S2 `visual` TCI) alongside single-band per-band assets.
 *
 * Reads band metadata from (in priority order):
 *   1. `asset.bands` (STAC 1.1 unified bands array)
 *   2. `asset['raster:bands']` (STAC 1.0 raster extension)
 *   3. `asset['eo:bands']` (STAC 1.0 eo extension)
 *   4. `item.properties.bands` (STAC 1.1 item-level bands, applies to all
 *      assets that do not override) — covers catalogs like the Hamilton
 *      NAIP-style 3-inch where each item has 4 bands but the single `data`
 *      asset carries no band metadata of its own.
 *
 * `bandCount` is set when any of the above provides one; otherwise defaults
 * to 1 with `bandCountKnown: false` so callers can lazily probe on first pick.
 */
export function extractCogAssets(item: StacItem): CogAsset[] {
	const out: CogAsset[] = [];
	const assets = item.assets ?? {};
	const props = (item.properties ?? {}) as Record<string, unknown>;
	const itemBands = Array.isArray(props.bands)
		? (props.bands as Array<Record<string, unknown>>)
		: undefined;
	for (const [key, asset] of Object.entries(assets)) {
		if (!asset?.href) continue;
		const mediaType = typeof asset.type === 'string' ? asset.type : undefined;
		if (mediaType && !TIFF_MEDIA.test(mediaType)) continue;
		const roles = Array.isArray(asset.roles) ? (asset.roles as string[]) : [];
		if (roles.some((r) => NON_DATA_ROLES.has(r))) continue;
		const eoBands = Array.isArray(asset['eo:bands']) ? asset['eo:bands'] : undefined;
		const assetExt = asset as unknown as Record<string, unknown>;
		const rasterBands = Array.isArray(assetExt['raster:bands'])
			? (assetExt['raster:bands'] as Array<Record<string, unknown>>)
			: undefined;
		const assetBands11 = Array.isArray(assetExt.bands)
			? (assetExt.bands as Array<Record<string, unknown>>)
			: undefined;
		// `bandCount` source priority: STAC 1.1 unified `bands` → `raster:bands`
		// → `eo:bands` → item-level `properties.bands`. Item-level `bands` is the
		// fallback that lets catalogs (Hamilton NAIP-style 4-band COGs) which
		// keep band metadata at the item-properties level expose band picks.
		const bandCount =
			assetBands11?.length ?? rasterBands?.length ?? eoBands?.length ?? itemBands?.length;
		const bandCountKnown = typeof bandCount === 'number' && bandCount > 0;
		// `eoCommon` is independent of bandCount source: prefer `eo:bands` (the
		// only field guaranteed to carry common_name pre-STAC 1.1), then the
		// STAC 1.1 unified `bands` (which may include common_name), then the
		// item-level fallback. raster:bands typically has no common_name so we
		// skip it for this lookup.
		const commonSource = eoBands ?? assetBands11 ?? itemBands;
		const eoCommon = commonSource
			? commonSource.map((b) => {
					const c = (b as Record<string, unknown>)?.common_name;
					return typeof c === 'string' ? c.toLowerCase() : '';
				})
			: [];
		const dtypeSource = rasterBands ?? assetBands11 ?? itemBands;
		const dtype = (dtypeSource?.[0] as Record<string, unknown> | undefined)?.data_type;
		out.push({
			key,
			href: asset.href,
			bandCount: bandCountKnown ? (bandCount as number) : 1,
			bandCountKnown,
			dtype: typeof dtype === 'string' ? dtype : undefined,
			eoCommon,
			roles,
			title: typeof asset.title === 'string' ? asset.title : undefined,
			mediaType
		});
	}
	return out;
}

/**
 * For `CogViewer` (single bare COG file, no STAC context). Returns one synthetic
 * asset with key `self` so the same ChannelPicker UI works without special-casing.
 * `bandCount` defaults to 1, set to the probed `geotiff.count` once known.
 */
export function syntheticSelfAsset(href: string, probedBandCount?: number): CogAsset {
	const known = typeof probedBandCount === 'number' && probedBandCount > 0;
	return {
		key: 'self',
		href,
		bandCount: known ? probedBandCount : 1,
		bandCountKnown: known,
		eoCommon: [],
		roles: []
	};
}

/**
 * Pick the most natural and most performant default composite for an item.
 *
 * Priority (first match wins):
 *   1. A 3-band uint8 pre-baked visual asset (`visual` / `image` / `tci` etc):
 *      all three channels bind to it, bands 0/1/2. Single COGLayer path,
 *      one decoder, fastest.
 *   2. Common-name red/green/blue resolvable across separate single-band assets.
 *      MultiCOGLayer path.
 *   3. Fallback: first three raster assets, band 0 each.
 *
 * Returns null when no raster assets exist.
 */
export function pickNaturalColorComposite(
	assets: CogAsset[]
): { composite: ChannelComposite; source: 'visual-asset' | 'rgb-bands' | 'fallback' } | null {
	if (assets.length === 0) return null;

	// 1. Pre-baked visual: bandCount === 3 AND eoCommon ⊇ {red,green,blue} OR roles ∋ visual
	for (const a of assets) {
		if (a.bandCount === 3 && (a.roles.includes('visual') || hasRgbInEoCommon(a.eoCommon))) {
			return {
				composite: {
					r: { assetKey: a.key, bandIndex: indexOfCommon(a.eoCommon, 'red', 0) },
					g: { assetKey: a.key, bandIndex: indexOfCommon(a.eoCommon, 'green', 1) },
					b: { assetKey: a.key, bandIndex: indexOfCommon(a.eoCommon, 'blue', 2) }
				},
				source: 'visual-asset'
			};
		}
	}

	// 2. Separate red/green/blue assets by common-name
	const red = assets.find((a) => a.eoCommon[0] === 'red');
	const green = assets.find((a) => a.eoCommon[0] === 'green');
	const blue = assets.find((a) => a.eoCommon[0] === 'blue');
	if (red && green && blue) {
		return {
			composite: {
				r: { assetKey: red.key, bandIndex: 0 },
				g: { assetKey: green.key, bandIndex: 0 },
				b: { assetKey: blue.key, bandIndex: 0 }
			},
			source: 'rgb-bands'
		};
	}

	// 3. Fallback: first three raster assets
	if (assets.length >= 3) {
		return {
			composite: {
				r: { assetKey: assets[0].key, bandIndex: 0 },
				g: { assetKey: assets[1].key, bandIndex: 0 },
				b: { assetKey: assets[2].key, bandIndex: 0 }
			},
			source: 'fallback'
		};
	}

	// Single asset (e.g. CogViewer with a 1-band file): R/G/B all on band 0
	const only = assets[0];
	const last = Math.max(0, only.bandCount - 1);
	return {
		composite: {
			r: { assetKey: only.key, bandIndex: 0 },
			g: { assetKey: only.key, bandIndex: Math.min(1, last) },
			b: { assetKey: only.key, bandIndex: Math.min(2, last) }
		},
		source: 'fallback'
	};
}

function hasRgbInEoCommon(eo: string[]): boolean {
	return eo.includes('red') && eo.includes('green') && eo.includes('blue');
}

function indexOfCommon(eo: string[], name: string, fallback: number): number {
	const i = eo.indexOf(name);
	return i >= 0 ? i : fallback;
}

/** True when all three RGB channels target the same asset key. */
export function isSingleAssetComposite(c: ChannelComposite): boolean {
	return c.r.assetKey === c.g.assetKey && c.g.assetKey === c.b.assetKey;
}

/** True when all three channels are at band index 0 (the MultiCOGLayer-compatible case). */
export function allChannelsBand0(c: ChannelComposite): boolean {
	return c.r.bandIndex === 0 && c.g.bandIndex === 0 && c.b.bandIndex === 0;
}
