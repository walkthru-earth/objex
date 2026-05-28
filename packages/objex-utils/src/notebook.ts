/**
 * Lightweight browser-native Jupyter notebook renderer.
 * Replaces `notebookjs` which depends on jsdom/Buffer (Node.js only).
 * Handles nbformat 2, 3, 4, and 5.
 */

const PREFIX = 'nb-';

// ── Helpers ──────────────────────────────────────────────────────────────────

function el(tag: string, classNames: string[] = []): HTMLElement {
	const e = document.createElement(tag);
	if (classNames.length) e.className = classNames.map((c) => PREFIX + c).join(' ');
	return e;
}

function escapeHTML(raw: string): string {
	return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function joinText(text: string | string[]): string {
	if (Array.isArray(text)) return text.join('');
	return text ?? '';
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface NotebookConfig {
	markdown: (md: string) => string;
	ansi: (text: string) => string;
	highlighter: (code: string, lang: string) => string;
}

interface RawNotebook {
	nbformat: number;
	nbformat_minor?: number;
	metadata?: Record<string, any>;
	cells?: RawCell[];
	worksheets?: { cells: RawCell[] }[];
}

interface RawCell {
	cell_type: string;
	source?: string | string[];
	input?: string | string[];
	outputs?: RawOutput[];
	prompt_number?: number;
	execution_count?: number | null;
	level?: number;
	language?: string;
}

interface RawOutput {
	output_type: string;
	data?: Record<string, string | string[]>;
	text?: string | string[];
	stream?: string;
	name?: string;
	png?: string;
	jpeg?: string;
	svg?: string;
	html?: string;
	latex?: string;
	traceback?: string[];
	ename?: string;
	evalue?: string;
	// v3 display_data flat keys
	[key: string]: any;
}

// ── Display renderers ────────────────────────────────────────────────────────

const IMAGE_FORMATS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

function renderImage(format: string, data: string | string[]): HTMLElement {
	const img = el('img', ['image-output']);
	(img as HTMLImageElement).src = `data:${format};base64,${joinText(data).replace(/\n/g, '')}`;
	return img;
}

function renderDisplayData(output: RawOutput, config: NotebookConfig): HTMLElement {
	// Resolve data from v4 `data` field or v3 flat fields
	const getData = (mime: string): string | string[] | undefined =>
		output.data?.[mime] ?? output[mime];

	// Priority order (richest first)
	for (const fmt of IMAGE_FORMATS) {
		const d = getData(fmt);
		if (d) return renderImage(fmt, d);
	}

	const svg = getData('image/svg+xml') ?? getData('text/svg+xml');
	if (svg) {
		const wrapper = el('div', ['svg-output']);
		wrapper.innerHTML = joinText(svg);
		return wrapper;
	}

	const html = getData('text/html');
	if (html) {
		const wrapper = el('div', ['html-output']);
		wrapper.innerHTML = joinText(html);
		return wrapper;
	}

	const md = getData('text/markdown');
	if (md) {
		const wrapper = el('div', ['html-output']);
		wrapper.innerHTML = config.markdown(joinText(md));
		return wrapper;
	}

	const latex = getData('text/latex');
	if (latex) {
		const wrapper = el('div', ['latex-output']);
		wrapper.textContent = joinText(latex);
		return wrapper;
	}

	const plain = getData('text/plain');
	if (plain) {
		const pre = el('pre', ['text-output']);
		pre.innerHTML = config.ansi(escapeHTML(joinText(plain)));
		return pre;
	}

	return el('div', ['empty-output']);
}

function renderStream(output: RawOutput, config: NotebookConfig): HTMLElement {
	const streamName = output.stream ?? output.name ?? 'stdout';
	const pre = el('pre', [streamName]);
	pre.innerHTML = config.ansi(escapeHTML(joinText(output.text ?? '')));
	return pre;
}

function renderError(output: RawOutput, config: NotebookConfig): HTMLElement {
	const pre = el('pre', ['pyerr']);
	const raw = (output.traceback ?? []).join('\n');
	pre.innerHTML = config.ansi(escapeHTML(raw));
	return pre;
}

// ── Output coalescing (merge consecutive same-name streams) ──────────────────

function coalesceStreams(outputs: RawOutput[]): RawOutput[] {
	if (!outputs.length) return outputs;
	const result: RawOutput[] = [{ ...outputs[0] }];
	for (let i = 1; i < outputs.length; i++) {
		const o = outputs[i];
		const last = result[result.length - 1];
		if (
			o.output_type === 'stream' &&
			last.output_type === 'stream' &&
			(o.stream ?? o.name) === (last.stream ?? last.name)
		) {
			// Merge text
			const lastText = Array.isArray(last.text) ? last.text : [last.text ?? ''];
			const oText = Array.isArray(o.text) ? o.text : [o.text ?? ''];
			last.text = lastText.concat(oText);
		} else {
			result.push({ ...o });
		}
	}
	return result;
}

// ── Cell renderers ───────────────────────────────────────────────────────────

function renderCodeCell(cell: RawCell, lang: string, config: NotebookConfig): HTMLElement {
	const cellEl = el('div', ['cell', 'code-cell']);

	// Input
	const source = joinText(cell.source ?? cell.input ?? '');
	if (source) {
		const holder = el('div', ['input']);
		const num = cell.prompt_number ?? cell.execution_count;
		if (typeof num === 'number' && num > -1) {
			holder.setAttribute('data-prompt-number', String(num));
		}
		const pre = el('pre');
		const code = document.createElement('code');
		code.setAttribute('data-language', lang);
		code.className = `lang-${lang}`;
		code.innerHTML = config.highlighter(escapeHTML(source), lang);
		pre.appendChild(code);
		holder.appendChild(pre);
		cellEl.appendChild(holder);
	}

	// Outputs
	const rawOutputs = coalesceStreams(cell.outputs ?? []);
	for (const output of rawOutputs) {
		const outer = el('div', ['output']);
		let inner: HTMLElement;
		switch (output.output_type) {
			case 'display_data':
			case 'execute_result':
			case 'pyout':
				inner = renderDisplayData(output, config);
				break;
			case 'stream':
				inner = renderStream(output, config);
				break;
			case 'error':
			case 'pyerr':
				inner = renderError(output, config);
				break;
			default:
				inner = el('div', ['empty-output']);
		}
		outer.appendChild(inner);
		cellEl.appendChild(outer);
	}

	return cellEl;
}

function renderMarkdownCell(cell: RawCell, config: NotebookConfig): HTMLElement {
	const cellEl = el('div', ['cell', 'markdown-cell']);
	const source = joinText(cell.source ?? cell.input ?? '');
	cellEl.innerHTML = config.markdown(source);
	return cellEl;
}

function renderHeadingCell(cell: RawCell): HTMLElement {
	const level = Math.min(Math.max(cell.level ?? 1, 1), 6);
	const heading = el(`h${level}`, ['cell', 'heading-cell']);
	heading.innerHTML = escapeHTML(joinText(cell.source ?? cell.input ?? ''));
	return heading;
}

function renderRawCell(cell: RawCell): HTMLElement {
	const cellEl = el('div', ['cell', 'raw-cell']);
	cellEl.innerHTML = escapeHTML(joinText(cell.source ?? cell.input ?? ''));
	return cellEl;
}

// ── Main render function ─────────────────────────────────────────────────────

export interface NotebookMeta {
	kernelName: string;
	language: string;
	cellCount: number;
}

/**
 * Parse and render a Jupyter notebook JSON to a DOM element.
 * Returns the rendered element and metadata.
 */
export function renderNotebook(
	raw: RawNotebook,
	config: NotebookConfig
): { element: HTMLElement; meta: NotebookMeta } {
	const meta = raw.metadata ?? {};
	const lang = meta.kernelspec?.language ?? meta.language_info?.name ?? meta.language ?? 'python';
	const kernelName = meta.kernelspec?.display_name ?? meta.language_info?.name ?? '';

	// Normalize cells: v4+ has top-level `cells`, v2/v3 uses `worksheets`
	let allCells: RawCell[] = [];
	if (Array.isArray(raw.cells)) {
		allCells = raw.cells;
	} else if (Array.isArray(raw.worksheets)) {
		for (const ws of raw.worksheets) {
			if (Array.isArray(ws.cells)) allCells.push(...ws.cells);
		}
	}

	const notebook = el('div', ['notebook']);

	for (const cell of allCells) {
		let rendered: HTMLElement;
		switch (cell.cell_type) {
			case 'code':
				rendered = renderCodeCell(cell, cell.language ?? lang, config);
				break;
			case 'markdown':
				rendered = renderMarkdownCell(cell, config);
				break;
			case 'heading':
				rendered = renderHeadingCell(cell);
				break;
			case 'raw':
				rendered = renderRawCell(cell);
				break;
			default:
				rendered = renderRawCell(cell);
		}
		notebook.appendChild(rendered);
	}

	return {
		element: notebook,
		meta: { kernelName, language: lang, cellCount: allCells.length }
	};
}
