// Shim: source lives in packages/objex-utils/src/host-detection.ts. Kept here
// so existing intra-app imports (../utils/host-detection.js) continue to
// resolve.

export type { DetectedHost } from '@walkthru-earth/objex-utils';
export { applyStacItemStorageHints, detectHostBucket } from '@walkthru-earth/objex-utils';
