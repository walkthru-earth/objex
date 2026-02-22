<script lang="ts">
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
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

function buildCompletions() {
	if (schemaColumns.length === 0) return [];
	return schemaColumns.map((col) => ({
		label: col,
		type: 'property' as const
	}));
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
			override:
				schemaColumns.length > 0
					? [
							(context) => {
								const word = context.matchBefore(/\w*/);
								if (!word || (word.from === word.to && !context.explicit)) return null;
								return {
									from: word.from,
									options: buildCompletions()
								};
							}
						]
					: undefined
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
			'&': { minHeight, maxHeight: '200px' },
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

<div bind:this={editorContainer} dir="ltr" class="codemirror-wrapper overflow-hidden rounded border border-zinc-200 dark:border-zinc-700"></div>

<style>
	.codemirror-wrapper :global(.cm-editor) {
		outline: none;
	}
	.codemirror-wrapper :global(.cm-editor.cm-focused) {
		outline: none;
	}
</style>
