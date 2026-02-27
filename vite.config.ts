import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appPkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
const duckdbPkg = JSON.parse(
	readFileSync(join(__dirname, 'node_modules/@duckdb/duckdb-wasm/package.json'), 'utf-8')
);

function collectThirdPartyLicenses(): {
	license: string;
	packages: { name: string; url: string }[];
}[] {
	const deps = Object.keys(appPkg.dependencies ?? {});
	const byLicense = new Map<string, { name: string; url: string }[]>();

	for (const dep of deps) {
		const pkgPath = join(__dirname, 'node_modules', dep, 'package.json');
		if (!existsSync(pkgPath)) continue;

		const depPkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
		let license = depPkg.license ?? 'UNKNOWN';

		// Normalize "SEE LICENSE IN …" → read the LICENSE file header
		if (license.startsWith('SEE LICENSE')) {
			const licFile = join(__dirname, 'node_modules', dep, 'LICENSE');
			if (existsSync(licFile)) {
				const head = readFileSync(licFile, 'utf-8').slice(0, 2048);
				if (head.includes('Apache License')) license = 'Apache-2.0';
				else if (head.includes('BSD')) license = 'BSD-3-Clause';
				else license = 'Custom';
			}
		}

		// Extract repo URL
		let url = '';
		const repo = depPkg.repository;
		if (typeof repo === 'string') {
			url = repo;
		} else if (repo?.url) {
			url = repo.url;
		}
		url = url
			.replace(/^git\+/, '')
			.replace(/^git:\/\//, 'https://')
			.replace(/^git@github\.com:/, 'https://github.com/')
			.replace(/\.git$/, '');
		if (!url) url = `https://www.npmjs.com/package/${dep}`;

		const group = byLicense.get(license);
		const entry = { name: dep, url };
		if (group) group.push(entry);
		else byLicense.set(license, [entry]);
	}

	return [...byLicense.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([license, packages]) => ({ license, packages }));
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		__APP_VERSION__: JSON.stringify(appPkg.version),
		__DUCKDB_WASM_VERSION__: JSON.stringify(duckdbPkg.version),
		__THIRD_PARTY_LICENSES__: JSON.stringify(collectThirdPartyLicenses())
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
