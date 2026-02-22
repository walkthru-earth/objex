<script lang="ts">
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { onDestroy } from 'svelte';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import { loadPdfDocument } from '$lib/utils/pdf';

let { tab }: { tab: Tab } = $props();

let canvasEl: HTMLCanvasElement | undefined = $state();
let pdfDoc: PDFDocumentProxy | null = null;
let currentPage = $state(1);
let totalPages = $state(0);
let scale = $state(1.5);
let loading = $state(true);
let error = $state<string | null>(null);

$effect(() => {
	if (!tab) return;
	loadPdf();
});

$effect(() => {
	if (!tab) return;
	if (pdfDoc && canvasEl) renderPage(currentPage);
});

async function loadPdf() {
	loading = true;
	error = null;

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		pdfDoc = await loadPdfDocument(data);
		totalPages = pdfDoc.numPages;
		currentPage = 1;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function renderPage(pageNum: number) {
	if (!pdfDoc || !canvasEl) return;

	try {
		const page = await pdfDoc.getPage(pageNum);
		const viewport = page.getViewport({ scale });
		canvasEl.width = viewport.width;
		canvasEl.height = viewport.height;

		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		await page.render({ canvasContext: ctx, viewport, canvas: canvasEl } as any).promise;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
}

function prevPage() {
	if (currentPage > 1) currentPage--;
}

function nextPage() {
	if (currentPage < totalPages) currentPage++;
}

function zoomIn() {
	scale = Math.min(scale + 0.25, 5);
	renderPage(currentPage);
}

function zoomOut() {
	scale = Math.max(scale - 0.25, 0.5);
	renderPage(currentPage);
}

onDestroy(() => {
	pdfDoc?.destroy();
});
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
	>
		<span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{tab.name}</span>
		<span
			class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
		>
			PDF
		</span>

		{#if totalPages > 0}
			<div class="ml-auto flex items-center gap-2">
				<button
					class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
					onclick={prevPage}
					disabled={currentPage <= 1}
				>
					Prev
				</button>
				<span class="text-xs text-zinc-500 dark:text-zinc-400">
					{currentPage} / {totalPages}
				</span>
				<button
					class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
					onclick={nextPage}
					disabled={currentPage >= totalPages}
				>
					Next
				</button>
				<span class="mx-1 text-zinc-300 dark:text-zinc-700">|</span>
				<button
					class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
					onclick={zoomOut}
				>
					-
				</button>
				<span class="text-xs text-zinc-500 dark:text-zinc-400">
					{Math.round(scale * 100)}%
				</span>
				<button
					class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
					onclick={zoomIn}
				>
					+
				</button>
			</div>
		{/if}
	</div>

	<div class="flex flex-1 items-start justify-center overflow-auto bg-zinc-200 p-4 dark:bg-zinc-800">
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-zinc-400">Loading PDF...</p>
			</div>
		{:else if error}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else}
			<canvas bind:this={canvasEl} class="shadow-lg"></canvas>
		{/if}
	</div>
</div>
