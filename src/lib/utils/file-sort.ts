// Shim: source lives in packages/objex-utils/src/file-sort.ts. Kept here so existing
// intra-app imports (../utils/file-sort.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { SortConfig, SortDirection, SortField } from '@walkthru-earth/objex-utils';
export { sortFileEntries, toggleSortField } from '@walkthru-earth/objex-utils';
