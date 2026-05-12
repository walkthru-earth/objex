// Shim: source lives in packages/objex-utils/src/geoarrow.ts. Kept here so existing
// intra-app imports (../utils/geoarrow.js) continue to resolve.

export type { GeoArrowGeomType, GeoArrowResult } from '@walkthru-earth/objex-utils';
export { buildGeoArrowTables, normalizeGeomType } from '@walkthru-earth/objex-utils';
