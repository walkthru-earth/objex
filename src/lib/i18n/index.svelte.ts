import { ar } from './ar.js';
import { en } from './en.js';

export type Locale = 'en' | 'ar';

const translations: Record<Locale, Record<string, string>> = { en, ar };

const RTL_LOCALES: Set<Locale> = new Set(['ar']);

let currentLocale = $state<Locale>('en');

export function getLocale(): Locale {
	return currentLocale;
}

export function setLocale(l: Locale): void {
	currentLocale = l;
}

export function getDir(): 'ltr' | 'rtl' {
	return RTL_LOCALES.has(currentLocale) ? 'rtl' : 'ltr';
}

/**
 * Translate a key, interpolating `{param}` placeholders.
 * Falls back to English, then to the raw key.
 */
export function t(key: string, params?: Record<string, string | number>): string {
	let text = translations[currentLocale]?.[key] ?? translations.en[key] ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			text = text.replaceAll(`{${k}}`, String(v));
		}
	}
	return text;
}
