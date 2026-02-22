import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfjs() {
	if (!pdfjsPromise) {
		pdfjsPromise = import('pdfjs-dist').then((mod) => {
			mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${mod.version}/build/pdf.worker.min.mjs`;
			return mod;
		});
	}
	return pdfjsPromise;
}

/** Load a PDF from an in-memory buffer. Returns the loading task (cancellable). */
export async function loadPdfDocument(data: Uint8Array): Promise<PDFDocumentLoadingTask> {
	const pdfjs = await getPdfjs();
	return pdfjs.getDocument({ data });
}

/**
 * Load a PDF from a URL using HTTP range requests (progressive page rendering).
 * Returns the loading task (cancellable via `.destroy()`).
 */
export async function loadPdfFromUrl(url: string): Promise<PDFDocumentLoadingTask> {
	const pdfjs = await getPdfjs();
	return pdfjs.getDocument({
		url,
		disableRange: false,
		disableStream: false,
		disableAutoFetch: true
	});
}
