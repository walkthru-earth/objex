import { base } from '$app/paths';
import { loadConfig } from '$lib/stores/config.svelte.js';

export const prerender = true;
export const ssr = false;

export const load = async () => {
	await loadConfig(base);
	return {};
};
