// Shim: source lives in packages/objex-utils/src/error.ts. Kept here so existing
// intra-app imports (../utils/error.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.
export { handleLoadError, isAbortError } from '@walkthru-earth/objex-utils';
