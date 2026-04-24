/**
 * STAC (SpatioTemporal Asset Catalog) detection and parsing.
 *
 * Pure TypeScript helpers shared by ViewerRouter, StacMosaicViewer, and
 * MultiCogViewer. No Svelte dependency, publishable via objex-utils.
 */

/** STAC Link (shared by Catalog/Collection/Item). */
export interface StacLink {
	rel: string;
	href: string;
	type?: string;
	title?: string;
}

/** STAC Item (GeoJSON Feature shape with stac_version). */
export interface StacItem {
	type: 'Feature';
	stac_version: string;
	id: string;
	bbox?: [number, number, number, number];
	geometry?: unknown;
	properties?: Record<string, unknown>;
	assets?: Record<string, StacAsset>;
	collection?: string;
	links?: StacLink[];
}

/** STAC FeatureCollection (collection of Items). Also used for STAC API responses. */
export interface StacFeatureCollection {
	type: 'FeatureCollection';
	stac_version?: string;
	features: StacItem[];
	links?: StacLink[];
}

/** STAC Collection (a grouping of Items with its own metadata and links). */
export interface StacCollection {
	type: 'Collection';
	stac_version: string;
	id: string;
	description?: string;
	extent?: { spatial?: { bbox?: number[][] }; temporal?: unknown };
	links: StacLink[];
}

/** STAC Catalog (a directory-like grouping of Catalogs/Collections/Items via links). */
export interface StacCatalog {
	type: 'Catalog';
	stac_version: string;
	id: string;
	description?: string;
	links: StacLink[];
}

/** Single asset entry within a STAC item. */
export interface StacAsset {
	href: string;
	type?: string;
	title?: string;
	roles?: string[];
	/** Set when the asset carries `eo:bands`. */
	'eo:bands'?: { name?: string; common_name?: string }[];
}

/** Sentinel-2 band slot identifier, shared with utils/cog.ts composites. */
export type BandSlot = 'red' | 'green' | 'blue' | 'nir' | 'swir1' | 'swir2' | 'rededge';

/** Parsed band map: slot name → HTTPS asset URL. */
export type BandMap = Partial<Record<BandSlot, string>>;

/** Asset keys providers use for the single "display COG" asset, in priority order. */
export const STAC_COG_ASSET_KEYS = ['visual', 'image', 'data', 'rendered_preview'] as const;

/** Shape-check a parsed JSON object as a STAC Item. */
export function isStacItem(json: unknown): json is StacItem {
	if (!json || typeof json !== 'object') return false;
	const obj = json as Record<string, unknown>;
	return obj.type === 'Feature' && typeof obj.stac_version === 'string';
}

/** Shape-check a parsed JSON object as a STAC FeatureCollection. */
export function isStacFeatureCollection(json: unknown): json is StacFeatureCollection {
	if (!json || typeof json !== 'object') return false;
	const obj = json as Record<string, unknown>;
	if (obj.type !== 'FeatureCollection') return false;
	if (!Array.isArray(obj.features) || obj.features.length === 0) return false;
	if (typeof obj.stac_version === 'string') return true;
	return isStacItem(obj.features[0]);
}

/** STAC Collection detection: `type === 'Collection'` + stac_version + links array. */
export function isStacCollection(json: unknown): json is StacCollection {
	if (!json || typeof json !== 'object') return false;
	const obj = json as Record<string, unknown>;
	return (
		obj.type === 'Collection' && typeof obj.stac_version === 'string' && Array.isArray(obj.links)
	);
}

/** STAC Catalog detection: `type === 'Catalog'` + stac_version + links array. */
export function isStacCatalog(json: unknown): json is StacCatalog {
	if (!json || typeof json !== 'object') return false;
	const obj = json as Record<string, unknown>;
	return obj.type === 'Catalog' && typeof obj.stac_version === 'string' && Array.isArray(obj.links);
}

/** Routing verdict for any STAC-shaped JSON payload. */
export type StacRoutableKind =
	| { kind: 'item'; item: StacItem }
	| { kind: 'item-collection'; fc: StacFeatureCollection }
	| { kind: 'collection'; payload: StacCollection }
	| { kind: 'catalog'; payload: StacCatalog }
	| { kind: 'none' };

/** Classify an arbitrary parsed JSON into one of the STAC routing buckets. */
export function classifyStac(json: unknown): StacRoutableKind {
	if (isStacItem(json)) return { kind: 'item', item: json };
	if (isStacFeatureCollection(json)) return { kind: 'item-collection', fc: json };
	if (isStacCollection(json)) return { kind: 'collection', payload: json };
	if (isStacCatalog(json)) return { kind: 'catalog', payload: json };
	return { kind: 'none' };
}

/**
 * Pick the COG-ish asset href from a STAC Item. Returns the href of the named
 * asset when `preferred` is given and present, else scans STAC_COG_ASSET_KEYS,
 * else falls back to any asset whose `type` contains "tiff". Returns null when
 * nothing matches.
 */
