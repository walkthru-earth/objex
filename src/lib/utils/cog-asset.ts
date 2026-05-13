// Shim: source lives in packages/objex-utils/src/cog-asset.ts. Kept here so
// existing intra-app imports (../utils/cog-asset.js) continue to resolve.

export type { ChannelComposite, ChannelRef, CogAsset } from '@walkthru-earth/objex-utils';
export {
	allChannelsBand0,
	extractCogAssets,
	isSingleAssetComposite,
	pickNaturalColorComposite,
	syntheticSelfAsset
} from '@walkthru-earth/objex-utils';
