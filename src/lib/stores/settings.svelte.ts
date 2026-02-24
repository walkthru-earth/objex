import { type Locale, setLocale } from '$lib/i18n/index.svelte.js';
import type { Theme } from '$lib/types.js';

const SETTINGS_KEY = 'obstore-explore-settings';

interface PersistedSettings {
	theme: Theme;
	locale: Locale;
	featureLimit: number;
}

function loadSettings(): PersistedSettings {
	if (typeof window === 'undefined') {
		return { theme: 'system', locale: 'en', featureLimit: 100 };
	}
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			return {
				theme: parsed.theme ?? 'system',
				locale: parsed.locale ?? 'en',
				featureLimit: parsed.featureLimit ?? 100
			};
		}
	} catch {
		// ignore parse errors
	}
	return { theme: 'system', locale: 'en', featureLimit: 100 };
}

function persistSettings(settings: PersistedSettings): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// ignore storage errors
	}
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
	if (theme !== 'system') return theme;
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function createSettingsStore() {
	const initial = loadSettings();
	let theme = $state<Theme>(initial.theme);
	let locale = $state<Locale>(initial.locale);
	let featureLimit = $state<number>(initial.featureLimit);
	let resolved = $state<'light' | 'dark'>(resolveTheme(initial.theme));

	// Sync i18n module and document dir with persisted locale
	setLocale(initial.locale);
	if (typeof document !== 'undefined') {
		const dir = initial.locale === 'ar' ? 'rtl' : 'ltr';
		document.documentElement.dir = dir;
		document.documentElement.lang = initial.locale;
	}

	function persist() {
		persistSettings({ theme, locale, featureLimit });
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
		setTheme(t: Theme) {
			applyTheme(t);
		},
		setLocale(l: Locale) {
			applyLocale(l);
		},
		setFeatureLimit(n: number) {
			featureLimit = n;
			persist();
		}
	};
}

export const settings = createSettingsStore();