export function pickCogAssetHref(item: StacItem, preferred?: string): string | null {
	const assets = item.assets ?? {};
	if (preferred && assets[preferred]?.href) return assets[preferred].href;
	for (const key of STAC_COG_ASSET_KEYS) {
		if (assets[key]?.href) return assets[key].href;
	}
	for (const asset of Object.values(assets)) {
		const t = typeof asset?.type === 'string' ? asset.type.toLowerCase() : '';
		if (asset?.href && t.includes('tiff')) return asset.href;
	}
	return null;
}

/** True when a single STAC Item exposes a COG-ish asset and a bbox. */
export function detectMosaicCapable(item: StacItem): boolean {
	return stacItemBbox(item) !== null && pickCogAssetHref(item) !== null;
}

/** True when a single STAC Item exposes Sentinel-2-style RGB bands (MultiCog). */
export function detectMultiCogCapable(item: StacItem): boolean {
	return hasRgbBands(extractSentinelBandAssets(item));
}

/** WGS84 bbox helper. Returns `null` if no bbox can be derived. */
export function stacItemBbox(item: StacItem): [number, number, number, number] | null {
	if (Array.isArray(item.bbox) && item.bbox.length >= 4) {
		return [Number(item.bbox[0]), Number(item.bbox[1]), Number(item.bbox[2]), Number(item.bbox[3])];
	}
	return null;
}

/** Normalized mosaic source entry consumed by MosaicLayer. */
export interface MosaicSourceMeta {
	id: string;
	bbox: [number, number, number, number];
	href: string;
}

/**
 * Normalize a STAC Item or a plain `{id?, bbox, href}` record into a
 * MosaicSourceMeta. Returns null when essentials (bbox / href) are missing.
 */
export function buildMosaicSourceMeta(
	input:
		| StacItem
		| { id?: string; bbox: [number, number, number, number] | number[]; href: string },
	assetKey?: string
): MosaicSourceMeta | null {
	if (!input || typeof input !== 'object') return null;
	if (isStacItem(input)) {
		const bbox = stacItemBbox(input);
		if (!bbox) return null;
		const href = pickCogAssetHref(input, assetKey);
		if (!href) return null;
		return {
			id: String(input.id ?? href),
			bbox,
			href
		};
	}
	const raw = input as { id?: string; bbox?: number[]; href?: string };
	if (Array.isArray(raw.bbox) && raw.bbox.length >= 4 && typeof raw.href === 'string') {
		return {
			id: String(raw.id ?? raw.href),
			bbox: [Number(raw.bbox[0]), Number(raw.bbox[1]), Number(raw.bbox[2]), Number(raw.bbox[3])],
			href: raw.href
		};
	}
	return null;
}

// Provider-specific asset key conventions. Each entry maps a BandSlot to the
// asset keys providers are known to use. First match wins, so list more
// specific keys before generic ones.
const BAND_KEY_FALLBACKS: Record<BandSlot, string[]> = {
	red: ['red', 'B04', 'B4', 'visual-red'],
	green: ['green', 'B03', 'B3', 'visual-green'],
	blue: ['blue', 'B02', 'B2', 'visual-blue'],
	nir: ['nir', 'nir08', 'B08', 'B8', 'B8A'],
	swir1: ['swir16', 'swir1', 'B11'],
	swir2: ['swir22', 'swir2', 'B12'],
	rededge: ['rededge1', 'rededge', 'B05', 'B5']
};

/**
 * Map Sentinel-2 STAC item assets to a BandMap. Recognizes:
 *  - `eo:bands[0].common_name` (preferred, stable across providers)
 *  - asset key heuristics for Microsoft PC / Element 84 / AWS S2 L2A buckets
 * Returns an empty map when no bands are identifiable so callers can fall
 * back to a different viewer.
 */
export function extractSentinelBandAssets(item: StacItem): BandMap {
	const out: BandMap = {};
	const assets = item.assets ?? {};
	for (const [key, asset] of Object.entries(assets)) {
		if (!asset?.href) continue;
		const bands = asset['eo:bands'];
		if (Array.isArray(bands) && bands.length >= 1) {
			const common = bands[0]?.common_name?.toLowerCase();
			if (common && isBandSlot(common)) {
				if (!out[common]) out[common] = asset.href;
				continue;
			}
		}
		for (const slot of Object.keys(BAND_KEY_FALLBACKS) as BandSlot[]) {
			if (BAND_KEY_FALLBACKS[slot].includes(key) && !out[slot]) {
				out[slot] = asset.href;
				break;
			}
		}
	}
	return out;
}

function isBandSlot(value: string): value is BandSlot {
	return (
		value === 'red' ||
		value === 'green' ||
		value === 'blue' ||
		value === 'nir' ||
		value === 'swir1' ||
		value === 'swir2' ||
		value === 'rededge'
	);
}

/** True when the band map has enough channels for a True Color composite. */
export function hasRgbBands(map: BandMap): boolean {
	return Boolean(map.red && map.green && map.blue);
}
