<script lang="ts">
import {
	autocompletion,
	type CompletionContext,
	type CompletionResult,
	closeBrackets,
	closeBracketsKeymap
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StandardSQL, sql } from '@codemirror/lang-sql';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import {
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
	placeholder as placeholderExt
} from '@codemirror/view';
import { onMount, untrack } from 'svelte';
import { settings } from '$lib/stores/settings.svelte.js';

let {
	value = '',
	onExecute,
	onChange,
	placeholder = 'Enter SQL query...',
	readonly = false,
	minHeight = '60px',
	schemaColumns = [] as string[]
}: {
	value?: string;
	onExecute?: () => void;
	onChange?: (value: string) => void;
	placeholder?: string;
	readonly?: boolean;
	minHeight?: string;
	schemaColumns?: string[];
} = $props();

let editorContainer: HTMLDivElement | undefined = $state();

// Use a plain variable — NOT $state — to avoid reactivity loops
let view: EditorView | undefined;
let currentTheme: 'light' | 'dark' = settings.resolved;

// SQL keywords for autocompletion
const SQL_KEYWORDS = [
	'SELECT',
	'FROM',
	'WHERE',
	'AND',
	'OR',
	'NOT',
	'IN',
	'IS',
	'NULL',
	'AS',
	'ORDER',
	'BY',
	'ASC',
	'DESC',
	'LIMIT',
	'OFFSET',
	'GROUP',
	'HAVING',
	'JOIN',
	'LEFT',
	'RIGHT',
	'INNER',
	'OUTER',
	'CROSS',
	'ON',
	'USING',
	'UNION',
	'ALL',
	'INTERSECT',
	'EXCEPT',
	'DISTINCT',
	'CASE',
	'WHEN',
	'THEN',
	'ELSE',
	'END',
	'EXISTS',
	'BETWEEN',
	'LIKE',
	'ILIKE',
	'INSERT',
	'INTO',
	'VALUES',
	'UPDATE',
	'SET',
	'DELETE',
	'CREATE',
	'TABLE',
	'VIEW',
	'INDEX',
	'DROP',
	'ALTER',
	'ADD',
	'COLUMN',
	'WITH',
	'RECURSIVE',
	'OVER',
	'PARTITION',
	'WINDOW',
	'ROWS',
	'RANGE',
	'UNBOUNDED',
	'PRECEDING',
	'FOLLOWING',
	'CURRENT',
	'ROW',
	'EXCLUDE',
	'FILTER',
	'TRUE',
	'FALSE',
	'CAST',
	'COALESCE',
	'NULLIF',
	'EXPLAIN',
	'ANALYZE',
	'PRAGMA',
	'COPY',
	'EXPORT',
	'IMPORT'
];

// DuckDB functions commonly used with spatial / analytics
const DUCKDB_FUNCTIONS = [
	'COUNT',
	'SUM',
	'AVG',
	'MIN',
	'MAX',
	'FIRST',
	'LAST',
	'LIST',
	'STRING_AGG',
	'ROW_NUMBER',
	'RANK',
	'DENSE_RANK',
	'LAG',
	'LEAD',
	'NTILE',
	'LENGTH',
	'LOWER',
	'UPPER',
	'TRIM',
	'LTRIM',
	'RTRIM',
	'REPLACE',
	'SUBSTRING',
	'CONCAT',
	'STARTS_WITH',
	'ENDS_WITH',
	'CONTAINS',
	'REGEXP_MATCHES',
	'STRFTIME',
	'DATE_PART',
	'DATE_TRUNC',
	'NOW',
	'CURRENT_DATE',
	'CURRENT_TIMESTAMP',
	'ABS',
	'CEIL',
	'FLOOR',
	'ROUND',
	'POWER',
	'SQRT',
	'LOG',
	'LN',
	'MOD',
	'ARRAY_AGG',
	'UNNEST',
	'GENERATE_SERIES',
	'RANGE',
	'JSON_EXTRACT',
	'JSON_EXTRACT_STRING',
	'JSON_TYPE',
	'READ_PARQUET',
	'READ_CSV',
	'READ_JSON',
	'READ_CSV_AUTO',
	'ST_POINT',
	'ST_GEOMFROMWKB',
	'ST_GEOMFROMGEOJSON',
	'ST_GEOMFROMTEXT',
	'ST_ASWKB',
	'ST_ASTEXT',
	'ST_ASGEOJSON',
	'ST_TRANSFORM',
	'ST_AREA',
	'ST_LENGTH',
	'ST_DISTANCE',
	'ST_CENTROID',
	'ST_BUFFER',
	'ST_INTERSECTS',
	'ST_CONTAINS',
	'ST_WITHIN',
	'ST_INTERSECTION',
	'ST_UNION',
	'ST_ENVELOPE',
	'ST_X',
	'ST_Y',
	'ST_SRID',
	'TYPEOF',
	'TRY_CAST',
	'IF',
	'IFN',
	'GREATEST',
	'LEAST',
	'LIST_AGGREGATE',
	'LIST_SORT',
	'LIST_DISTINCT',
	'LIST_CONTAINS'
];

