import {
	loadFromStorage,
	parseVisibilityParam,
	persistToStorage,
	resolveSetting
} from '@walkthru-earth/objex-utils';
import { STORAGE_KEYS } from '../constants.js';
import type { Locale } from '../i18n/index.svelte.js';
import type { Theme } from '../types.js';
import { appConfig } from './config.svelte.js';

/** Only keys the user explicitly changed are stored, so config edits still reach untouched keys. */
interface UserSettings {
	theme?: Theme;
	locale?: Locale;
	featureLimit?: number;
	mosaicItemLimit?: number;
	showConnectionRail?: boolean;
	showFileTree?: boolean;
}

/**
 * Heuristic mobile detection. iOS Safari caps the WASM heap at ~1.8 GiB and
 * Safari < 17.6 has no `credentialless` COEP, so OPFS spill rarely engages.
 * A 2000-item stac-geoparquet scan with deep STRUCT `assets`/`links` columns
 * blows the heap before the streaming engine can pace it. Clamp the default
 * mosaic item limit lower on mobile so first-run mosaic loads succeed; users
 * can still raise it explicitly in settings.
 */
function isMobileLikeAtLoad(): boolean {
	if (typeof navigator === 'undefined') return false;
	if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
	if (typeof window === 'undefined') return false;
	return Math.min(window.innerWidth, window.innerHeight) <= 820;
}

const MOBILE_MOSAIC_LIMIT = 200;

function loadUser(): UserSettings {
	return loadFromStorage<UserSettings>(STORAGE_KEYS.SETTINGS, {});
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
	if (theme !== 'system') return theme;
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readVisibilityParam(name: string): boolean | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return parseVisibilityParam(new URL(window.location.href).searchParams.get(name));
	} catch {
		return undefined;
	}
}

function createSettingsStore() {
	let user = $state<UserSettings>(loadUser());

	// Query params and mobile detection are static for the session, read once.
	const railParam = readVisibilityParam('sidebar');
	const treeParam = readVisibilityParam('tree');
	const mobileLikeAtLoad = isMobileLikeAtLoad();

	function persist() {
		persistToStorage(STORAGE_KEYS.SETTINGS, user);
	}

	function cfg() {
		return appConfig.value;
	}

	function effTheme(): Theme {
		return resolveSetting(user.theme, cfg().defaults.theme, 'system') as Theme;
	}

	return {
		get theme(): Theme {
			return effTheme();
		},
		get resolved(): 'light' | 'dark' {
			return resolveTheme(effTheme());
		},
		get locale(): Locale {
			return resolveSetting(user.locale, cfg().defaults.locale as Locale, 'en') as Locale;
		},
		get featureLimit(): number {
			return resolveSetting(user.featureLimit, cfg().defaults.featureLimit, 1000) as number;
		},
		get mosaicItemLimit(): number {
			// Explicit user/query choice always wins, at any value.
			if (user.mosaicItemLimit !== undefined) return user.mosaicItemLimit;
			const configured = resolveSetting(cfg().defaults.mosaicItemLimit, 2000) as number;
			// Mobile heap safety: clamp the default so API/static mosaic loads don't OOM.
			return mobileLikeAtLoad ? Math.min(configured, MOBILE_MOSAIC_LIMIT) : configured;
		},
		get showConnectionRail(): boolean {
			return resolveSetting(
				railParam,
				user.showConnectionRail,
				cfg().ui.showConnectionRail,
				true
			) as boolean;
		},
		get showFileTree(): boolean {
			return resolveSetting(treeParam, user.showFileTree, cfg().ui.showFileTree, true) as boolean;
		},
		/** True when a link param is forcing the connection-rail visibility. */
		get railLockedByParam(): boolean {
			return railParam !== undefined;
		},
		/** True when a link param is forcing the file-tree visibility. */
		get treeLockedByParam(): boolean {
			return treeParam !== undefined;
		},
		setTheme(t: Theme) {
			user = { ...user, theme: t };
			persist();
		},
		setLocale(l: Locale) {
			user = { ...user, locale: l };
			persist();
		},
		setFeatureLimit(n: number) {
			user = { ...user, featureLimit: Math.max(1, Math.floor(n)) };
			persist();
		},
		setMosaicItemLimit(n: number) {
			user = { ...user, mosaicItemLimit: Math.max(1, Math.floor(n)) };
			persist();
		},
		setShowConnectionRail(v: boolean) {
			user = { ...user, showConnectionRail: v };
			persist();
		},
		setShowFileTree(v: boolean) {
			user = { ...user, showFileTree: v };
			persist();
		},
		/** Clear all user overrides, reverting every value to config or hardcoded fallback. */
		reset() {
			user = {};
			persist();
		}
	};
}

export const settings = createSettingsStore();
