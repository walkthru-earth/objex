// Shim: source lives in packages/objex-utils/src/hex.ts. Kept here so existing
// intra-app imports (../utils/hex.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { HexRow } from '@walkthru-earth/objex-utils';
export { generateHexDump } from '@walkthru-earth/objex-utils';