function sqlCompletions(context: CompletionContext): CompletionResult | null {
	const word = context.matchBefore(/[\w.]*/);
	if (!word || (word.from === word.to && !context.explicit)) return null;

	const input = word.text.toLowerCase();
	const options: { label: string; type: string; boost?: number }[] = [];

	// Column completions get highest priority
	for (const col of schemaColumns) {
		if (col.toLowerCase().startsWith(input)) {
			options.push({ label: col, type: 'property', boost: 2 });
		}
	}

	// SQL keywords
	for (const kw of SQL_KEYWORDS) {
		if (kw.toLowerCase().startsWith(input)) {
			options.push({ label: kw, type: 'keyword', boost: 1 });
		}
	}

	// DuckDB functions
	for (const fn of DUCKDB_FUNCTIONS) {
		if (fn.toLowerCase().startsWith(input)) {
			options.push({ label: fn, type: 'function', boost: 0 });
		}
	}

	if (options.length === 0) return null;
	return { from: word.from, options };
}

function createExtensions() {
	const dark = settings.resolved === 'dark';
	const exts = [
		lineNumbers(),
		EditorView.lineWrapping,
		highlightActiveLine(),
		highlightActiveLineGutter(),
		history(),
		bracketMatching(),
		closeBrackets(),
		syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
		sql({ dialect: StandardSQL }),
		autocompletion({
			override: [sqlCompletions],
			defaultKeymap: true,
			icons: true
		}),
		placeholderExt(placeholder),
		keymap.of([
			{
				key: 'Mod-Enter',
				run: () => {
					onExecute?.();
					return true;
				}
			},
			...closeBracketsKeymap,
			...defaultKeymap,
			...historyKeymap
		]),
		EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				onChange?.(update.state.doc.toString());
			}
		}),
		EditorView.theme({
			'&': { minHeight, maxHeight: '40vh' },
			'.cm-scroller': { overflow: 'auto', minHeight },
			'.cm-content': {
				fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
				fontSize: '12px',
				minHeight
			},
			'.cm-gutters': { fontSize: '11px', minHeight }
		}),
		EditorState.readOnly.of(readonly)
	];

	if (dark) {
		exts.push(oneDark);
	}

	return exts;
}

function createView(doc: string) {
	if (!editorContainer) return;
	view?.destroy();
	view = undefined;
	try {
		view = new EditorView({
			state: EditorState.create({
				doc,
				extensions: createExtensions()
			}),
			parent: editorContainer
		});
		currentTheme = settings.resolved;
	} catch (err) {
		console.warn('[CodeMirrorEditor] Failed to create editor:', err);
		// Retry once with minimal extensions (handles stale module instances during HMR)
		try {
			view = new EditorView({
				state: EditorState.create({
					doc,
					extensions: [
						EditorView.updateListener.of((update) => {
							if (update.docChanged) {
								onChange?.(update.state.doc.toString());
							}
						}),
						EditorView.theme({
							'&': { minHeight, maxHeight: '200px' },
							'.cm-scroller': { overflow: 'auto', minHeight },
							'.cm-content': {
								fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
								fontSize: '12px',
								minHeight
							}
						}),
						placeholderExt(placeholder)
					]
				}),
				parent: editorContainer
			});
		} catch {
			// Give up — the editor won't render but the app shouldn't crash
		}
	}
}

onMount(() => {
	createView(value);
	return () => {
		view?.destroy();
		view = undefined;
	};
});

// Sync external value changes into editor
$effect(() => {
	const v = value;
	untrack(() => {
		if (view && v !== view.state.doc.toString()) {
			view.dispatch({
				changes: {
					from: 0,
					to: view.state.doc.length,
					insert: v
				}
			});
		}
	});
});

// Recreate editor when theme changes
$effect(() => {
	const newTheme = settings.resolved;
	untrack(() => {
		if (view && editorContainer && newTheme !== currentTheme) {
			const currentDoc = view.state.doc.toString();
			createView(currentDoc);
		}
	});
});
</script>

<div bind:this={editorContainer} dir="ltr" class="codemirror-wrapper resize-y overflow-hidden rounded border border-zinc-200 dark:border-zinc-700"></div>

<style>
	.codemirror-wrapper :global(.cm-editor) {
		outline: none;
	}
	.codemirror-wrapper :global(.cm-editor.cm-focused) {
		outline: none;
	}
	/* Autocomplete tooltip */
	.codemirror-wrapper :global(.cm-tooltip-autocomplete) {
		max-width: min(90vw, 300px);
	}
</style>
