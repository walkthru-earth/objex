// Shim: source lives in packages/objex-utils/src/stac.ts. Kept here so existing
// intra-app imports (../utils/stac.js) continue to resolve.

export type {
	BandMap,
	BandSlot,
	MosaicSourceMeta,
	RasterBandAsset,
	StacAsset,
	StacCatalog,
	StacCollection,
	StacFeatureCollection,
	StacItem,
	StacLink,
	StacRoutableKind
} from '@walkthru-earth/objex-utils';
export {
	buildMosaicSourceMeta,
	classifyStac,
	detectMosaicCapable,
	detectMultiCogCapable,
	extractMosaicAssets,
	extractRasterBandAssets,
	extractSentinelBandAssets,
	hasCompositableBands,
	hasRgbBands,
	isStacCatalog,
	isStacCollection,
	isStacFeatureCollection,
	isStacItem,
	pickCogAssetHref,
	resolveBandSlotAssetKey,
	resolvePresetComposite,
	STAC_COG_ASSET_KEYS,
	spatialCellKey,
	stacItemBbox
} from '@walkthru-earth/objex-utils';
