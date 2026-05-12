// Shim: source lives in packages/objex-utils/src/channel-composite.ts. Kept here so existing
// intra-app imports (../utils/channel-composite.js) continue to resolve. Safe to delete once
// every consumer is rewritten to import from '@walkthru-earth/objex-utils'.

export type { PresetDef } from '@walkthru-earth/objex-utils';
export {
	applyPreset,
	availablePresets,
	compositeFromUrl,
	compositeToUrl,
	PRESETS,
	presetMatchesComposite
} from '@walkthru-earth/objex-utils';
