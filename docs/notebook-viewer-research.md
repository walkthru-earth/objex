# Notebook Viewer Research — marimo + ipynb

## Overview

Two notebook formats to support:
1. **marimo notebooks** — `.py` files (with marimo markers), `.md` files (with `marimo-version:`), and `.html` exports
2. **Jupyter notebooks** — `.ipynb` (JSON format)

Both can be detected from content, similar to the existing JSON kind detection in `CodeViewer`.

---

## 1. Marimo Notebooks

### File Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| Python notebook | `.py` | Standard marimo format — decorated `@app.cell` functions |
| Markdown notebook | `.md` / `.qmd` | Has `marimo-version:` in first 512 bytes |
| Static HTML export | `.html` | Pre-rendered snapshot, self-contained, not interactive |
| WASM HTML export | `.html` | Interactive, loads Pyodide from CDN at runtime |

### Detection (from marimo source code)

**For `.py` files** — check first 512 bytes for BOTH `import marimo` AND `marimo.App`:

```typescript
function isMarimoNotebook(code: string): boolean {
  const header = code.slice(0, 512);
  return header.includes('import marimo') && header.includes('marimo.App');
}
```

**For `.md` files** — check first 512 bytes for `marimo-version:`.

**Marimo `.py` file structure:**
```python
import marimo

__generated_with = "0.19.7"
app = marimo.App(width="medium")

@app.cell
def _():
    import marimo as mo
    return (mo,)

@app.cell
def _(mo):
    slider = mo.ui.slider(start=1, stop=10)
    slider
    return (slider,)

if __name__ == "__main__":
    app.run()
```

### Embedding via marimo.app (WASM Playground)

**URL patterns:**

| Method | URL | Notes |
|--------|-----|-------|
| `code` query param | `https://marimo.app?code=<encodeURIComponent(code)>` | For notebooks < 14 KB |
| `#code/` hash (lz-string) | `https://marimo.app#code/<lz-string-compressed>` | For larger notebooks |
| GitHub URL | `https://marimo.app/github.com/{owner}/{repo}/blob/{branch}/{path}` | Only works for public GitHub files |

**Display control query params:**

| Param | Values | Effect |
|-------|--------|--------|
| `embed` | `true` | Hides marimo.app header — essential for iframe |
| `mode` | `read` | Read-only, code cells locked |
| `show-chrome` | `true`/`false` | Show/hide editor controls |
| `include-code` | `false` | Exclude code display (read-only only) |
| `show-code` | `false` | Hide code by default (user can toggle) |

**iframe sandbox:**
```html
<iframe
  src="https://marimo.app?embed=true&mode=read&code=..."
  sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
  allow="fullscreen"
  class="h-full w-full border-0"
></iframe>
```

**lz-string compression (from marimo source `share.ts`):**
```typescript
import { compressToEncodedURIComponent } from 'lz-string';
const compressed = compressToEncodedURIComponent(code);
const url = `https://marimo.app?embed=true&mode=read#code/${compressed}`;
```

### Implementation Plan for objex

**Approach A — Content detection in CodeViewer (like JSON kinds):**

1. `.py` files → CodeViewer already handles them
2. After loading code, detect `isMarimoNotebook(rawCode)`
3. If detected, show a badge "marimo Notebook" + a button "Run in Playground"
4. Button toggles an iframe to `marimo.app?embed=true&mode=read#code/<lz-compressed>`
5. Exactly the same UX as the existing MapLibre Style → Maputnik toggle

**Approach B — Dedicated `NotebookViewer` component:**
- New viewer kind `'notebook'`
- Handles both marimo and ipynb
- More work, but cleaner separation

**Recommendation: Approach A** for marimo `.py` files (content detection in CodeViewer), since the pattern is identical to existing JSON kind detection. The `.py` extension already routes to `CodeViewer`.

### Dependencies

- `lz-string` — for compressing notebook code into URL hash (~5 KB)
- No other deps needed — marimo.app handles all the heavy lifting

---

## 2. Jupyter Notebooks (.ipynb)

### File Format

`.ipynb` is JSON with this structure:
```json
{
  "nbformat": 4,
  "nbformat_minor": 5,
  "metadata": { "kernelspec": {...}, "language_info": {...} },
  "cells": [
    {
      "cell_type": "markdown",
      "source": ["# Title\n", "Some text"],
      "metadata": {}
    },
    {
      "cell_type": "code",
      "source": ["import numpy as np\n", "np.random.rand(10)"],
      "execution_count": 1,
      "outputs": [
        {
          "output_type": "execute_result",
          "data": { "text/plain": "array([0.1, 0.2, ...])" },
          "execution_count": 1
        }
      ],
      "metadata": {}
    }
  ]
}
```

### Detection

```typescript
function isJupyterNotebook(obj: any): boolean {
  return typeof obj?.nbformat === 'number' && Array.isArray(obj?.cells);
}
```

Since `.ipynb` is already JSON, it could be detected the same way as other JSON kinds in CodeViewer. But a dedicated viewer is better since the rendering is complex.

### Browser-Only Rendering Libraries

