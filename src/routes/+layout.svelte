<script lang="ts">
import './layout.css';
import { settings } from '$lib/stores/settings.svelte.js';

let { children } = $props();

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

<svelte:head><link rel="icon" type="image/svg+xml" href="/favicon.svg" /></svelte:head>

<div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
	{@render children()}
</div>
