import { STORAGE_KEYS } from '../constants.js';
import { type Locale, setLocale } from '../i18n/index.svelte.js';
import type { Theme } from '../types.js';
import { loadFromStorage, persistToStorage } from '../utils/local-storage.js';

interface PersistedSettings {
	theme: Theme;
	locale: Locale;
	featureLimit: number;
	mosaicItemLimit: number;
}

/**
 * Heuristic mobile detection. iOS Safari caps the WASM heap at ~1.8 GiB and
 * Safari < 17.6 has no `credentialless` COEP, so OPFS spill rarely engages.
 * A 2000-item stac-geoparquet scan with deep STRUCT `assets`/`links` columns
 * blows the heap before the streaming engine can pace it. Default the cap
 * lower so first-run mosaic loads succeed; users can raise it in settings.
 */
function isMobileLikeAtLoad(): boolean {
	if (typeof navigator === 'undefined') return false;
	if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
	if (typeof window === 'undefined') return false;
	return Math.min(window.innerWidth, window.innerHeight) <= 820;
}

const SETTINGS_DEFAULTS: PersistedSettings = {
	theme: 'system',
	locale: 'en',
	featureLimit: 1000,
	mosaicItemLimit: isMobileLikeAtLoad() ? 400 : 2000
};

function loadSettings(): PersistedSettings {
	const stored = loadFromStorage<Partial<PersistedSettings>>(STORAGE_KEYS.SETTINGS, {});
	return {
		theme: stored.theme ?? SETTINGS_DEFAULTS.theme,
		locale: stored.locale ?? SETTINGS_DEFAULTS.locale,
		featureLimit: stored.featureLimit ?? SETTINGS_DEFAULTS.featureLimit,
		mosaicItemLimit: stored.mosaicItemLimit ?? SETTINGS_DEFAULTS.mosaicItemLimit
	};
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
	if (theme !== 'system') return theme;
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function createSettingsStore() {
	const initial = loadSettings();
	let theme = $state<Theme>(initial.theme);
	let locale = $state<Locale>(initial.locale);
	let featureLimit = $state<number>(initial.featureLimit);
	let mosaicItemLimit = $state<number>(initial.mosaicItemLimit);
	let resolved = $state<'light' | 'dark'>(resolveTheme(initial.theme));

	// Sync i18n module and document dir with persisted locale
	setLocale(initial.locale);
	if (typeof document !== 'undefined') {
		const dir = initial.locale === 'ar' ? 'rtl' : 'ltr';
		document.documentElement.dir = dir;
		document.documentElement.lang = initial.locale;
	}

	function persist() {
		persistToStorage(STORAGE_KEYS.SETTINGS, { theme, locale, featureLimit, mosaicItemLimit });
	}

	function applyTheme(t: Theme) {
		theme = t;
		resolved = resolveTheme(t);
		persist();

		if (typeof document !== 'undefined') {
			document.documentElement.classList.toggle('dark', resolved === 'dark');
		}
	}

	function applyLocale(l: Locale) {
		locale = l;
		setLocale(l);
		persist();

		if (typeof document !== 'undefined') {
			const dir = l === 'ar' ? 'rtl' : 'ltr';
			document.documentElement.dir = dir;
			document.documentElement.lang = l;
		}
	}

	// System theme changes are handled by the $effect in +layout.svelte
	// which properly cleans up the listener. No module-level listener needed.

	return {
		get theme() {
			return theme;
		},
		get resolved() {
			return resolved;
		},
		get locale() {
			return locale;
		},
		get featureLimit() {
			return featureLimit;
		},
		get mosaicItemLimit() {
			return mosaicItemLimit;
		},
		setTheme(t: Theme) {
			applyTheme(t);
		},
		setLocale(l: Locale) {
			applyLocale(l);
		},
		setFeatureLimit(n: number) {
			featureLimit = n;
			persist();
		},
		setMosaicItemLimit(n: number) {
			mosaicItemLimit = Math.max(1, Math.floor(n));
			persist();
		}
	};
}

export const settings = createSettingsStore();
