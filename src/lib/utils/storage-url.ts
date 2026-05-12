// Shim: source lives in packages/objex-utils/src/storage-url.ts. Kept here so existing
// intra-app imports (../utils/storage-url.js) continue to resolve.

export type {
	Defaults,
	ParsedStorageUrl,
	StorageProvider,
	UrlClassification
} from '@walkthru-earth/objex-utils';
export {
	classifyUrl,
	describeParseResult,
	isKnownBucketHost,
	looksLikeUrl,
	parseStorageUrl,
	STAC_API_PATH_RE
} from '@walkthru-earth/objex-utils';
