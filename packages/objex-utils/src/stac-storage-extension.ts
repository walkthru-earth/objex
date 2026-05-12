/**
 * STAC Storage Extension parser.
 *
 * Detects the Storage Extension version on a STAC Item and extracts
 * connection-relevant hints (region, requester-pays, custom-S3 endpoint).
 *
 * Inspired by lazycogs's `_storage_ext.py`. Pure TypeScript, no fetch, no
 * Svelte dependency. Suitable for `@walkthru-earth/objex-utils` re-export.
 *
 * Supported schema URLs:
 *  - https://stac-extensions.github.io/storage/v1.0.0/schema.json
 *  - https://stac-extensions.github.io/storage/v2.0.0/schema.json
 *
 * v1 (item / asset properties)
 *   storage:platform        e.g. "AWS", "GCP", "AZURE"
 *   storage:region
 *   storage:requester_pays  boolean
 *   storage:tier            (ignored — no obstore equivalent)
 *
 * v2 (item-level scheme map + asset-level refs)
 *   properties.storage:schemes = {
 *     <ref>: { type, platform, region?, requester_pays?, endpoint? }
 *   }
 *   asset.storage:refs = ["primary", ...]   (first matching ref wins)
 *
 * Asset-level fields take precedence over item-level fields in v1.
 */

import type { StacItem } from '../../../src/lib/utils/stac.js';

/** Recognized Storage Extension schema versions. */
export type StorageExtensionVersion = '1.0.0' | '2.0.0';

/**
 * Connection-relevant hints extracted from the Storage Extension. All fields
 * are nullable so callers can merge selectively into existing config without
 * clobbering user-set values.
 */
export interface StorageHints {
	/** e.g. "AWS", "GCP", "AZURE", "MINIO". Uppercased. Null when absent. */
	platform: string | null;
	/** Region code, e.g. "us-west-2". Null when absent. */
	region: string | null;
	/** True when requester-pays must be set. False when absent or false. */
	requesterPays: boolean;
	/** Concrete S3-compatible endpoint URL. Null unless v2 `custom-s3` with
	 *  a non-templated `platform` value. */
	endpoint: string | null;
}

/** Empty hints record. Returned when extension absent or unparseable. */
export function emptyStorageHints(): StorageHints {
	return { platform: null, region: null, requesterPays: false, endpoint: null };
}

/**
 * Scan `item.stac_extensions[]` for the Storage Extension schema URL and
 * return its parsed version. Returns null when the extension is absent or
 * the version is not one we recognize.
 */
export function detectStorageExtensionVersion(item: StacItem): StorageExtensionVersion | null {
	const exts = (item as unknown as { stac_extensions?: unknown }).stac_extensions;
	if (!Array.isArray(exts)) return null;
	for (const raw of exts) {
		if (typeof raw !== 'string') continue;
		if (!raw.includes('stac-extensions.github.io/storage')) continue;
		const trimmed = raw.endsWith('/schema.json') ? raw.slice(0, -'/schema.json'.length) : raw;
		const last = trimmed.slice(trimmed.lastIndexOf('/') + 1);
		const version = last.startsWith('v') ? last.slice(1) : last;
		if (version === '1.0.0' || version === '2.0.0') return version;
		// Unknown patch / minor — fall back to major-version detection so a
		// hypothetical v1.0.1 still gets parsed via the v1 path.
		const major = version.split('.')[0];
		if (major === '1') return '1.0.0';
		if (major === '2') return '2.0.0';
	}
	return null;
}

/**
 * Extract connection hints from a STAC Item. Dispatches on the detected
 * Storage Extension version. Returns `emptyStorageHints()` when the
 * extension is absent or fails to parse.
 *
 * `assetKey` is optional. When given:
 *  - v1: that asset's overrides take precedence over item-level fields.
 *  - v2: that asset's `storage:refs[0]` resolves the item scheme.
 *  When omitted in v2, the first scheme found in any asset's refs wins.
 */
export function extractStorageHints(item: StacItem, assetKey?: string): StorageHints {
	const version = detectStorageExtensionVersion(item);
	if (version === '1.0.0') return extractV1Hints(item, assetKey);
	if (version === '2.0.0') return extractV2Hints(item, assetKey);
	return emptyStorageHints();
}

// --- v1 -------------------------------------------------------------------

