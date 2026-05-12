// Shim: source lives in packages/objex-utils/src/stac-storage-extension.ts. Kept here so existing
// intra-app imports (../utils/stac-storage-extension.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { StorageExtensionVersion, StorageHints } from '@walkthru-earth/objex-utils';
export {
	applyStorageHintsToConnection,
	detectStorageExtensionVersion,
	emptyStorageHints,
	extractStorageHints
} from '@walkthru-earth/objex-utils';
