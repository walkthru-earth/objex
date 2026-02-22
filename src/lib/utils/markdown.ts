import { Marked } from 'marked';
import { extensionToShikiLang, highlightCode } from './shiki';

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
 * Code blocks are rendered as placeholders and then highlighted with Shiki.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
	const marked = getMarked();
	let html = await marked.parse(markdown);

	// Post-process: highlight code blocks with Shiki
	const codeBlockRegex =
		/<pre class="shiki-pending" data-lang="([^"]*)" data-code="([^"]*)"><code>[\s\S]*?<\/code><\/pre>/g;

	const matches = [...html.matchAll(codeBlockRegex)];
	for (const match of matches) {
		const lang = match[1];
		const code = decodeURIComponent(match[2]);
		const shikiLang = lang ? (extensionToShikiLang(`.${lang}`) ?? (lang as any)) : undefined;

		try {
			const highlighted = await highlightCode(code, shikiLang);
			html = html.replace(match[0], highlighted);
		} catch {
			// If highlighting fails, keep the escaped version
		}
	}

	return html;
}

// RTL unicode ranges: Arabic, Hebrew, Arabic Supplement, Arabic Extended
const RTL_REGEX =
	/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_REGEX = /[A-Za-z]/;

/**
 * Detect whether text is primarily RTL by sampling the first 1000 characters.
 */
export function detectRTL(text: string): boolean {
	const sample = text.slice(0, 1000);
	let rtlCount = 0;
	for (const char of sample) {
		if (RTL_REGEX.test(char)) rtlCount++;
	}
	return rtlCount > 5;
}

/**
 * Check if a text segment is primarily English/Latin.
 */
function isPrimarilyEnglish(text: string): boolean {
	let latin = 0;
	let rtl = 0;
	for (const char of text) {
		if (LATIN_REGEX.test(char)) latin++;
		else if (RTL_REGEX.test(char)) rtl++;
	}
	if (latin + rtl === 0) return false;
	return latin > rtl;
}

/**
 * Post-process rendered HTML for RTL/LTR direction.
 * Code blocks always get LTR. In RTL docs, individual paragraphs/headings
 * that are primarily English get LTR direction.
 */
export function processDirection(html: string, isRTL: boolean): string {
	// Code blocks should always be LTR
	html = html.replace(/<pre(\s)/g, '<pre style="direction:ltr;text-align:left"$1');
	html = html.replace(/<pre>/g, '<pre style="direction:ltr;text-align:left">');

	if (!isRTL) return html;

	// In RTL documents, set per-element direction for mixed content
	const blockTags = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th'];
	for (const tag of blockTags) {
		const regex = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');
		html = html.replace(regex, (match, attrs: string, content: string) => {
			// Strip HTML tags to get text content for direction detection
			const textOnly = content.replace(/<[^>]+>/g, '');
			if (isPrimarilyEnglish(textOnly)) {
				return `<${tag}${attrs} dir="ltr" style="text-align:left">${content}</${tag}>`;
			}
			return match;
		});
	}

	return html;
}