function extractV1Hints(item: StacItem, assetKey?: string): StorageHints {
	const props = (item.properties ?? {}) as Record<string, unknown>;
	const asset =
		assetKey && item.assets && (item.assets as Record<string, unknown>)[assetKey]
			? ((item.assets as Record<string, unknown>)[assetKey] as Record<string, unknown>)
			: null;

	const platformRaw = pickFirstString([asset?.['storage:platform'], props['storage:platform']]);
	const region = pickFirstString([asset?.['storage:region'], props['storage:region']]);
	const requesterPays = pickFirstBoolean([
		asset?.['storage:requester_pays'],
		props['storage:requester_pays']
	]);

	return {
		platform: platformRaw ? platformRaw.toUpperCase() : null,
		region: region ?? null,
		requesterPays: requesterPays === true,
		endpoint: null
	};
}

// --- v2 -------------------------------------------------------------------

interface V2Scheme {
	type?: string;
	platform?: string;
	region?: string;
	requester_pays?: boolean;
	endpoint?: string;
}

function extractV2Hints(item: StacItem, assetKey?: string): StorageHints {
	const props = (item.properties ?? {}) as Record<string, unknown>;
	const schemes = (props['storage:schemes'] ?? {}) as Record<string, V2Scheme>;
	if (!schemes || typeof schemes !== 'object') return emptyStorageHints();

	const refs = collectAssetRefs(item, assetKey);
	const scheme = pickFirstScheme(schemes, refs);
	if (!scheme) return emptyStorageHints();

	const storeType = typeof scheme.type === 'string' ? scheme.type : '';
	const platform = typeof scheme.platform === 'string' ? scheme.platform : null;
	const region = typeof scheme.region === 'string' ? scheme.region : null;
	const requesterPays = scheme.requester_pays === true;

	let endpoint: string | null = null;
	if (storeType === 'custom-s3') {
		// Only treat `platform` as a concrete endpoint when it has no URI
		// template variables (e.g. `{region}`).
		if (typeof scheme.endpoint === 'string' && scheme.endpoint && !scheme.endpoint.includes('{')) {
			endpoint = scheme.endpoint;
		} else if (platform && !platform.includes('{')) {
			endpoint = platform;
		}
	}

	return {
		platform: platform ? platform.toUpperCase() : null,
		region,
		requesterPays,
		endpoint
	};
}

function collectAssetRefs(item: StacItem, assetKey?: string): string[] {
	const assets = (item.assets ?? {}) as Record<string, unknown>;
	if (assetKey) {
		const a = assets[assetKey] as Record<string, unknown> | undefined;
		const refs = a?.['storage:refs'];
		if (Array.isArray(refs)) return refs.filter((r): r is string => typeof r === 'string');
		return [];
	}
	const out: string[] = [];
	for (const a of Object.values(assets)) {
		if (!a || typeof a !== 'object') continue;
		const refs = (a as Record<string, unknown>)['storage:refs'];
		if (!Array.isArray(refs)) continue;
		for (const r of refs) if (typeof r === 'string') out.push(r);
	}
	return out;
}

function pickFirstScheme(schemes: Record<string, V2Scheme>, refs: string[]): V2Scheme | null {
	for (const r of refs) {
		const s = schemes[r];
		if (s && typeof s === 'object') return s;
	}
	return null;
}

// --- helpers --------------------------------------------------------------

function pickFirstString(candidates: unknown[]): string | null {
	for (const c of candidates) {
		if (typeof c === 'string' && c.length > 0) return c;
	}
	return null;
}

function pickFirstBoolean(candidates: unknown[]): boolean | null {
	for (const c of candidates) {
		if (typeof c === 'boolean') return c;
	}
	return null;
}

// --- connection wiring ----------------------------------------------------

/**
 * TODO(host-detection): a future PR should call this from the connection
 * auto-fill path so a STAC Item carrying Storage Extension metadata can
 * pre-populate `region` and (for `custom-s3`) `endpoint` on a new
 * connection.
 *
 * Today this lives next to the parser so consumers can opt-in without
 * touching `host-detection.ts` or the connection store. The function is
 * intentionally generic — it takes any object with `region` / `endpoint`
 * keys and returns a shallow copy with hint fields filled only when the
 * existing value is empty.
 */
export function applyStorageHintsToConnection<T extends { region?: string; endpoint?: string }>(
	conn: T,
	hints: StorageHints
): T {
	const out: T = { ...conn };
	if (hints.region && !out.region) {
		(out as { region?: string }).region = hints.region;
	}
	if (hints.endpoint && !out.endpoint) {
		(out as { endpoint?: string }).endpoint = hints.endpoint;
	}
	return out;
}
