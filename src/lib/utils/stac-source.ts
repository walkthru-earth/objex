/**
 * StacSource contract. Unified interface for the three STAC ingestion paths
 * (STAC API, stac-geoparquet, self-contained static catalog) so the viewer
 * has a single orchestration loop and the UI can branch on capability flags
 * instead of hard-coded discovery modes.
 *
 * Pure TypeScript. No Svelte / maplibre / deck.gl / DuckDB on this import
 * graph. The DuckDB-bound parquet implementation lives under `query/` so the
 * `utils/` side stays publishable via `@walkthru-earth/objex-utils` (slice 6).
 *
 * Per-batch `pushedDown` / `residual` reporting lets the caller skip
 * client-side filtering for dimensions the engine already narrowed, and lets
 * the UI render capability badges. A parquet file with a STRUCT
 * `properties` column can push `eo:cloud_cover` while a sibling file with
 * an opaque `properties` cannot, so the report is per batch, not per source.
 */

import type { StacItem } from './stac.js';
import type { FacetState } from './stac-facets.js';

/** Which underlying engine drives this source. Used by the viewer to pick
 * atomic-swap-vs-append, by the UI to choose copy / badges, and by tests. */
export type StacSourceKind = 'api' | 'parquet' | 'static';

/**
 * Per-source capability surface. Read by the viewer at construction (no await
 * — sources are synchronous to construct so the orchestrator can branch on
 * `kind` before any I/O) and by the filter UI to decide which controls to
 * disable / badge as "client-side only".
 *
 * The `pushdown` map is exhaustive: every facet field listed in
 * `FacetState` has a flag here, so adding a new facet is a compile-time
 * error in every consumer until they handle it.
 */
export interface StacSourceCapabilities {
	kind: StacSourceKind;
	/** Human-readable label for HUD copy. e.g. "STAC API", "stac-geoparquet". */
	label: string;
	/** True when count(filter, bbox) is cheap. UI surfaces "Y of X". */
	countAvailable: boolean;
	/** True when query() yields multiple batches before completing. */
	streaming: boolean;
	/**
	 * True when the underlying source is a hive-partitioned parquet directory
	 * (e.g. `s3://bucket/prefix/year=2023/month=01/...`). Set by the parquet
	 * source when the factory detects a directory layout (or the SDK passes
	 * `hivePartitioned: true`). Lets the viewer surface a HUD hint without
	 * inspecting `kind === 'parquet'` alone, since the same `kind` covers
	 * single-file stac-geoparquet.
	 */
	hivePartitioned?: boolean;
	pushdown: {
		bbox: boolean;
		datetime: boolean;
		collection: boolean;
		cloudCover: boolean;
		gsd: boolean;
		epsg: boolean;
		platform: boolean;
		constellation: boolean;
		instruments: boolean;
		assetRoles: boolean;
	};
}

/** Per-query inputs. The signal is required, sources MUST throw
 * `DOMException("Aborted", "AbortError")` on abort, never silently complete. */
export interface StacSourceRequest {
	/** WGS84 viewport bbox `[west, south, east, north]`. Required. Sources that
	 * cannot push down bbox still receive it so they can stream the whole set
	 * and rely on the caller's residual filter. */
	bbox: [number, number, number, number];
	filter: FacetState;
	limit: number;
	/** Per-page hint for sources that paginate. Server may ignore. */
	pageSize?: number;
	signal: AbortSignal;
}

/** One yielded batch of items. */
export interface StacSourceBatch {
	items: StacItem[];
	/** Subset of filter the source / engine applied. UI reports as "pushed". */
	pushedDown: FacetState;
	/** Subset of filter the caller still has to apply via applyFacets(). */
	residual: FacetState;
	/** True when no more batches will arrive for this request. The async
	 * iterator's own end-of-iteration also signals done; this flag lets a
	 * caller break the loop at the moment a single-yield source completes. */
	done: boolean;
	/** Best-effort hint of total matching items, when the source knows. */
	totalHinted?: number;
}

export interface StacSource {
	capabilities: StacSourceCapabilities;
	query(req: StacSourceRequest): AsyncIterable<StacSourceBatch>;
	/** Optional cheap count(filter, bbox). Surfaced as "Y of X" when set. */
	count?(filter: FacetState, bbox: StacSourceRequest['bbox'], signal: AbortSignal): Promise<number>;
}

/** All-false push-down flags. Helper to keep capability declarations terse. */
export function emptyPushdown(): StacSourceCapabilities['pushdown'] {
	return {
		bbox: false,
		datetime: false,
		collection: false,
		cloudCover: false,
		gsd: false,
		epsg: false,
		platform: false,
		constellation: false,
		instruments: false,
		assetRoles: false
	};
}
