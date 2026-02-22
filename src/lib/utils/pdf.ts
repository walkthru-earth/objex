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

export async function loadPdfDocument(data: Uint8Array): Promise<PDFDocumentProxy> {
	const pdfjs = await getPdfjs();
	const loadingTask = pdfjs.getDocument({ data });
	return loadingTask.promise;
}
