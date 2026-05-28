import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	// Allowed peers only. NEVER add the package itself or any heavy dep
	// (@developmentseed/*, proj4, wkt-parser, maplibre-gl, @luma.gl/*, deck.gl,
	// pdfjs-dist, shiki, etc.) here. Marking heavy deps external still emits a
	// bare `import` for them which Vite's pre-bundler fails to resolve on
	// consumer startup (walkthru-earth/objex#11). The only safe move is to
	// keep heavy deps entirely out of the static import graph (use a
	// `*-pure.ts` sibling or lazy `await import(...)`).
	external: ['apache-arrow', 'hyparquet', 'hyparquet-compressors', 'yaml']
});
