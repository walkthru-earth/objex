/**
 * Shared constants used across the application.
 * Centralizes magic strings, numbers, and sets to prevent duplication.
 */

// ── localStorage keys ──

export const STORAGE_KEYS = {
	SETTINGS: 'obstore-explore-settings',
	CONNECTIONS: 'obstore-explore-connections',
	QUERY_HISTORY: 'obstore-explore-query-history'
} as const;

// ── Geo / CRS constants ──

/** EPSG codes considered WGS84 (no reprojection needed). */
export const WGS84_CODES = new Set([4326, 4979]);

/**
 * Default target CRS for ST_Transform. Uses OGC:CRS84 (longitude, latitude)
 * to match GeoParquet 1.1+ spec and DuckDB v1.5's canonical form.
 * Functionally equivalent to EPSG:4326 under `geometry_always_xy = true`.
 */
export const DEFAULT_TARGET_CRS = 'OGC:CRS84';

// ── Query engine constants ──

/** DuckDB-WASM initialization timeout in ms. */
export const DUCKDB_INIT_TIMEOUT_MS = 30_000;

/** Maximum entries kept in query history. */
export const MAX_QUERY_HISTORY_ENTRIES = 200;

/** SQL preview truncation length (characters). */
export const SQL_PREVIEW_LENGTH = 120;

// ── File browser constants ──

/** Extensions that represent "virtual files" — directories that open as viewers. */
export const VIEWER_DIR_EXTENSIONS = new Set(['zarr', 'zr3']);

// ── PMTiles ──

/**
 * Golden-angle-based hue multiplier for evenly distributing layer colors.
 * 137 ≈ 360 × (1 − 1/φ) where φ is the golden ratio.
 */
export const LAYER_HUE_MULTIPLIER = 137;

// ── Clipboard ──

/** Duration (ms) to show "Copied!" feedback before resetting. */
export const COPY_FEEDBACK_MS = 2000;

// ── AWS defaults ──

/** Region assumed when a connection or bucket name yields none. AWS's global default. */
export const DEFAULT_AWS_REGION = 'us-east-1';

// ── Map / tiles ──

/** deck.gl tile-layer debounce (ms) before fetching after a viewport change. */
export const TILE_DEBOUNCE_MS = 200;

/** Zoom level used when flying to the first feature of a vector dataset. */
export const FIRST_FEATURE_FLY_ZOOM = 14;
