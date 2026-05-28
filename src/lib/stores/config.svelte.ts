import { type AppConfig, DEFAULT_APP_CONFIG, mergeAppConfig } from '@walkthru-earth/objex-utils';

export type ConfigStatus = 'pending' | 'bundled' | 'custom' | 'error';

let config = $state.raw<AppConfig>(DEFAULT_APP_CONFIG);
let status = $state<ConfigStatus>('pending');

/** Reactive accessor for the loaded config and its load status. */
export const appConfig = {
	get value(): AppConfig {
		return config;
	},
	get status(): ConfigStatus {
		return status;
	}
};

function readConfigParam(): string | null {
	if (typeof window === 'undefined') return null;
	try {
		return new URL(window.location.href).searchParams.get('config');
	} catch {
		return null;
	}
}

/**
 * Fetch and merge the runtime config. Awaited in +layout.ts `load` so the
 * config is ready before any component mounts. A `?config=<url>` param loads a
 * remote file (status `custom`), otherwise the bundled `static/config.json`
 * (status `bundled`). Any failure falls back to defaults (status `error`) and
 * the app still boots.
 */
export async function loadConfig(basePath: string): Promise<void> {
	const customUrl = readConfigParam();
	const url = customUrl ?? `${basePath}/config.json`;
	try {
		const res = await fetch(url, { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json: unknown = await res.json();
		config = mergeAppConfig(DEFAULT_APP_CONFIG, json);
		status = customUrl ? 'custom' : 'bundled';
	} catch (err) {
		console.warn('[objex] config load failed, using defaults', err);
		config = DEFAULT_APP_CONFIG;
		status = 'error';
	}
}
