// Shim: source lives in packages/objex-utils/src/stac-facets.ts. Kept here so
// existing intra-app imports (../utils/stac-facets.js) continue to resolve.

export type {
	DatetimeFacet,
	EnumFacet,
	EnumFacetField,
	Facet,
	FacetSet,
	FacetSort,
	FacetState,
	NumericFacet,
	NumericFacetField,
	StacItemView
} from '@walkthru-earth/objex-utils';
export {
	applyFacets,
	buildFacets,
	DATETIME_HISTOGRAM_BINS,
	emptyFacetState,
	extractItemView,
	hasActiveFilters,
	sortViews
} from '@walkthru-earth/objex-utils';
