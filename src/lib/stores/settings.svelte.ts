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

	// Sync i18n module with persisted locale
	setLocale(initial.locale);

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
	}

	// Listen for system preference changes when theme is 'system'
	if (typeof window !== 'undefined') {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (theme === 'system') {
				resolved = resolveTheme('system');
				if (typeof document !== 'undefined') {
					document.documentElement.classList.toggle('dark', resolved === 'dark');
				}
			}
		});
	}

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
