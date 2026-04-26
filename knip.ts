import type { KnipConfig } from 'knip';
import { compile } from 'svelte/compiler';

// Use the real Svelte compiler instead of knip's default regex-only scanner so
// that imports inside `.svelte` files (including across the `{#await import(...)}`
// dynamic viewer boundary) are resolved. Trade-off: type-only imports inside
// `.svelte` files may be reported as unused (see knip issue #1670). Treat those
// as noise until upstream lands a fix.
const config: KnipConfig = {
	// The Svelte compiler we wire up below emits `{#await import('./X.svelte')}`
	// as a real `import()` call, which knip can trace through ViewerRouter and
	// the nested map viewers — so no explicit entry list is needed for them.
	compilers: {
		svelte: (src: string) => compile(src, { generate: 'client' }).js.code
	},
	ignoreExportsUsedInFile: true,
	// Knip issue #1670: type-only imports inside `.svelte` files aren't traced
	// back through the Svelte compiler output, so shadcn-style helper types
	// declared in `src/lib/utils.ts` are flagged even when widely used.
	ignore: ['src/lib/utils.ts'],
	ignoreDependencies: [
		// Loaded via Tailwind's PostCSS pipeline (Tailwind v3 plugin), not imported from TS.
		'@tailwindcss/forms',
		// Release-only CLI tool invoked by .github/workflows/release.yml.
		'@changesets/cli',
		// Runtime companion for hyparquet: when hyparquet decodes compressed
		// Parquet it looks for compressors registered by this package. Not
		// imported from TS in this repo, but required at runtime.
		'hyparquet-compressors',
		// Peer of @deck.gl/* (shared chunk resolution); not directly imported.
		'deck.gl',
		// Peer of deck.gl luma.gl pipeline; not directly imported in this repo.
		'@repeaterjs/repeater'
	],
	workspaces: {
		'packages/objex-utils': {
			project: ['src/**/*.ts']
		}
	}
};

export default config;
