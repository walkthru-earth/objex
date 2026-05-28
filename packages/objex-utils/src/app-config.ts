import type { Theme } from '../../../src/lib/types.js';

/** A basemap option a host can offer. Consumed in Phase 2. */
export interface BasemapConfig {
	id: string;
	label: string;
	type: 'vector' | 'raster';
	url: string;
	variant?: 'light' | 'dark';
}

/** A preloaded connection definition. Never carries secrets. Consumed in Phase 2. */
export interface ConnectionSeed {
	name: string;
	provider: string;
	bucket: string;
	region?: string;
	endpoint?: string;
	anonymous?: boolean;
	authMethod?: 'sigv4' | 'sas-token';
	rootPrefix?: string;
}

export interface AppConfigDefaults {
	theme: Theme;
	locale: string;
	featureLimit: number;
	mosaicItemLimit: number;
}

export interface AppConfigUi {
	showConnectionRail: boolean;
	showFileTree: boolean;
	showSettings: boolean;
}

export interface AppConfig {
	defaults: AppConfigDefaults;
	ui: AppConfigUi;
	basemaps: BasemapConfig[];
	defaultBasemap: { light?: string; dark?: string };
	connections: ConnectionSeed[];
}

/** Hardcoded fallback. Matches current app behaviour when no config is present. */
export const DEFAULT_APP_CONFIG: AppConfig = {
	defaults: { theme: 'system', locale: 'en', featureLimit: 1000, mosaicItemLimit: 2000 },
	ui: { showConnectionRail: true, showFileTree: true, showSettings: true },
	basemaps: [
		{
			id: 'positron',
			label: 'Positron',
			type: 'vector',
			url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
			variant: 'light'
		},
		{
			id: 'dark-matter',
			label: 'Dark Matter',
			type: 'vector',
			url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
			variant: 'dark'
		}
	],
	defaultBasemap: { light: 'positron', dark: 'dark-matter' },
	connections: []
};

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject | undefined {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : undefined;
}

export function coerceTheme(v: unknown): Theme | undefined {
	return v === 'light' || v === 'dark' || v === 'system' ? v : undefined;
}

export function coerceString(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export function coercePositiveInt(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
}

export function coerceBool(v: unknown): boolean | undefined {
	return typeof v === 'boolean' ? v : undefined;
}

/** First defined (non-null, non-undefined) candidate wins. Encodes the precedence chain. */
export function resolveSetting<T>(...candidates: (T | null | undefined)[]): T | undefined {
	for (const c of candidates) {
		if (c !== null && c !== undefined) return c;
	}
	return undefined;
}

/** Maps the ?sidebar / ?tree visibility param to a boolean, or undefined when absent or invalid. */
export function parseVisibilityParam(value: string | null): boolean | undefined {
	if (value === 'hide') return false;
	if (value === 'show') return true;
	return undefined;
}

function coerceBasemaps(v: unknown): BasemapConfig[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: BasemapConfig[] = [];
	for (const raw of v) {
		const o = asObject(raw);
		if (!o) continue;
		const id = coerceString(o.id);
		const label = coerceString(o.label);
		const url = coerceString(o.url);
		const type = o.type === 'vector' || o.type === 'raster' ? o.type : undefined;
		if (!id || !label || !url || !type) continue;
		const variant = o.variant === 'light' || o.variant === 'dark' ? o.variant : undefined;
		out.push({ id, label, url, type, ...(variant ? { variant } : {}) });
	}
	return out;
}

function coerceConnections(v: unknown): ConnectionSeed[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: ConnectionSeed[] = [];
	for (const raw of v) {
		const o = asObject(raw);
		if (!o) continue;
		const name = coerceString(o.name);
		const bucket = coerceString(o.bucket);
		if (!name || !bucket) continue;
		const region = coerceString(o.region);
		const endpoint = coerceString(o.endpoint);
		const anonymous = coerceBool(o.anonymous);
		const authMethod =
			o.authMethod === 'sigv4' || o.authMethod === 'sas-token' ? o.authMethod : undefined;
		const rootPrefix = coerceString(o.rootPrefix);
		out.push({
			name,
			bucket,
			provider: coerceString(o.provider) ?? 's3',
			...(region !== undefined ? { region } : {}),
			...(endpoint !== undefined ? { endpoint } : {}),
			...(anonymous !== undefined ? { anonymous } : {}),
			...(authMethod !== undefined ? { authMethod } : {}),
			...(rootPrefix !== undefined ? { rootPrefix } : {})
		});
	}
	return out;
}

/**
 * Pick the basemap a map should render. Precedence: explicit user pick (when it
 * still exists in the configured list) > the configured default for the theme
 * variant > the first basemap matching the variant > the first basemap of any
 * variant. Returns undefined when no basemaps are configured, signalling the
 * caller to fall back to its hardcoded default.
 */
export function resolveBasemap(
	config: AppConfig,
	variant: 'light' | 'dark',
	userId: string | undefined
): BasemapConfig | undefined {
	const list = config.basemaps;
	if (list.length === 0) return undefined;
	if (userId) {
		const picked = list.find((b) => b.id === userId);
		if (picked) return picked;
	}
	const defaultId = config.defaultBasemap[variant];
	if (defaultId) {
		const byDefault = list.find((b) => b.id === defaultId);
		if (byDefault) return byDefault;
	}
	return list.find((b) => b.variant === variant) ?? list[0];
}

/**
 * Merge an untrusted JSON value over a base config, field by field.
 * Unknown fields are ignored. Malformed values fall back to the base.
 * Never reads secrets.
 */
export function mergeAppConfig(base: AppConfig, override: unknown): AppConfig {
	const o = asObject(override);
	if (!o) return base;
	const d = asObject(o.defaults) ?? {};
	const u = asObject(o.ui) ?? {};
	const db = asObject(o.defaultBasemap) ?? {};
	return {
		defaults: {
			theme: coerceTheme(d.theme) ?? base.defaults.theme,
			locale: coerceString(d.locale) ?? base.defaults.locale,
			featureLimit: coercePositiveInt(d.featureLimit) ?? base.defaults.featureLimit,
			mosaicItemLimit: coercePositiveInt(d.mosaicItemLimit) ?? base.defaults.mosaicItemLimit
		},
		ui: {
			showConnectionRail: coerceBool(u.showConnectionRail) ?? base.ui.showConnectionRail,
			showFileTree: coerceBool(u.showFileTree) ?? base.ui.showFileTree,
			showSettings: coerceBool(u.showSettings) ?? base.ui.showSettings
		},
		basemaps: coerceBasemaps(o.basemaps) ?? base.basemaps,
		defaultBasemap: ((): { light?: string; dark?: string } => {
			const light = coerceString(db.light) ?? base.defaultBasemap.light;
			const dark = coerceString(db.dark) ?? base.defaultBasemap.dark;
			return { ...(light !== undefined ? { light } : {}), ...(dark !== undefined ? { dark } : {}) };
		})(),
		connections: coerceConnections(o.connections) ?? base.connections
	};
}
