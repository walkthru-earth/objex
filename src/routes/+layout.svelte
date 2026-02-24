<script lang="ts">
import './layout.css';
import { afterNavigate, beforeNavigate } from '$app/navigation';
import { base } from '$app/paths';
import { getDir } from '$lib/i18n/index.svelte.js';
import { settings } from '$lib/stores/settings.svelte.js';
import { capturePageleave, capturePageview, initAnalytics } from '$lib/utils/analytics.js';

let { children } = $props();

// PostHog analytics
initAnalytics();
beforeNavigate(({ willUnload }) => {
	if (!willUnload) capturePageleave();
});
afterNavigate(() => {
	capturePageview(window.location.href);
});

// Apply theme class to html element
$effect(() => {
	const root = document.documentElement;

	if (settings.theme === 'system') {
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		root.classList.toggle('dark', prefersDark);
	} else {
		root.classList.toggle('dark', settings.theme === 'dark');
	}
});

// Apply locale dir and lang to html element
$effect(() => {
	const root = document.documentElement;
	root.dir = getDir();
	root.lang = settings.locale;
});

// Also listen for system theme changes when set to "system"
$effect(() => {
	if (settings.theme !== 'system') return;

	const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
	const handler = (e: MediaQueryListEvent) => {
		document.documentElement.classList.toggle('dark', e.matches);
	};

	mediaQuery.addEventListener('change', handler);
	return () => mediaQuery.removeEventListener('change', handler);
});
</script>

<svelte:head><link rel="icon" type="image/svg+xml" href="{base}/favicon.svg" /></svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
	{@render children()}
</div>
