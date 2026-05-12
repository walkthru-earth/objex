// Shim: source lives in packages/objex-utils/src/storage-smoketest.ts. Kept here so existing
// intra-app imports (../utils/storage-smoketest.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { SmokeTestResult } from '@walkthru-earth/objex-utils';
export { smokeTestHref } from '@walkthru-earth/objex-utils';
