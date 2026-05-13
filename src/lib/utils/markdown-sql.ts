// Shim: source lives in packages/objex-utils/src/markdown-sql.ts. Kept here so
// existing intra-app imports (../utils/markdown-sql.js) continue to resolve.

export type { ParsedMarkdownDocument, SqlBlock } from '@walkthru-earth/objex-utils';
export {
	interpolateTemplates,
	markSqlBlocks,
	parseMarkdownDocument
} from '@walkthru-earth/objex-utils';
