/**
 * Reactive media-query helpers for Svelte 5 runes.
 *
 * Usage (inside a component .svelte file):
 *   import { useIsWide } from '../utils/media-query.svelte.js';
 *   const isWide = useIsWide();  // true when viewport >= 640 px (Tailwind sm)
 *   // then: {#if isWide.value} ... {/if}
 *
 * SSR-safe: guards with `typeof window` (this is a CSR-only SPA, but be defensive).
 */

/** Reactive wrapper around a single MediaQueryList. */
export function useIsWide(): { readonly value: boolean } {
	let value = $state(
		typeof window !== 'undefined' ? window.matchMedia('(min-width: 640px)').matches : true
	);

	if (typeof window !== 'undefined') {
		const mq = window.matchMedia('(min-width: 640px)');
		const handler = (e: MediaQueryListEvent) => {
			value = e.matches;
		};

		$effect(() => {
			mq.addEventListener('change', handler);
			return () => mq.removeEventListener('change', handler);
		});
	}

	return {
		get value() {
			return value;
		}
	};
}
