import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	external: [
		'apache-arrow',
		'hyparquet',
		'hyparquet-compressors',
		'yaml',
		'@developmentseed/geotiff',
		'@developmentseed/epsg',
		'@developmentseed/epsg/all',
		'@developmentseed/epsg/all.csv.gz?url',
		'@developmentseed/proj',
		'maplibre-gl',
		'proj4'
	]
});
