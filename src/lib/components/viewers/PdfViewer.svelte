<script lang="ts">
import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import MinusIcon from '@lucide/svelte/icons/minus';
import PlusIcon from '@lucide/svelte/icons/plus';
import { handleLoadError } from '@walkthru-earth/objex-utils';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { onDestroy, untrack } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { Separator } from '$lib/components/ui/separator/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { loadPdfDocument, loadPdfFromUrl } from '$lib/utils/pdf';
import { buildHttpsUrl, canStreamDirectly } from '$lib/utils/signed-url.js';
import ViewerHeader from './ViewerHeader.svelte';
import ViewerStatus from './ViewerStatus.svelte';

const LOAD_TIMEOUT_MS = 20_000;

let { tab }: { tab: Tab } = $props();

let abortController: AbortController | null = null;
let canvasEl: HTMLCanvasElement | undefined = $state();
let pdfDoc = $state.raw<PDFDocumentProxy | null>(null);
let currentPage = $state(1);
let totalPages = $state(0);
let scale = $state(1.5);
let loading = $state(true);
let error = $state<string | null>(null);
let renderGeneration = 0;
let activeTask: PDFDocumentLoadingTask | null = null;

$effect(() => {
	if (!tab) return;
	// untrack prevents tracking pdfDoc reads inside loadPdf (pdfDoc?.destroy())
	// — otherwise setting pdfDoc after load re-triggers this effect → infinite loop
	untrack(() => loadPdf());
});

$effect(() => {
	if (!tab) return;
	// Read all reactive deps unconditionally to ensure tracking
	const doc = pdfDoc;
	const canvas = canvasEl;
	const page = currentPage;
	const s = scale;
	if (doc && canvas) renderPage(doc, canvas, page, s);
});

function cancelActiveTask() {
	if (activeTask) {
		activeTask.destroy();
		activeTask = null;
	}
}

async function loadPdf() {
	abortController?.abort();
	abortController = new AbortController();
	const { signal } = abortController;

	loading = true;
	error = null;
	cancelActiveTask();
	pdfDoc?.destroy();
	pdfDoc = null;

	try {
		const doc = await loadPdfData(signal);
		pdfDoc = doc;
		totalPages = doc.numPages;
		currentPage = 1;
	} catch (err: any) {
		// Ignore PDF-specific cancellation errors (destroyed loading task)
		if (err?.name === 'PasswordException' || err?.message?.includes('destroy')) return;
		const msg = handleLoadError(err);
		if (msg === null) return;
		error = msg;
	} finally {
		loading = false;
	}
}

async function loadPdfData(signal: AbortSignal): Promise<PDFDocumentProxy> {
	// Try streaming from URL first (range requests for progressive page rendering)
	if (canStreamDirectly(tab)) {
		try {
			const task = await loadPdfFromUrl(buildHttpsUrl(tab));
			activeTask = task;
			return await withTimeout(task.promise, LOAD_TIMEOUT_MS);
		} catch {
			// CORS, network, or timeout error — fall through to adapter download
			cancelActiveTask();
		}
	}
	// Fall back to full download via storage adapter
	const adapter = getAdapter(tab.source, tab.connectionId);
	const data = await adapter.read(tab.path, undefined, undefined, signal);
	const task = await loadPdfDocument(data);
	activeTask = task;
	return await withTimeout(task.promise, LOAD_TIMEOUT_MS);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('PDF loading timed out')), ms)
		)
	]);
}

async function renderPage(
	doc: PDFDocumentProxy,
	canvas: HTMLCanvasElement,
	pageNum: number,
	currentScale: number
) {
	const gen = ++renderGeneration;

	try {
		const page = await doc.getPage(pageNum);
		// Stale or unmounted — skip
		if (gen !== renderGeneration || !canvasEl) return;

		const viewport = page.getViewport({ scale: currentScale });
		canvas.width = viewport.width;
		canvas.height = viewport.height;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
	} catch (err) {
		if (gen === renderGeneration) {
			error = handleLoadError(err);
		}
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
}

function zoomOut() {
	scale = Math.max(scale - 0.25, 0.5);
}

function cleanup() {
	abortController?.abort();
	abortController = null;
	cancelActiveTask();
	pdfDoc?.destroy();
	pdfDoc = null;
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);
</script>

<div class="flex h-full flex-col">
  <ViewerHeader {tab}>
    {#snippet badge()}<Badge variant="secondary">{t('pdf.badge')}</Badge>{/snippet}
    {#snippet actions()}
      {#if totalPages > 0}
        <!-- Pagination (always visible) -->
        <Button
          variant="ghost"
          size="sm"
          class="h-7 px-1.5"
          onclick={prevPage}
          disabled={currentPage <= 1}
        >
          <ChevronLeftIcon class="size-3.5" />
          <span class="hidden sm:inline">{t('pdf.prev')}</span>
        </Button>
        <span class="text-xs text-zinc-500 dark:text-zinc-400">
          {currentPage} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 px-1.5"
          onclick={nextPage}
          disabled={currentPage >= totalPages}
        >
          <span class="hidden sm:inline">{t('pdf.next')}</span>
          <ChevronRightIcon class="size-3.5" />
        </Button>

        <!-- Zoom controls — desktop only -->
        <div class="hidden items-center gap-1 sm:flex">
          <Separator orientation="vertical" class="!h-4" />
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-1.5"
            onclick={zoomOut}
            title={t('pdf.zoomOut')}
          >
            <MinusIcon class="size-3.5" />
          </Button>
          <span class="text-xs text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-1.5"
            onclick={zoomIn}
            title={t('pdf.zoomIn')}
          >
            <PlusIcon class="size-3.5" />
          </Button>
        </div>

        <!-- Mobile overflow menu -->
        <div class="flex sm:hidden">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <EllipsisVerticalIcon class="size-4" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="w-44">
              <DropdownMenu.Item onclick={zoomIn}>
                {t('pdf.zoomIn')}
              </DropdownMenu.Item>
              <DropdownMenu.Item onclick={zoomOut}>
                {t('pdf.zoomOut')}
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item disabled>
                {t('pdf.zoom')}: {Math.round(scale * 100)}%
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      {/if}
    {/snippet}
  </ViewerHeader>

  <div
    class="flex flex-1 items-start justify-center overflow-auto bg-zinc-200 p-4 dark:bg-zinc-800"
  >
    {#if loading}
      <ViewerStatus kind="loading" message={t('pdf.loading')} />
    {:else if error}
      <ViewerStatus kind="error" message={error} />
    {:else}
      <canvas bind:this={canvasEl} class="shadow-lg"></canvas>
    {/if}
  </div>
</div>
