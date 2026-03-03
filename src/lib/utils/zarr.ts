/**
 * Zarr metadata parsing utilities.
 *
 * Builds a hierarchical tree of groups and arrays from consolidated metadata
 * (Zarr v2 .zmetadata, v3 zarr.json), with zarrita fallback for non-consolidated stores.
 */

import { formatFileSize } from './format.js';

// ---------------------------------------------------------------------------
// Register numcodecs-wrapped codecs with zarrita's codec registry.
// Zarr v3 stores produced by Python's zarr-python may wrap codecs with the
// "numcodecs." prefix (e.g. "numcodecs.zlib", "numcodecs.shuffle").
// zarrita only registers the bare names, so we add aliases + a byte shuffle.
// ---------------------------------------------------------------------------

/**
 * Byte shuffle codec (HDF5 / numcodecs byte shuffle).
 * Rearranges bytes within elements to improve downstream compression ratios.
 * Operates as a bytes_to_bytes filter in the codec pipeline.
 */
const ShuffleCodec = {
	kind: 'bytes_to_bytes' as const,
	fromConfig(config: { elementsize?: number }) {
		const elementsize = config?.elementsize ?? 4;
		return {
			kind: 'bytes_to_bytes' as const,
			encode(data: Uint8Array): Uint8Array {
				const count = data.length / elementsize;
				const out = new Uint8Array(data.length);
				for (let i = 0; i < count; i++) {
					for (let j = 0; j < elementsize; j++) {
						out[j * count + i] = data[i * elementsize + j];
					}
				}
				return out;
			},
			decode(data: Uint8Array): Uint8Array {
				const count = data.length / elementsize;
				const out = new Uint8Array(data.length);
				for (let i = 0; i < count; i++) {
					for (let j = 0; j < elementsize; j++) {
						out[i * elementsize + j] = data[j * count + i];
					}
				}
				return out;
			}
		};
	}
};

/** Register numcodecs-prefixed aliases with zarrita's codec registry. */
async function registerNumcodecs() {
	try {
		const { registry } = await import('zarrita');
		// Alias existing codecs with numcodecs. prefix
		for (const name of ['zlib', 'gzip', 'blosc', 'lz4', 'zstd']) {
			const existing = registry.get(name);
			if (existing) registry.set(`numcodecs.${name}`, existing);
		}
		// Register shuffle codec
		registry.set('numcodecs.shuffle', () => Promise.resolve(ShuffleCodec as any));
		registry.set('shuffle', () => Promise.resolve(ShuffleCodec as any));
	} catch {
		// zarrita not available — skip registration
	}
}

// Fire-and-forget at module load; registration is idempotent
registerNumcodecs();

/** Zarr store marker files — presence of any indicates a Zarr store. */
export const ZARR_MARKER_FILES = new Set([
	'zarr.json',
	'.zmetadata',
	'.zgroup',
	'.zarray',
	'.zattrs'
]);

/** Zarr marker file suffixes used in URLs (with leading slash). */
const ZARR_MARKER_SUFFIXES = ['/zarr.json', '/.zmetadata', '/.zgroup', '/.zarray', '/.zattrs'];

/**
 * Detect whether a set of file names contains Zarr marker files.
 * Returns the detected version (2 or 3) or null if not detected.
 */
export function detectZarrMarkers(fileNames: Iterable<string>): {
	detected: boolean;
	version: 2 | 3 | null;
} {
	let hasV3 = false;
	let hasV2 = false;
	for (const name of fileNames) {
		if (name === 'zarr.json') hasV3 = true;
		else if (ZARR_MARKER_FILES.has(name)) hasV2 = true;
	}
	if (hasV3) return { detected: true, version: 3 };
	if (hasV2) return { detected: true, version: 2 };
	return { detected: false, version: null };
}

/**
 * If a URL points to a Zarr marker file, strip the marker suffix and return the store URL.
 * Returns null if the URL doesn't end with a known marker suffix.
 */
