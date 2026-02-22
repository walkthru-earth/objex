/**
 * Zarr metadata parsing utilities.
 *
 * Handles consolidated metadata for both Zarr v2 (.zmetadata) and v3 (zarr.json),
 * plus a zarrita fallback for non-consolidated stores.
 */

export interface VarMeta {
	name: string;
	shape: number[];
	dtype: string;
	dims: string[];
	chunks: number[];
	attributes: Record<string, any>;
}

export interface ZarrMetadata {
	storeAttrs: Record<string, any>;
	variables: VarMeta[];
	coords: VarMeta[];
	spatialRefAttrs: Record<string, any> | null;
	zarrVersion: number | null;
}

/** Dimension-like variable names treated as coordinates. */
const DIM_LIKE_NAMES = new Set([
	'x',
	'y',
	'lat',
	'lon',
	'latitude',
	'longitude',
	'time',
	'init_time',
	'lead_time',
	'valid_time',
	'spatial_ref'
]);

/** Guess dimension names from shape length when metadata is absent. */
export function inferDims(name: string, shape: number[]): string[] {
	if (shape.length === 4) return ['init_time', 'lead_time', 'y', 'x'];
	if (shape.length === 3) return ['time', 'y', 'x'];
	if (shape.length === 2) return ['y', 'x'];
	if (shape.length === 1) return [name];
	return shape.map((_, i) => `dim_${i}`);
}

/** Format shape array for display: `[3 × 256 × 512]` or `scalar`. */
export function formatShape(shape: number[]): string {
	if (shape.length === 0) return 'scalar';
	return `[${shape.join(' × ')}]`;
}

/** Collect coordinate variable names from `coordinates` attributes across all entries. */
function collectCoordNames(
	entries: Iterable<[string, { attributes?: Record<string, any> }]>
): Set<string> {
	const names = new Set<string>();
	for (const [, info] of entries) {
		const coordStr = info.attributes?.coordinates;
		if (typeof coordStr === 'string') {
			for (const c of coordStr.split(/\s+/)) names.add(c);
		}
	}
	return names;
}

/** Parse Zarr v3 consolidated metadata (zarr.json). */
export function parseV3Consolidated(data: any): Omit<ZarrMetadata, 'zarrVersion'> {
	const meta = data.consolidated_metadata?.metadata ?? {};
	const attrs = data.attributes ?? {};
	const vars: VarMeta[] = [];
	const coords: VarMeta[] = [];
	let srAttrs: Record<string, any> | null = null;

	const coordNames = collectCoordNames(Object.entries(meta));

	for (const [name, info] of Object.entries<any>(meta)) {
		if (!info.shape) continue;

		const v: VarMeta = {
			name,
			shape: info.shape,
			dtype: info.data_type ?? 'unknown',
			dims: info.attributes?._ARRAY_DIMENSIONS ?? inferDims(name, info.shape),
			chunks: info.chunk_grid?.configuration?.chunk_shape ?? [],
			attributes: info.attributes ?? {}
		};

		if (name === 'spatial_ref') {
			srAttrs = v.attributes;
			coords.push(v);
		} else if (coordNames.has(name) || DIM_LIKE_NAMES.has(name) || v.shape.length <= 1) {
			coords.push(v);
		} else {
			vars.push(v);
		}
	}

	return { storeAttrs: attrs, variables: vars, coords, spatialRefAttrs: srAttrs };
}

/** Parse Zarr v2 consolidated metadata (.zmetadata). */
export function parseV2Consolidated(data: any): Omit<ZarrMetadata, 'zarrVersion'> {
	const meta = data.metadata ?? {};
	const attrs = meta['.zattrs'] ?? {};
	const vars: VarMeta[] = [];
	const coords: VarMeta[] = [];
	let srAttrs: Record<string, any> | null = null;

	const arrayKeys = Object.keys(meta).filter((k) => k.endsWith('/.zarray'));

	// Collect coordinate names from variable attributes
	const coordNames = new Set<string>();
	for (const key of arrayKeys) {
		const name = key.replace('/.zarray', '');
		const varAttrs = meta[`${name}/.zattrs`] ?? {};
		const coordStr = varAttrs.coordinates;
		if (typeof coordStr === 'string') {
			for (const c of coordStr.split(/\s+/)) coordNames.add(c);
		}
	}

	for (const key of arrayKeys) {
		const name = key.replace('/.zarray', '');
		const zarray = meta[key];
		const varAttrs = meta[`${name}/.zattrs`] ?? {};

		const v: VarMeta = {
			name,
			shape: zarray.shape ?? [],
			dtype: zarray.dtype ?? 'unknown',
			dims: varAttrs._ARRAY_DIMENSIONS ?? [],
			chunks: zarray.chunks ?? [],
			attributes: varAttrs
		};

		if (name === 'spatial_ref') {
			srAttrs = v.attributes;
			coords.push(v);
		} else if (coordNames.has(name) || DIM_LIKE_NAMES.has(name) || v.shape.length <= 1) {
			coords.push(v);
		} else {
			vars.push(v);
		}
	}

	return { storeAttrs: attrs, variables: vars, coords, spatialRefAttrs: srAttrs };
}

/**
 * Fetch consolidated metadata from a Zarr store URL.
 * Tries v3 (zarr.json) first, then v2 (.zmetadata).
 */
export async function fetchConsolidated(storeUrl: string): Promise<ZarrMetadata | null> {
	// Try Zarr v3 zarr.json
	try {
		const res = await fetch(`${storeUrl}/zarr.json`);
		if (res.ok) {
			const data = await res.json();
			if (data.zarr_format === 3) {
				if (data.consolidated_metadata) {
					return { ...parseV3Consolidated(data), zarrVersion: 3 };
				}
				// v3 without consolidated metadata — skip v2 probe
				return null;
			}
		}
	} catch {
		/* ignore */
	}

	// Try Zarr v2 .zmetadata
	try {
		const res = await fetch(`${storeUrl}/.zmetadata`);
		if (res.ok) {
			const data = await res.json();
			if (data.metadata) {
				return { ...parseV2Consolidated(data), zarrVersion: 2 };
			}
		}
	} catch {
		/* ignore */
	}

	return null;
}

/**
 * Fallback: probe a Zarr store using zarrita when consolidated metadata is unavailable.
 * @param storeName - Display name for the root array (e.g. file name without .zarr)
 */
export async function probeWithZarrita(
	storeUrl: string,
	storeName: string
): Promise<ZarrMetadata | null> {
	const zarrita = await import('zarrita');
	const store = new zarrita.FetchStore(storeUrl);

	try {
		const arr = await zarrita.open(store, { kind: 'array' });
		const v: VarMeta = {
			name: storeName,
			shape: arr.shape ?? [],
			dtype: String(arr.dtype ?? 'unknown'),
			dims: (arr as any).attrs?._ARRAY_DIMENSIONS ?? [],
			chunks: (arr as any).chunks ?? [],
			attributes: (arr as any).attrs ?? {}
		};
		return {
			storeAttrs: {},
			variables: [v],
			coords: [],
			spatialRefAttrs: null,
			zarrVersion: null
		};
	} catch {
		try {
			await zarrita.open(store, { kind: 'group' });
			return {
				storeAttrs: {},
				variables: [],
				coords: [],
				spatialRefAttrs: null,
				zarrVersion: null
			};
		} catch {
			return null;
		}
	}
}
