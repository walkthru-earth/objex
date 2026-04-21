import type { KnipConfig } from 'knip';
import { compile } from 'svelte/compiler';

// Use the real Svelte compiler instead of knip's default regex-only scanner so
// that imports inside `.svelte` files (including across the `{#await import(...)}`
// dynamic viewer boundary) are resolved. Trade-off: type-only imports inside
// `.svelte` files may be reported as unused (see knip issue #1670). Treat those
// as noise until upstream lands a fix.
const config: KnipConfig = {
	entry: [
		// Every dynamically-imported .svelte component needs to be listed explicitly
		// because knip cannot statically resolve `{#await import('./X.svelte')}`.
		// Top-level viewers dynamically imported by `ViewerRouter.svelte`:
		'src/lib/components/viewers/ArchiveViewer.svelte',
		'src/lib/components/viewers/CogViewer.svelte',
		'src/lib/components/viewers/CopcViewer.svelte',
		'src/lib/components/viewers/DatabaseViewer.svelte',
		'src/lib/components/viewers/FlatGeobufViewer.svelte',
		'src/lib/components/viewers/MarkdownViewer.svelte',
		'src/lib/components/viewers/ModelViewer.svelte',
		'src/lib/components/viewers/NotebookViewer.svelte',
		'src/lib/components/viewers/PdfViewer.svelte',
		'src/lib/components/viewers/PmtilesViewer.svelte',
		'src/lib/components/viewers/ZarrViewer.svelte',
		// Image/video/audio/code/raw are routed statically by `ViewerRouter` but
		// still imported via `{#await import(...)}`:
		'src/lib/components/viewers/CodeViewer.svelte',
		'src/lib/components/viewers/ImageViewer.svelte',
		'src/lib/components/viewers/MediaViewer.svelte',
		'src/lib/components/viewers/RawViewer.svelte',
		'src/lib/components/viewers/TableViewer.svelte',
		// Nested map viewers dynamically imported from inside other viewers:
		'src/lib/components/viewers/GeoParquetMapViewer.svelte',
		'src/lib/components/viewers/StacMapViewer.svelte',
		'src/lib/components/viewers/ZarrMapViewer.svelte',
		'src/lib/components/viewers/pmtiles/PmtilesMapView.svelte',
		'src/lib/components/viewers/pmtiles/PmtilesArchiveView.svelte',
		'src/lib/components/viewers/pmtiles/PmtilesTileInspector.svelte'
	],
	compilers: {
		svelte: (src: string) => compile(src, { generate: 'client' }).js.code
	},
	ignoreExportsUsedInFile: true,
	ignoreDependencies: [
		// Loaded via Tailwind's PostCSS pipeline / globals.css, not imported from TS.
		'@tailwindcss/forms',
		'@tailwindcss/typography',
		'tw-animate-css',
		'@fontsource/cairo',
		// App-only analytics wired in src/routes/+layout.svelte (not src/lib/).
		'posthog-js',
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
