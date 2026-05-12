// Shim: source lives in packages/objex-utils/src/column-types.ts. Kept here so existing
// intra-app imports (../utils/column-types.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { TypeCategory } from '@walkthru-earth/objex-utils';
export { classifyType, typeBadgeClass, typeColor, typeLabel } from '@walkthru-earth/objex-utils';