| Library | Size | API | Notes |
|---------|------|-----|-------|
| **`notebookjs`** | ~15 KB | `nb.parse(json).render()` → DOM Element | Best fit. Vanilla JS, pluggable. Needs `marked` + optional `ansi_up` |
| `nbviewer.js` | Small | `nbv.render(json, el)` | Not on npm, must vendor |
| `ipynb2html` | ~200 KB | Returns HTML strings | Bundles KaTeX + highlight.js, inactive |
| `react-ipynb-renderer` | — | React component | React-only, not usable |

**Recommended: `notebookjs`**

```typescript
import nb from 'notebookjs';
import { marked } from 'marked';
import AnsiUp from 'ansi_up';

// Configure
nb.markdown = (md: string) => marked.parse(md);
nb.ansi = (text: string) => new AnsiUp().ansi_to_html(text);

// Render
const notebook = nb.parse(JSON.parse(ipynbContent));
const rendered: HTMLElement = notebook.render();
container.appendChild(rendered);
```

### iframe Option: nbviewer.jupyter.org

```
https://nbviewer.jupyter.org/url/{hostname}/{path/to/notebook.ipynb}
```

Works for publicly accessible URLs. Can be embedded as iframe. Limitation: won't work with signed/expiring cloud storage URLs.

### Rendering Capabilities

| Content | Supported | Notes |
|---------|-----------|-------|
| Markdown cells | Yes | via marked.js |
| Code cells (syntax) | Yes | via Shiki (already in project) or highlight.js |
| Text output | Yes | Plain text + ANSI colors |
| Images (PNG/SVG) | Yes | Base64 encoded in JSON |
| HTML outputs | Yes | Needs DOMPurify for safety |
| LaTeX/Math | Partial | Needs KaTeX (add-on) |
| Interactive widgets | No | Requires live kernel |
| Plotly/Bokeh HTML | Partial | Static fallback if saved |

### Implementation Plan for objex

**Option A — Extension-based routing (`.ipynb` → `NotebookViewer`):**

1. Add `.ipynb` to file-icons registry with `viewer: 'notebook'`
2. New `NotebookViewer.svelte` component
3. Fetches file, parses JSON, renders with `notebookjs`
4. Shows code cells with syntax highlighting, markdown rendered, outputs displayed

**Option B — JSON detection in CodeViewer:**

1. `.ipynb` → detected as JSON kind `'jupyter'` in CodeViewer
2. Badge "Jupyter Notebook" + button "View Notebook"
3. Toggles to rendered notebook view

**Recommendation: Option A** — `.ipynb` is a known extension and deserves its own viewer. The rendering is fundamentally different from code viewing.

### Dependencies

- `notebookjs` — core renderer
- `marked` — markdown rendering (may already be in project via MarkdownViewer)
- `ansi_up` — ANSI escape code rendering in outputs
- Optional: `dompurify` — sanitize HTML outputs

---

## 3. Summary — Implementation Roadmap

### Phase 1: Marimo (minimal effort, high impact)

1. **`lz-string`** — `pnpm add lz-string` + `@types/lz-string` (if needed)
2. **CodeViewer detection** — Add `isMarimoNotebook()` alongside existing `detectJsonKind()`
3. **Badge + button** — "marimo Notebook" badge + "Open Playground" button
4. **iframe** — `marimo.app?embed=true&mode=read#code/<compressed>`
5. **URL hash** — `#marimo` for the playground view mode

Changes: `CodeViewer.svelte` only (+ lz-string dep)

### Phase 2: Jupyter ipynb

1. **File icons** — Add `.ipynb` entry with `viewer: 'notebook'` (new ViewerKind)
2. **ViewerRouter** — Add `notebook` case with dynamic import
3. **NotebookViewer.svelte** — New component using `notebookjs`
4. **Dependencies** — `pnpm add notebookjs ansi_up` (marked already available)
5. **Scoped CSS** — Style notebook output cells, code blocks, images

Changes: `file-icons/index.ts`, `ViewerRouter.svelte`, new `NotebookViewer.svelte`

### Phase 3: Marimo HTML detection (bonus)

For `.html` files, detect if they're marimo exports:
- Static HTML: contains `<marimo-` or `data-marimo` attributes → show as rendered HTML in iframe
- WASM HTML: contains Pyodide loader → warn user it needs to be served

This is lower priority since `.html` marimo exports are less common in cloud storage.

---

## 4. Detection Summary

| File | Extension | Detection | Viewer |
|------|-----------|-----------|--------|
| marimo Python | `.py` | `import marimo` + `marimo.App` in first 512 chars | CodeViewer + marimo.app iframe toggle |
| marimo Markdown | `.md` | `marimo-version:` in first 512 chars | CodeViewer + marimo.app iframe toggle |
| Jupyter Notebook | `.ipynb` | Extension-based (JSON with `nbformat` + `cells`) | NotebookViewer (new) |
| marimo HTML | `.html` | `<marimo-` in content (Phase 3) | iframe render |

## 5. Key URLs

- marimo.app playground: `https://marimo.app`
- marimo docs (embedding): `https://docs.marimo.io/guides/publishing/embedding/`
- marimo docs (WASM): `https://docs.marimo.io/guides/wasm/`
- marimo-snippets: `https://github.com/marimo-team/marimo-snippets`
- marimo-blocks (React): `https://github.com/marimo-team/marimo-blocks`
- marimo GH Pages template: `https://github.com/marimo-team/marimo-gh-pages-template`
- notebookjs: `https://github.com/jsvine/notebookjs`
- nbviewer: `https://nbviewer.jupyter.org`
