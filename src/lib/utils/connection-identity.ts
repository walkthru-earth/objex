// Shim: source lives in packages/objex-utils/src/connection-identity.ts. Kept here so existing
// intra-app imports (../utils/connection-identity.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { ConnectionIdentityInput } from '@walkthru-earth/objex-utils';
export {
	connectionIdentityKey,
	isSameConnectionIdentity,
	normalizeEndpoint,
	normalizeProvider
} from '@walkthru-earth/objex-utils';
