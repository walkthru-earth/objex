// Shim: source lives in packages/objex-utils/src/wkb.ts. Kept here so existing
// intra-app imports (../utils/wkb.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { GeoType, ParsedGeometry } from '@walkthru-earth/objex-utils';
export {
	findGeoColumn,
	findGeoColumnFromRows,
	parseWKB,
	toBinary
} from '@walkthru-earth/objex-utils';
