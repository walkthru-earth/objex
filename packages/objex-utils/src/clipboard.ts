import { COPY_FEEDBACK_MS } from '../../../src/lib/constants.js';

/**
 * Copy text to clipboard and run a feedback callback for COPY_FEEDBACK_MS.
 * Silently catches clipboard errors (e.g. insecure context).
 *
 * @returns true if copy succeeded, false otherwise.
 */
export async function copyToClipboard(
	text: string,
	onFeedback?: (copied: boolean) => void
): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		onFeedback?.(true);
		setTimeout(() => onFeedback?.(false), COPY_FEEDBACK_MS);
		return true;
	} catch {
		return false;
	}
}

/**
 * Wire click-to-copy on all elements matching `selector` inside `root`.
 * Each element must have `data-code` (URI-encoded) with the text to copy.
 * Adds/removes a `copied` CSS class for visual feedback.
 */
export function wireCodeCopyButtons(root: Element, selector: string): void {
	for (const btn of root.querySelectorAll(selector)) {
		btn.addEventListener('click', async () => {
			const code = decodeURIComponent((btn as HTMLElement).dataset.code ?? '');
			try {
				await navigator.clipboard.writeText(code);
				btn.classList.add('copied');
				setTimeout(() => btn.classList.remove('copied'), COPY_FEEDBACK_MS);
			} catch {
				// clipboard not available
			}
		});
	}
}