export function extractZarrStoreUrl(url: string): string | null {
	for (const suffix of ZARR_MARKER_SUFFIXES) {
		if (url.endsWith(suffix)) {
			return url.slice(0, -suffix.length);
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZarrNode {
	path: string;
	name: string;
	kind: 'group' | 'array';
	children: ZarrNode[];
	shape?: number[];
	dtype?: string;
	dims?: string[];
	chunks?: number[];
	fillValue?: any;
	codecs?: any[];
	compressor?: any;
	filters?: any[];
	chunkKeyEncoding?: string;
	attributes: Record<string, any>;
}

export interface ZarrHierarchy {
	root: ZarrNode;
	zarrVersion: 2 | 3 | null;
	totalNodes: number;
	storeAttrs: Record<string, any>;
	spatialRefAttrs: Record<string, any> | null;
}

// ---------------------------------------------------------------------------
// Kept helpers
// ---------------------------------------------------------------------------

/** Dimension-like variable names treated as coordinates. */
export const DIM_LIKE_NAMES = new Set([
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

// ---------------------------------------------------------------------------
// Metadata display helpers
// ---------------------------------------------------------------------------

/** Byte size of a dtype string. Handles v2 (`<f4`, `|u1`) and v3 (`float32`, `uint8`). */
export function dtypeByteSize(dtype: string): number {
	// v2 style: last char(s) are the byte width e.g. "<f4" → 4, "|u1" → 1
	const v2 = /^[<>|]?[a-zA-Z](\d+)$/.exec(dtype);
	if (v2) return Number(v2[1]);

	// v3 style: "float32" → 4, "int16" → 2, "uint8" → 1, "complex128" → 16
	const v3 = /(\d+)$/.exec(dtype);
	if (v3) return Number(v3[1]) / 8;

	// bool
	if (dtype === 'bool') return 1;

	return 1; // fallback
}

/** Format chunk count: `"36 [6 × 6]"` */
export function computeChunkCount(
	shape: number[] | undefined,
	chunks: number[] | undefined
): string | null {
	if (!shape?.length || !chunks?.length || shape.length !== chunks.length) return null;
	const dims = shape.map((s, i) => Math.ceil(s / chunks[i]));
	const total = dims.reduce((a, b) => a * b, 1);
	return `${total.toLocaleString()} [${dims.join(' × ')}]`;
}

/** Format chunk size in bytes: `"817.6 KB"` */
export function computeChunkSize(
	chunks: number[] | undefined,
	dtype: string | undefined
): string | null {
	if (!chunks?.length || !dtype) return null;
	const elements = chunks.reduce((a, b) => a * b, 1);
	return formatFileSize(elements * dtypeByteSize(dtype));
}

/** Format uncompressed size: `"28.7 MB"` */
export function computeUncompressed(
	shape: number[] | undefined,
	dtype: string | undefined
): string | null {
	if (!shape?.length || !dtype) return null;
	const elements = shape.reduce((a, b) => a * b, 1);
	return formatFileSize(elements * dtypeByteSize(dtype));
}

/** Format codec pipeline for display. */
export function formatCodecs(node: ZarrNode): string | null {
	// v3: codecs array
	if (node.codecs?.length) {
		return node.codecs
			.map((c: any) => {
				const name = c.name ?? c.codec_id ?? (typeof c === 'string' ? c : '');
				if (!name) return JSON.stringify(c);
				const cfg = c.configuration ?? c.codec_config ?? {};
				const parts: string[] = [];
				if (cfg.cname) parts.push(cfg.cname);
				if (cfg.clevel != null) parts.push(`level ${cfg.clevel}`);
				if (cfg.shuffle != null) parts.push(cfg.shuffle ? 'shuffle' : 'no shuffle');
				if (cfg.typesize) parts.push(`typesize ${cfg.typesize}`);
				return parts.length ? `${name} (${parts.join(', ')})` : name;
			})
			.join(' → ');
	}

	// v2: compressor + filters
	if (node.compressor) {
		const c = node.compressor;
		const name = c.id ?? c.codec ?? 'unknown';
		const parts: string[] = [];
		if (c.cname) parts.push(c.cname);
		if (c.clevel != null) parts.push(`level ${c.clevel}`);
		if (c.shuffle != null) parts.push(c.shuffle ? 'shuffle' : 'no shuffle');
		const base = parts.length ? `${name} (${parts.join(', ')})` : name;

		if (node.filters?.length) {
			const filterStr = node.filters.map((f: any) => f.id ?? JSON.stringify(f)).join(', ');
			return `${filterStr} → ${base}`;
		}
		return base;
	}

	return null;
}

/** Format chunk_key_encoding for display: `"default (sep: "/")"` */
export function formatChunkKeys(node: ZarrNode): string | null {
	return node.chunkKeyEncoding ?? null;
}

/** Find a node by slash-delimited path. */
export function findNodeByPath(root: ZarrNode, path: string): ZarrNode | null {
	if (path === '/' || path === '') return root;
	const parts = path.replace(/^\//, '').split('/');
	let current = root;
	for (const part of parts) {
		const child = current.children.find((c) => c.name === part);
		if (!child) return null;
		current = child;
	}
	return current;
}

// ---------------------------------------------------------------------------
// Tree builders
// ---------------------------------------------------------------------------

function makeNode(path: string, kind: 'group' | 'array', attrs: Record<string, any>): ZarrNode {
	const name = path === '/' ? '/' : path.split('/').pop()!;
	return { path, name, kind, children: [], attributes: attrs };
}

/** Ensure all intermediate groups exist and return the parent for `path`. */
function ensureParent(root: ZarrNode, path: string): ZarrNode {
	const parts = path.replace(/^\//, '').split('/');
	parts.pop(); // remove leaf
	let current = root;
	let currentPath = '';
	for (const part of parts) {
		currentPath += `/${part}`;
		let child = current.children.find((c) => c.name === part);
		if (!child) {
			child = makeNode(currentPath, 'group', {});
			current.children.push(child);
		}
		current = child;
	}
	return current;
}

/** Build tree from Zarr v3 consolidated metadata (zarr.json). */
export function buildV3Tree(data: any): ZarrHierarchy {
	const meta = data.consolidated_metadata?.metadata ?? {};
	const rootAttrs = data.attributes ?? {};
	const root = makeNode('/', 'group', rootAttrs);
	let totalNodes = 1;
	let spatialRefAttrs: Record<string, any> | null = null;

	for (const [key, info] of Object.entries<any>(meta)) {
		const path = `/${key}`;
		const attrs = info.attributes ?? {};

		if (info.node_type === 'group' || (!info.shape && !info.data_type)) {
			// Group node
			const node = makeNode(path, 'group', attrs);
			const parent = ensureParent(root, path);
			// Avoid duplicating if ensureParent already created this node
			const existing = parent.children.find((c) => c.name === node.name);
			if (existing) {
				existing.attributes = { ...existing.attributes, ...attrs };
			} else {
				parent.children.push(node);
			}
			totalNodes++;
		} else {
			// Array node
			const node = makeNode(path, 'array', attrs);
			node.shape = info.shape;
			node.dtype = info.data_type ?? 'unknown';
			node.dims =
				info.dimension_names ?? attrs._ARRAY_DIMENSIONS ?? inferDims(node.name, node.shape ?? []);
			node.chunks = info.chunk_grid?.configuration?.chunk_shape ?? [];
			node.fillValue = info.fill_value;
			node.codecs = info.codecs ?? [];
			// Parse chunk_key_encoding for v3
			const cke = info.chunk_key_encoding;
			if (cke) {
				const sep = cke.configuration?.separator ?? '/';
				node.chunkKeyEncoding = `${cke.name ?? 'default'} (sep: "${sep}")`;
			}
			const parent = ensureParent(root, path);
			parent.children.push(node);
			totalNodes++;

			if (node.name === 'spatial_ref') {
				spatialRefAttrs = attrs;
			}
		}
	}

	// Sort children alphabetically, groups first
	sortTree(root);

	return {
		root,
		zarrVersion: 3,
		totalNodes,
		storeAttrs: rootAttrs,
		spatialRefAttrs
	};
}

/** Build tree from Zarr v2 consolidated metadata (.zmetadata). */
export function buildV2Tree(data: any): ZarrHierarchy {
	const meta = data.metadata ?? {};
	const rootAttrs = meta['.zattrs'] ?? {};
	const root = makeNode('/', 'group', rootAttrs);
	let totalNodes = 1;
	let spatialRefAttrs: Record<string, any> | null = null;

	// Collect group paths
	const groupKeys = Object.keys(meta).filter((k) => k.endsWith('/.zgroup'));
	for (const key of groupKeys) {
		const name = key.replace('/.zgroup', '');
		if (!name) continue; // root
		const path = `/${name}`;
		const attrs = meta[`${name}/.zattrs`] ?? {};
		const parent = ensureParent(root, path);
		const existing = parent.children.find((c) => c.name === name.split('/').pop());
		if (existing) {
			existing.attributes = { ...existing.attributes, ...attrs };
		} else {
			parent.children.push(makeNode(path, 'group', attrs));
		}
		totalNodes++;
	}

	// Collect array paths
	const arrayKeys = Object.keys(meta).filter((k) => k.endsWith('/.zarray'));
	for (const key of arrayKeys) {
		const name = key.replace('/.zarray', '');
		const path = `/${name}`;
		const zarray = meta[key];
		const attrs = meta[`${name}/.zattrs`] ?? {};

		const shape = zarray.shape ?? [];
		const node = makeNode(path, 'array', attrs);
		node.shape = shape;
		node.dtype = zarray.dtype ?? 'unknown';
		node.dims = attrs._ARRAY_DIMENSIONS ?? inferDims(node.name, shape);
		node.chunks = zarray.chunks ?? [];
		node.fillValue = zarray.fill_value;
		node.compressor = zarray.compressor ?? null;
		node.filters = zarray.filters ?? [];

		const parent = ensureParent(root, path);
		parent.children.push(node);
		totalNodes++;

		if (node.name === 'spatial_ref') {
			spatialRefAttrs = attrs;
		}
	}

	sortTree(root);

	return {
		root,
		zarrVersion: 2,
		totalNodes,
		storeAttrs: rootAttrs,
		spatialRefAttrs
	};
}

/** Recursively sort children: groups first, then alphabetically. */
function sortTree(node: ZarrNode) {
	node.children.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	for (const child of node.children) {
		sortTree(child);
	}
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch hierarchy from a Zarr store URL.
 * Tries v3 (zarr.json) first, then v2 (.zmetadata), then zarrita fallback.
 */
export async function fetchHierarchy(
	storeUrl: string,
	storeName: string,
	signal?: AbortSignal
): Promise<ZarrHierarchy | null> {
	// Try Zarr v3 zarr.json
	try {
		const res = await fetch(`${storeUrl}/zarr.json`, { signal });
		if (res.ok) {
			const data = await res.json();
			if (data.zarr_format === 3) {
				if (data.consolidated_metadata) {
					return buildV3Tree(data);
				}
				// V3 without consolidated metadata — discover children
				return discoverV3Children(storeUrl, data, signal);
			}
		}
	} catch {
		/* ignore */
	}

	// Try Zarr v2 .zmetadata
	try {
		const res = await fetch(`${storeUrl}/.zmetadata`, { signal });
		if (res.ok) {
			const data = await res.json();
			if (data.metadata) {
				return buildV2Tree(data);
			}
		}
	} catch {
		/* ignore */
	}

	// Fallback: zarrita probe
	return probeHierarchy(storeUrl, storeName);
}

/**
 * Discover children of a v3 store without consolidated metadata.
 * Probes child paths from zarr.json attributes (e.g. multiscales convention)
 * and by fetching individual zarr.json files for discovered paths.
 */
async function discoverV3Children(
	storeUrl: string,
	rootData: any,
	signal?: AbortSignal
): Promise<ZarrHierarchy> {
	const rootAttrs = rootData.attributes ?? {};
	const root = makeNode('/', 'group', rootAttrs);
	let totalNodes = 1;

	// Collect candidate child names from conventions and common patterns
	const candidates = new Set<string>();

	// Multiscales convention: layout[].asset lists child array names
	const multiscales = rootAttrs.multiscales;
	if (multiscales?.layout && Array.isArray(multiscales.layout)) {
		for (const entry of multiscales.layout) {
			if (entry.asset) candidates.add(String(entry.asset));
		}
	}

	// Probe each candidate path for zarr.json
	const probes = [...candidates].map(async (name) => {
		try {
			const res = await fetch(`${storeUrl}/${name}/zarr.json`, { signal });
			if (!res.ok) return null;
			const data = await res.json();
			if (data.node_type === 'array' && data.shape) {
				const node = makeNode(`/${name}`, 'array', data.attributes ?? {});
				node.shape = data.shape;
				node.dtype = data.data_type ?? 'unknown';
				node.dims = data.dimension_names ?? inferDims(name, data.shape);
				node.chunks = data.chunk_grid?.configuration?.chunk_shape ?? [];
				node.fillValue = data.fill_value;
				node.codecs = data.codecs ?? [];
				const cke = data.chunk_key_encoding;
				if (cke) {
					const sep = cke.configuration?.separator ?? '/';
					node.chunkKeyEncoding = `${cke.name ?? 'default'} (sep: "${sep}")`;
				}
				return node;
			}
			if (data.node_type === 'group') {
				return makeNode(`/${name}`, 'group', data.attributes ?? {});
			}
			return null;
		} catch {
			return null;
		}
	});

	const results = await Promise.all(probes);
	for (const node of results) {
		if (node) {
			root.children.push(node);
			totalNodes++;
		}
	}

	sortTree(root);

	return {
		root,
		zarrVersion: 3,
		totalNodes,
		storeAttrs: rootAttrs,
		spatialRefAttrs: null
	};
}

/**
 * Fallback: probe a Zarr store using zarrita when consolidated metadata is unavailable.
 */
export async function probeHierarchy(
	storeUrl: string,
	storeName: string
): Promise<ZarrHierarchy | null> {
	const zarrita = await import('zarrita');
	const store = new zarrita.FetchStore(storeUrl);

	try {
		const arr = await zarrita.open(store, { kind: 'array' });
		const root = makeNode('/', 'group', {});
		const node = makeNode(`/${storeName}`, 'array', (arr as any).attrs ?? {});
		node.shape = arr.shape ?? [];
		node.dtype = String(arr.dtype ?? 'unknown');
		node.dims = (arr as any).attrs?._ARRAY_DIMENSIONS ?? [];
		node.chunks = (arr as any).chunks ?? [];
		root.children.push(node);
		return {
			root,
			zarrVersion: null,
			totalNodes: 2,
			storeAttrs: {},
			spatialRefAttrs: null
		};
	} catch {
		try {
			const grp = await zarrita.open(store, { kind: 'group' });
			const attrs = (grp as any).attrs ?? {};
			return {
				root: makeNode('/', 'group', attrs),
				zarrVersion: null,
				totalNodes: 1,
				storeAttrs: attrs,
				spatialRefAttrs: null
			};
		} catch {
			return null;
		}
	}
}
