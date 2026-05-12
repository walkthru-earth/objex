// Shim: source lives in packages/objex-utils/src/lru.ts. Kept here so existing
// intra-app imports (../utils/lru.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { LruCacheOptions } from '@walkthru-earth/objex-utils';
export { LruCache } from '@walkthru-earth/objex-utils';
