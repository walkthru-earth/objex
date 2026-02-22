<script lang="ts">
import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import MinusIcon from '@lucide/svelte/icons/minus';
import PlusIcon from '@lucide/svelte/icons/plus';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { onDestroy, untrack } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { Separator } from '$lib/components/ui/separator/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import { loadPdfDocument, loadPdfFromUrl } from '$lib/utils/pdf';
import { buildHttpsUrl, canStreamDirectly } from '$lib/utils/url.js';

const LOAD_TIMEOUT_MS = 20_000;

let { tab }: { tab: Tab } = $props();

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
	loading = true;
	error = null;
	cancelActiveTask();
	pdfDoc?.destroy();
	pdfDoc = null;

	try {
		const doc = await loadPdfData();
		pdfDoc = doc;
		totalPages = doc.numPages;
		currentPage = 1;
	} catch (err: any) {
		// Ignore cancellation errors (destroyed loading task)
		if (err?.name === 'PasswordException' || err?.message?.includes('destroy')) return;
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function loadPdfData(): Promise<PDFDocumentProxy> {
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
	const data = await adapter.read(tab.path);
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
			error = err instanceof Error ? err.message : String(err);
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

onDestroy(() => {
	cancelActiveTask();
	pdfDoc?.destroy();
});
</script>

<div class="flex h-full flex-col">
  <div
    class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
  >
    <span
      class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300"
      >{tab.name}</span
    >
    <Badge variant="secondary">{t("pdf.badge")}</Badge>

    {#if totalPages > 0}
      <div class="ms-auto flex items-center gap-1 sm:gap-2">
        <!-- Pagination (always visible) -->
        <Button
          variant="ghost"
          size="sm"
          class="h-7 px-1.5"
          onclick={prevPage}
          disabled={currentPage <= 1}
        >
          <ChevronLeftIcon class="size-3.5" />
          <span class="hidden sm:inline">{t("pdf.prev")}</span>
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
          <span class="hidden sm:inline">{t("pdf.next")}</span>
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
            title={t("pdf.zoomOut")}
          >
            <MinusIcon class="size-3.5" />
          </Button>
          <span class="text-xs text-zinc-500 dark:text-zinc-400">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-1.5"
            onclick={zoomIn}
            title={t("pdf.zoomIn")}
          >
            <PlusIcon class="size-3.5" />
          </Button>
        </div>

        <!-- Mobile overflow menu -->
        <div class="flex sm:hidden">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <EllipsisVerticalIcon class="size-4" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="w-44">
              <DropdownMenu.Item onclick={zoomIn}>
                {t("pdf.zoomIn")}
              </DropdownMenu.Item>
              <DropdownMenu.Item onclick={zoomOut}>
                {t("pdf.zoomOut")}
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item disabled>
                {t("pdf.zoom")}: {Math.round(scale * 100)}%
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>
    {/if}
  </div>

  <div
    class="flex flex-1 items-start justify-center overflow-auto bg-zinc-200 p-4 dark:bg-zinc-800"
  >
    {#if loading}
      <div class="flex h-full items-center justify-center">
        <p class="text-sm text-zinc-400">{t("pdf.loading")}</p>
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
