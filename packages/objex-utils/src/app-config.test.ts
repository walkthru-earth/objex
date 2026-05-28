import { describe, expect, it } from 'vitest';
import type { AppConfig } from './app-config.js';
import {
	coerceBool,
	coercePositiveInt,
	coerceString,
	coerceTheme,
	DEFAULT_APP_CONFIG,
	mergeAppConfig,
	parseVisibilityParam,
	resolveBasemap,
	resolveSetting
} from './app-config.js';

describe('resolveSetting', () => {
	it('returns the first defined candidate', () => {
		expect(resolveSetting(undefined, null, 'c', 'd')).toBe('c');
		expect(resolveSetting(false, true)).toBe(false); // false is defined
		expect(resolveSetting(undefined, undefined)).toBeUndefined();
	});
});

describe('parseVisibilityParam', () => {
	it('maps hide/show to booleans, else undefined', () => {
		expect(parseVisibilityParam('hide')).toBe(false);
		expect(parseVisibilityParam('show')).toBe(true);
		expect(parseVisibilityParam('')).toBeUndefined();
		expect(parseVisibilityParam(null)).toBeUndefined();
		expect(parseVisibilityParam('yes')).toBeUndefined();
	});
});

describe('coercers', () => {
	it('coerceTheme accepts only known themes', () => {
		expect(coerceTheme('dark')).toBe('dark');
		expect(coerceTheme('neon')).toBeUndefined();
		expect(coerceTheme(5)).toBeUndefined();
	});
	it('coercePositiveInt floors positive finite numbers', () => {
		expect(coercePositiveInt(10.9)).toBe(10);
		expect(coercePositiveInt(0)).toBeUndefined();
		expect(coercePositiveInt(-3)).toBeUndefined();
		expect(coercePositiveInt('10')).toBeUndefined();
	});
	it('coerceString rejects empty, whitespace-only, and non-strings', () => {
		expect(coerceString('hello')).toBe('hello');
		expect(coerceString('')).toBeUndefined();
		expect(coerceString('   ')).toBeUndefined();
		expect(coerceString(42)).toBeUndefined();
		expect(coerceString(null)).toBeUndefined();
	});
	it('coerceBool accepts only booleans', () => {
		expect(coerceBool(true)).toBe(true);
		expect(coerceBool('true')).toBeUndefined();
	});
});

describe('mergeAppConfig', () => {
	it('returns base unchanged for non-object input', () => {
		expect(mergeAppConfig(DEFAULT_APP_CONFIG, null)).toEqual(DEFAULT_APP_CONFIG);
		expect(mergeAppConfig(DEFAULT_APP_CONFIG, 'nope')).toEqual(DEFAULT_APP_CONFIG);
		expect(mergeAppConfig(DEFAULT_APP_CONFIG, [1, 2])).toEqual(DEFAULT_APP_CONFIG);
	});

	it('applies partial defaults and ignores garbage fields', () => {
		const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
			defaults: { theme: 'dark', featureLimit: 50, junk: 1 },
			bogus: true
		});
		expect(merged.defaults.theme).toBe('dark');
		expect(merged.defaults.featureLimit).toBe(50);
		expect(merged.defaults.locale).toBe('en'); // untouched
	});

	it('merges ui toggles independently', () => {
		const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
			ui: { showConnectionRail: false }
		});
		expect(merged.ui.showConnectionRail).toBe(false);
		expect(merged.ui.showFileTree).toBe(true);
		expect(merged.ui.showSettings).toBe(true);
	});

	it('filters basemaps to well-formed entries', () => {
		const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
			basemaps: [
				{ id: 'a', label: 'A', type: 'vector', url: 'https://x/style.json' },
				{ id: 'bad' }, // dropped, missing url/type/label
				{ id: 'b', label: 'B', type: 'raster', url: 'https://y/{z}/{x}/{y}.png', variant: 'dark' }
			]
		});
		expect(merged.basemaps.map((b) => b.id)).toEqual(['a', 'b']);
		expect(merged.basemaps[1].variant).toBe('dark');
	});

	it('filters connection seeds to entries with name and bucket', () => {
		const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
			connections: [
				{ name: 'Pub', provider: 's3', bucket: 'b', region: 'us-west-2', anonymous: true },
				{ name: 'Priv', provider: 'gcs', bucket: 'c', anonymous: false },
				{ provider: 's3' } // dropped, missing name and bucket
			]
		});
		expect(merged.connections).toHaveLength(2);
		expect(merged.connections[0].name).toBe('Pub');
		expect(merged.connections[1].anonymous).toBe(false);
	});
});

function cfgWith(over: Partial<AppConfig>): AppConfig {
	return { ...DEFAULT_APP_CONFIG, ...over };
}

describe('resolveBasemap', () => {
	const positron = {
		id: 'positron',
		label: 'Positron',
		type: 'vector' as const,
		url: 'p',
		variant: 'light' as const
	};
	const dark = {
		id: 'dark-matter',
		label: 'Dark Matter',
		type: 'vector' as const,
		url: 'd',
		variant: 'dark' as const
	};
	const osm = { id: 'osm', label: 'OSM', type: 'raster' as const, url: 'o' };

	it('returns undefined when no basemaps are configured', () => {
		expect(resolveBasemap(DEFAULT_APP_CONFIG, 'light', undefined)).toBeUndefined();
	});

	it('honours an explicit user pick regardless of theme', () => {
		const cfg = cfgWith({
			basemaps: [positron, dark, osm],
			defaultBasemap: { light: 'positron', dark: 'dark-matter' }
		});
		expect(resolveBasemap(cfg, 'dark', 'osm')).toEqual(osm);
		expect(resolveBasemap(cfg, 'light', 'osm')).toEqual(osm);
	});

	it('ignores a user pick that no longer exists and falls through', () => {
		const cfg = cfgWith({
			basemaps: [positron, dark],
			defaultBasemap: { light: 'positron', dark: 'dark-matter' }
		});
		expect(resolveBasemap(cfg, 'dark', 'gone')).toEqual(dark);
	});

	it('falls back to defaultBasemap for the variant', () => {
		const cfg = cfgWith({
			basemaps: [positron, dark],
			defaultBasemap: { light: 'positron', dark: 'dark-matter' }
		});
		expect(resolveBasemap(cfg, 'light', undefined)).toEqual(positron);
		expect(resolveBasemap(cfg, 'dark', undefined)).toEqual(dark);
	});

	it('falls back to first basemap matching the variant when no default set', () => {
		const cfg = cfgWith({ basemaps: [positron, dark], defaultBasemap: {} });
		expect(resolveBasemap(cfg, 'dark', undefined)).toEqual(dark);
	});

	it('falls back to the first basemap when nothing matches the variant', () => {
		const cfg = cfgWith({ basemaps: [osm], defaultBasemap: {} });
		expect(resolveBasemap(cfg, 'light', undefined)).toEqual(osm);
	});
});
