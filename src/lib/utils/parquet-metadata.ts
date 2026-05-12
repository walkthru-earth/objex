// Shim: source lives in packages/objex-utils/src/parquet-metadata.ts. Kept here so existing
// intra-app imports (../utils/parquet-metadata.js) continue to resolve.

export type {
	GeoColumnMeta,
	GeoParquetMeta,
	ParquetFileMetadata
} from '@walkthru-earth/objex-utils';
export {
	extractBounds,
	extractEpsgFromGeoMeta,
	extractGeometryTypes,
	readParquetMetadata
} from '@walkthru-earth/objex-utils';
