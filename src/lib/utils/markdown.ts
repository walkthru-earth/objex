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
