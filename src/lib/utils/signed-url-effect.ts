import type { Tab } from '../types.js';
import { buildHttpsUrlAsync } from './signed-url.js';

/**
 * Resolve a tab's signed HTTPS URL reactively for iframe-style viewers.
 * Call inside a component's $effect; returns a cleanup function.
 * onResolved runs only if the tab is still current (guards the async race).
 */
export function resolveSignedTabUrl(tab: Tab, onResolved: (url: string) => void): () => void {
	let cancelled = false;
	const id = tab.id;
	(async () => {
		const url = await buildHttpsUrlAsync(tab);
		if (cancelled || id !== tab.id) return;
		onResolved(url);
	})();
	return () => {
		cancelled = true;
	};
}
