import { Marked } from 'marked';
import { extensionToShikiLang, highlightCodeReversed } from './shiki';

let markedInstance: Marked | null = null;

function getMarked(): Marked {
	if (markedInstance) return markedInstance;

	markedInstance = new Marked({
		async: true,
		gfm: true,
		breaks: false
	});

	markedInstance.use({
		renderer: {
			code({ text, lang }: { text: string; lang?: string }) {
				const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

				if (lang === 'mermaid') {
					return `<div class="mermaid">${escaped}</div>`;
				}

				return `<pre class="shiki-pending" data-lang="${lang || ''}" data-code="${encodeURIComponent(text)}"><code>${escaped}</code></pre>`;
			}
		}
	});

	return markedInstance;
}

/**
 * Renders markdown to HTML with GFM support.
 * Code blocks use reversed Shiki theme (dark on light, light on dark)
 * and include a copy button.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
	const marked = getMarked();
	let html = await marked.parse(markdown);

	// Post-process: highlight code blocks with Shiki (reversed theme)
	const codeBlockRegex =
		/<pre class="shiki-pending" data-lang="([^"]*)" data-code="([^"]*)"><code>[\s\S]*?<\/code><\/pre>/g;

	const matches = [...html.matchAll(codeBlockRegex)];
	for (const match of matches) {
		const lang = match[1];
		const code = decodeURIComponent(match[2]);
		const shikiLang = lang ? (extensionToShikiLang(`.${lang}`) ?? (lang as any)) : undefined;

		try {
			const highlighted = await highlightCodeReversed(code, shikiLang);
			// Wrap in a container with copy button
			const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
			const copyBtn = `<button class="code-copy-btn" data-code="${encodeURIComponent(code)}" title="Copy">${langLabel}<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
			const wrapped = `<div class="code-block-wrapper">${copyBtn}${highlighted}</div>`;
			html = html.replace(match[0], wrapped);
		} catch {
			// If highlighting fails, keep the escaped version
		}
	}

	return html;
}

// RTL unicode ranges: Arabic, Hebrew, Arabic Supplement, Arabic Extended
const RTL_CHAR_REGEX =
	/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// Arabic-Indic digits: ٠١٢٣٤٥٦٧٨٩ and Extended Arabic-Indic: ۰۱۲۳۴۵۶۷۸۹
const ARABIC_DIGIT_REGEX = /[\u0660-\u0669\u06F0-\u06F9]/;

// Western digits
const WESTERN_DIGIT_REGEX = /[0-9]/;

/**
 * Detect whether text is primarily RTL by sampling the first 1000 characters.
 */
export function detectRTL(text: string): boolean {
	const sample = text.slice(0, 1000);
	let rtlCount = 0;
	for (const char of sample) {
		if (RTL_CHAR_REGEX.test(char)) rtlCount++;
	}
	return rtlCount > 5;
}

/**
 * Determine if a text segment should be LTR.
 * - Text with Latin first strong char and more Latin than Arabic → LTR
 * - Text with only Western digits (0-9) and no Arabic chars → LTR
 * - Text with Arabic-Indic digits (٠-٩) → RTL
 * - Text with Arabic first strong char → RTL
 */
function shouldBeLTR(text: string): boolean {
	if (!text) return false;

	// Find the first strong directional character (Arabic or Latin)
	const match = text.match(/[\u0600-\u06FFa-zA-Z]/);

	if (match) {
		// Has strong directional characters
		if (/[a-zA-Z]/.test(match[0])) {
			// First strong char is Latin — confirm with count
			const arabicCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
			const englishCount = (text.match(/[a-zA-Z]/g) || []).length;
			return englishCount > arabicCount;
		}
		// First strong char is Arabic → RTL
		return false;
	}

	// No strong directional chars — check digits
	const hasWesternDigits = WESTERN_DIGIT_REGEX.test(text);
	const hasArabicDigits = ARABIC_DIGIT_REGEX.test(text);

	if (hasArabicDigits) return false; // Arabic-Indic digits → RTL
	if (hasWesternDigits) return true; // Western digits → LTR

	// No directional content at all — inherit parent direction
	return false;
}

/**
 * Post-process rendered HTML for RTL/LTR direction.
 * Uses DOM-based approach for reliable mixed content handling.
 * Code blocks always get LTR. In RTL docs, individual block elements
 * get direction based on their content language.
 * Western digits (0-9) are LTR, Arabic-Indic digits (٠-٩) are RTL.
 */
export function processDirection(html: string, isRTL: boolean): string {
	if (typeof document === 'undefined') return html;
	if (!isRTL) return html;

	const container = document.createElement('div');
	container.innerHTML = html;

	// Code blocks are always LTR
	for (const el of container.querySelectorAll('pre, code')) {
		(el as HTMLElement).style.direction = 'ltr';
		(el as HTMLElement).style.textAlign = 'left';
	}

	// Process each block element for mixed content
	for (const el of container.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th')) {
		const text = el.textContent || '';
		if (shouldBeLTR(text)) {
			(el as HTMLElement).style.direction = 'ltr';
			(el as HTMLElement).style.textAlign = 'left';

			// For lists in RTL context with LTR content, swap padding
			if (el.tagName === 'LI') {
				const parent = el.parentElement;
				if (parent && (parent.tagName === 'UL' || parent.tagName === 'OL')) {
					(parent as HTMLElement).style.paddingLeft = '2em';
					(parent as HTMLElement).style.paddingRight = '0';
				}
			}
		} else {
			// Explicitly set RTL direction on Arabic content
			(el as HTMLElement).style.direction = 'rtl';
			(el as HTMLElement).style.textAlign = 'right';
		}
	}

	return container.innerHTML;
}
