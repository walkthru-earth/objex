import type { Theme } from '$lib/types.js';

const SETTINGS_KEY = 'obstore-explore-settings';

interface PersistedSettings {
	theme: Theme;
}

function loadSettings(): PersistedSettings {
	if (typeof window === 'undefined') {
		return { theme: 'system' };
	}
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (raw) {
			return JSON.parse(raw) as PersistedSettings;
		}
	} catch {
		// ignore parse errors
	}
	return { theme: 'system' };
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
	let resolved = $state<'light' | 'dark'>(resolveTheme(initial.theme));

	function applyTheme(t: Theme) {
		theme = t;
		resolved = resolveTheme(t);
		persistSettings({ theme: t });

		if (typeof document !== 'undefined') {
			document.documentElement.classList.toggle('dark', resolved === 'dark');
		}
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
		setTheme(t: Theme) {
			applyTheme(t);
		}
	};
}

export const settings = createSettingsStore();
