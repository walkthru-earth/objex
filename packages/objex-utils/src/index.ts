// Constants
export {
	COPY_FEEDBACK_MS,
	DEFAULT_TARGET_CRS,
	DUCKDB_INIT_TIMEOUT_MS,
	LAYER_HUE_MULTIPLIER,
	MAX_QUERY_HISTORY_ENTRIES,
	SQL_PREVIEW_LENGTH,
	STORAGE_KEYS,
	VIEWER_DIR_EXTENSIONS,
	WGS84_CODES
} from '../../../src/lib/constants.js';
// File icons registry
export type {
	DuckDbReadFn,
	FileCategory,
	FileTypeInfo,
	ViewerKind
} from '../../../src/lib/file-icons/index.js';
export {
	buildDuckDbSource,
	getDuckDbReadFn,
	getFileTypeInfo,
	getMimeType,
	getViewerKind,
	isCloudNativeFormat,
	isQueryable
} from '../../../src/lib/file-icons/index.js';
// Query engine types
export type {
	MapQueryHandle,
	MapQueryResult,
	QueryEngine,
	QueryHandle,
	QueryResult,
	QuerySource,
	SchemaField
} from '../../../src/lib/query/engine.js';
export { QueryCancelledError } from '../../../src/lib/query/engine.js';
// Storage adapters
export type { ListPage, StorageAdapter } from '../../../src/lib/storage/adapter.js';
// Provider registry
export type {
	AccessMode,
	AccessModeInput,
	ProviderDef,
	ProviderId,
	ProviderRegion
} from '../../../src/lib/storage/providers.js';
export {
	buildEndpointFromTemplate,
	buildProviderBaseUrl,
	getAccessMode,
	getProvider,
	isGcsProvider,
	isPubliclyStreamable,
	PROVIDER_IDS,
	PROVIDERS,
	resolveProviderEndpoint
} from '../../../src/lib/storage/providers.js';
export { UrlAdapter } from '../../../src/lib/storage/url-adapter.js';
// Core types
export type {
	Connection,
	ConnectionConfig,
	FileEntry,
	Tab,
	Theme,
	WriteResult
} from '../../../src/lib/types.js';

// ====================================================================
// Utilities physically located in packages/objex-utils/src/
// (alphabetical by file basename)
// ====================================================================

// App runtime config (pure types + merge + precedence resolver)
export * from './app-config.js';
// Channel composite presets + URL round-trip (unified RGB picker)
export * from './channel-composite.js';
// Clipboard helper (navigator.clipboard + feedback timeout)
export * from './clipboard.js';
// Cloud URL resolution
export * from './cloud-url.js';
// COG asset enumeration (unified RGB picker)
export * from './cog-asset.js';
// COG utilities (pure helpers only, no maplibre/geotiff/epsg/proj dependency).
// MUST import from `cog-info.ts` and NOT `cog.ts`. `cog.ts` has top-level
// imports for `@developmentseed/epsg/all`, `@developmentseed/geotiff`,
// `@developmentseed/proj`, `maplibre-gl`, and `proj4`, which tsup preserves
// as bare side-effect imports in the bundled output even when all named
// bindings are tree-shaken away. That breaks consumer Vite pre-bundles on
// `@developmentseed/epsg/all.csv.gz?url` (Vite loader query) and would force
// every downstream project to install the full COG stack just to use the
// pure TS utilities. See walkthru-earth/objex#11.
export * from './cog-info.js';
// Column type classification
export * from './column-types.js';
// Connection identity (canonical key for dedup across auto-detect/manual add/edit)
export * from './connection-identity.js';
// Error handling
export * from './error.js';
// Data export / serialization (browser-only download triggers + pure serialisers)
export * from './export.js';
// File sorting
export * from './file-sort.js';
// Formatting
export * from './format.js';
// GeoArrow
export * from './geoarrow.js';
// Geometry type (DuckDB v1.5 parameterized GEOMETRY parsing)
export * from './geometry-type.js';
// Hex dump
export * from './hex.js';
// Host detection (auto-detect provider/region from URL)
export * from './host-detection.js';
// localStorage helpers (SSR-safe)
export * from './local-storage.js';
// LRU cache
export * from './lru.js';
// Map pixel inspector (click→probe coordination types)
export * from './map-pixel-inspect.js';
// Markdown / SQL parsing (yaml is loaded lazily inside parseMarkdownDocument)
export * from './markdown-sql.js';
// Markdown SQL execution context (engine injected by host)
export * from './markdown-sql-context.js';
// Notebook (Jupyter .ipynb) renderer
export * from './notebook.js';
// Parquet metadata
export * from './parquet-metadata.js';
// STAC types and helpers
export * from './stac.js';
// STAC facets (auto-detected filters, sorts, slim views)
export * from './stac-facets.js';
// stac-geoparquet (detection + row → Item transform)
export * from './stac-geoparquet.js';
// STAC link-following hydrator (Catalog / Collection / FeatureCollection)
export * from './stac-hydrate.js';
// STAC API filter push-down (CQL2 + native query params)
export * from './stac-pushdown.js';
// STAC source contract
export * from './stac-source.js';
// STAC source - API implementation
export * from './stac-source-api.js';
// STAC source - static catalog implementation
export * from './stac-source-static.js';
// STAC Storage Extension (region / endpoint hints from STAC Items)
export * from './stac-storage-extension.js';
// Storage open-time smoke test (ranged GET probe)
export * from './storage-smoketest.js';
// Storage URL parsing
export * from './storage-url.js';
// WKB parsing
export * from './wkb.js';
