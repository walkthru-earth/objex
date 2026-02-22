import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	clearScreen: false,
	server: {
		port: 5173,
		strictPort: true
	},
	optimizeDeps: {
		include: [
			'@developmentseed/deck.gl-geotiff > @developmentseed/deck.gl-raster',
			'@developmentseed/deck.gl-geotiff > @developmentseed/raster-reproject',
			'@developmentseed/deck.gl-geotiff > proj4'
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
			'geotiff'
		]
	}
});
