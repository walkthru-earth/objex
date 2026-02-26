import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const duckdbPkg = JSON.parse(
	readFileSync(join(__dirname, 'node_modules/@duckdb/duckdb-wasm/package.json'), 'utf-8')
);

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		__DUCKDB_WASM_VERSION__: JSON.stringify(duckdbPkg.version)
	},
	clearScreen: false,
	esbuild: {
		drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : []
	},
	server: {
		port: 5173,
		strictPort: true
	},
	optimizeDeps: {
		include: [
			'@developmentseed/deck.gl-geotiff > @developmentseed/deck.gl-raster',
			'@developmentseed/deck.gl-geotiff > @developmentseed/raster-reproject',
			'@developmentseed/deck.gl-geotiff > proj4',
			'@developmentseed/deck.gl-geotiff > geotiff'
		]
	},
	resolve: {
		dedupe: [
			'@codemirror/state',
			'@codemirror/view',
			'@codemirror/language',
			'@deck.gl/core',
			'@deck.gl/layers',
			'@deck.gl/geo-layers',
			'@deck.gl/mesh-layers',
			'@luma.gl/core',
			'proj4'
		]
	}
});
