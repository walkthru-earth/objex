// Shim: source lives in packages/objex-utils/src/geometry-type.ts. Kept here so existing
// intra-app imports (../utils/geometry-type.js) continue to resolve.

export type { GeometryTypeInfo } from '@walkthru-earth/objex-utils';
export {
	buildTransformExpr,
	isWgs84Crs,
	parseGeometryTypeCrs,
	wrapWkbWithCrs
} from '@walkthru-earth/objex-utils';
