<script lang="ts">
import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import MinusIcon from '@lucide/svelte/icons/minus';
import PlusIcon from '@lucide/svelte/icons/plus';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { onDestroy } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { Separator } from '$lib/components/ui/separator/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import { loadPdfDocument, loadPdfFromUrl } from '$lib/utils/pdf';
import { buildHttpsUrl, canStreamDirectly } from '$lib/utils/url.js';

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
		pdfDoc = await loadPdfData();
		totalPages = pdfDoc.numPages;
		currentPage = 1;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function loadPdfData(): Promise<PDFDocumentProxy> {
	// Try streaming from URL first (range requests for progressive page rendering)
	if (canStreamDirectly(tab)) {
		try {
			return await loadPdfFromUrl(buildHttpsUrl(tab));
		} catch {
			// CORS or network error — fall through to adapter download
		}
	}
	// Fall back to full download via storage adapter
	const adapter = getAdapter(tab.source, tab.connectionId);
	const data = await adapter.read(tab.path);
	return await loadPdfDocument(data);
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
		class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
	>
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		<Badge variant="secondary">{t('pdf.badge')}</Badge>

		{#if totalPages > 0}
			<div class="ms-auto flex items-center gap-1 sm:gap-2">
				<!-- Pagination (always visible) -->
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={prevPage} disabled={currentPage <= 1}>
					<ChevronLeftIcon class="size-3.5" />
					<span class="hidden sm:inline">{t('pdf.prev')}</span>
				</Button>
				<span class="text-xs text-zinc-500 dark:text-zinc-400">
					{currentPage} / {totalPages}
				</span>
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={nextPage} disabled={currentPage >= totalPages}>
					<span class="hidden sm:inline">{t('pdf.next')}</span>
					<ChevronRightIcon class="size-3.5" />
				</Button>

				<!-- Zoom controls — desktop only -->
				<div class="hidden items-center gap-1 sm:flex">
					<Separator orientation="vertical" class="!h-4" />
					<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={zoomOut} title={t('pdf.zoomOut')}>
						<MinusIcon class="size-3.5" />
					</Button>
					<span class="text-xs text-zinc-500 dark:text-zinc-400">
						{Math.round(scale * 100)}%
					</span>
					<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={zoomIn} title={t('pdf.zoomIn')}>
						<PlusIcon class="size-3.5" />
					</Button>
				</div>

				<!-- Mobile overflow menu -->
				<div class="flex sm:hidden">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger class="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
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
			</div>
		{/if}
	</div>

	<div class="flex flex-1 items-start justify-center overflow-auto bg-zinc-200 p-4 dark:bg-zinc-800">
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-zinc-400">{t('pdf.loading')}</p>
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
