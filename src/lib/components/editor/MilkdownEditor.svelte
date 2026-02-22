<script lang="ts">
import { defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { nord } from '@milkdown/theme-nord';
import '@milkdown/theme-nord/style.css';
import { onDestroy } from 'svelte';

let {
	initialValue = '',
	onSave,
	onChange
}: {
	initialValue?: string;
	onSave?: (markdown: string) => void;
	onChange?: (markdown: string) => void;
} = $props();

let editorEl: HTMLDivElement | undefined = $state();
let editor: Editor | null = null;
// svelte-ignore state_referenced_locally
let currentValue = $state(initialValue);

$effect(() => {
	if (editorEl) initEditor();
});

async function initEditor() {
	if (!editorEl || editor) return;

	editor = await Editor.make()
		.config((ctx) => {
			ctx.set(rootCtx, editorEl!);
			ctx.set(defaultValueCtx, initialValue);

			ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
				currentValue = markdown;
				onChange?.(markdown);
			});
		})
		.config(nord)
		.use(commonmark)
		.use(gfm)
		.use(history)
		.use(listener)
		.create();
}

function handleKeydown(e: KeyboardEvent) {
	if ((e.ctrlKey || e.metaKey) && e.key === 's') {
		e.preventDefault();
		onSave?.(currentValue);
	}
}

onDestroy(() => {
	editor?.destroy();
	editor = null;
});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	dir="ltr"
	class="milkdown-wrapper h-full overflow-auto"
	bind:this={editorEl}
	onkeydown={handleKeydown}
></div>

<style>
	.milkdown-wrapper :global(.milkdown) {
		padding: 1.5rem;
		min-height: 100%;
	}

	.milkdown-wrapper :global(.milkdown .editor) {
		outline: none;
	}

	.milkdown-wrapper :global(.milkdown p) {
		margin: 0.5em 0;
	}

	.milkdown-wrapper :global(.milkdown pre) {
		background: #1e1e2e;
		border-radius: 0.375rem;
		padding: 0.75rem;
		font-size: 0.8125rem;
		overflow-x: auto;
	}

	.milkdown-wrapper :global(.milkdown code) {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}
</style>
