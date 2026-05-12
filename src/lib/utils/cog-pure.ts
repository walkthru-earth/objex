// Shim: source lives in packages/objex-utils/src/cog-pure.ts. Kept here so existing
// intra-app imports (../utils/cog-pure.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { CogInfo, GeoBounds } from '@walkthru-earth/objex-utils';
export {
	buildDataTypeLabel,
	clampBounds,
	SF_LABELS,
	safeClamp
} from '@walkthru-earth/objex-utils';
