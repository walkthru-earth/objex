import type { PDFDocumentProxy } from 'pdfjs-dist';

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

/** Load a PDF from an in-memory buffer. */
export async function loadPdfDocument(data: Uint8Array): Promise<PDFDocumentProxy> {
	const pdfjs = await getPdfjs();
	const loadingTask = pdfjs.getDocument({ data });
	return loadingTask.promise;
}

/**
 * Load a PDF from a URL using HTTP range requests (progressive page rendering).
 * PDF.js fetches only the bytes needed for the requested page — no full download.
 * Requires CORS headers on the server (S3/Azure/GCS support this).
 */
export async function loadPdfFromUrl(url: string): Promise<PDFDocumentProxy> {
	const pdfjs = await getPdfjs();
	const loadingTask = pdfjs.getDocument({
		url,
		disableRange: false,
		disableStream: false,
		disableAutoFetch: true
	});
	return loadingTask.promise;
}
