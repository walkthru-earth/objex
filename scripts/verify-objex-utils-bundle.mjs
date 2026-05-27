#!/usr/bin/env node
// Build-time guardrail for @walkthru-earth/objex-utils.
//
// Scans the tsup output in packages/objex-utils/dist for top-level imports of
// heavy dependencies that must never appear in the published bundle. See
// walkthru-earth/objex#11 and packages/objex-utils/CLAUDE.md.
//
// The rule is stricter than tsup's `external`. Marking a heavy dep external
// does not protect consumers, tsup still emits a bare `import` for it, which
// Vite's import-analysis tries to pre-bundle at consumer dev-server start and
// fails with `Failed to resolve import "<dep>" from the pre-bundled
// objex-utils chunk`. The only safe move is to keep the dep entirely out of
// the static import graph (use a `*-pure.ts` sibling, or lazy `await import()`
// inside the function that needs it).
//
// Allowed top-level bare imports: relative paths, node: scheme, and the four
// declared peer-deps (apache-arrow, hyparquet, hyparquet-compressors, yaml).
// Anything else triggers a failure.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(HERE, '..', 'packages', 'objex-utils', 'dist');

const ALLOWED_PEERS = new Set([
	'apache-arrow',
	'hyparquet',
	'hyparquet-compressors',
	'yaml'
]);

const FORBIDDEN_PATTERNS = [
	/^@developmentseed\//,
	/^proj4(?:$|\/)/,
	/^wkt-parser(?:$|\/)/,
	/^maplibre-gl(?:$|\/)/,
	/^@luma\.gl\//,
	/^@deck\.gl\//,
	/^deck\.gl(?:$|\/)/,
	/^@geoarrow\//,
	/^pdfjs-dist(?:$|\/)/,
	/^shiki(?:$|\/)/,
	/^@babylonjs\//,
	/^zarrita(?:$|\/)/,
	/^@zarrita\//,
	/^pmtiles(?:$|\/)/,
	/^flatgeobuf(?:$|\/)/,
	/^@zip\.js\//,
	/^@cogeotiff\//,
	/^@carbonplan\//,
	/^chart\.js(?:$|\/)/,
	/^marked(?:$|\/)/,
	/^mermaid(?:$|\/)/,
	/^@milkdown\//,
	/^@codemirror\//,
	/^ansi_up(?:$|\/)/,
	/^@mapbox\//,
	/^@chunkd\//,
	/^aws4fetch(?:$|\/)/,
	/^sql-formatter(?:$|\/)/,
	/^lz-string(?:$|\/)/,
	/^pbf(?:$|\/)/,
	/^@duckdb\//
];

const IMPORT_RE = /(from\s+|require\(|import\()['"]([^'"]+)['"]/g;
// Catches bare side-effect imports (`import "pkg";`) that IMPORT_RE misses.
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s+['"]([^'"]+)['"]/gm;

async function listBundleFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter((e) => e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.cjs')))
		.map((e) => join(dir, e.name));
}

function isForbidden(spec) {
	return FORBIDDEN_PATTERNS.some((p) => p.test(spec));
}

function lineNumber(text, idx) {
	let n = 1;
	for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
	return n;
}

async function scanFile(path) {
	const text = await readFile(path, 'utf8');
	const errors = [];
	IMPORT_RE.lastIndex = 0;
	let m;
	while ((m = IMPORT_RE.exec(text))) {
		const kind = m[1];
		const spec = m[2];
		const isDynamic = kind.startsWith('import(');
		if (isDynamic) continue;
		if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:')) continue;
		if (ALLOWED_PEERS.has(spec) || [...ALLOWED_PEERS].some((p) => spec.startsWith(`${p}/`))) {
			continue;
		}
		if (isForbidden(spec)) {
			const ln = lineNumber(text, m.index);
			errors.push({ path, line: ln, spec, kind: kind.trim() });
		} else {
			const ln = lineNumber(text, m.index);
			errors.push({
				path,
				line: ln,
				spec,
				kind: kind.trim(),
				note: 'unknown bare specifier, add to ALLOWED_PEERS if intended'
			});
		}
	}
	SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
	let se;
	while ((se = SIDE_EFFECT_IMPORT_RE.exec(text))) {
		const spec = se[1];
		if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('node:')) continue;
		if (ALLOWED_PEERS.has(spec) || [...ALLOWED_PEERS].some((p) => spec.startsWith(`${p}/`))) {
			continue;
		}
		if (isForbidden(spec)) {
			const ln = lineNumber(text, se.index);
			errors.push({ path, line: ln, spec, kind: 'import' });
		} else {
			const ln = lineNumber(text, se.index);
			errors.push({
				path,
				line: ln,
				spec,
				kind: 'import',
				note: 'unknown bare specifier, add to ALLOWED_PEERS if intended'
			});
		}
	}
	return errors;
}

async function main() {
	let files;
	try {
		files = await listBundleFiles(DIST);
	} catch (err) {
		console.error(`verify-objex-utils-bundle: cannot read ${DIST}: ${err.message}`);
		console.error('Did tsup run? Try: pnpm --filter @walkthru-earth/objex-utils run build');
		process.exit(1);
	}
	const allErrors = [];
	for (const f of files) allErrors.push(...(await scanFile(f)));
	const hardFails = allErrors.filter((e) => !e.note);
	const warnings = allErrors.filter((e) => e.note);

	if (warnings.length) {
		console.warn('verify-objex-utils-bundle: unknown bare specifiers (review):');
		for (const w of warnings) {
			console.warn(`  ${w.path}:${w.line}  ${w.kind} '${w.spec}'  ${w.note}`);
		}
	}
	if (hardFails.length) {
		console.error('');
		console.error('verify-objex-utils-bundle: FORBIDDEN top-level imports in dist/');
		console.error('(see walkthru-earth/objex#11; packages/objex-utils/CLAUDE.md)');
		console.error('');
		for (const e of hardFails) {
			console.error(`  ${e.path}:${e.line}  ${e.kind} '${e.spec}'`);
		}
		console.error('');
		console.error('Fix: move the affected module to a `*-pure.ts` sibling, or');
		console.error('     load the dep lazily via `await import(...)` inside the');
		console.error('     function that needs it (see parseMarkdownDocument + yaml).');
		process.exit(1);
	}
	console.log(`verify-objex-utils-bundle: ${files.length} dist file(s) clean.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
