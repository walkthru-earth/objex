# ipynb Viewer Research -- Browser-Only Rendering

## 1. ipynb File Format

An `.ipynb` file is a JSON document conforming to the **nbformat** specification (current: v4.x). The JSON schema is maintained at [jupyter/nbformat](https://github.com/jupyter/nbformat/blob/main/nbformat/v4/nbformat.v4.5.schema.json).

### Top-Level Structure

```json
{
  "nbformat": 4,
  "nbformat_minor": 5,
  "metadata": {
    "kernelspec": { "display_name": "Python 3", "language": "python", "name": "python3" },
    "language_info": { "name": "python", "version": "3.10.0" }
  },
  "cells": [ ... ]
}
```

**Required top-level keys:**
| Key | Type | Description |
|---|---|---|
| `nbformat` | integer | Major version (always `4` for current format) |
| `nbformat_minor` | integer | Minor version (0-5 as of 2026) |
| `metadata` | object | Notebook-level metadata (kernelspec, language_info, etc.) -- all fields optional |
| `cells` | array | Ordered list of cell objects |

### Detection Heuristic

To identify an `.ipynb` file from parsed JSON:

```typescript
function isIpynb(json: unknown): boolean {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false;
  const obj = json as Record<string, unknown>;
  return (
    typeof obj.nbformat === 'number' &&
    obj.nbformat >= 2 &&
    Array.isArray(obj.cells || obj.worksheets) // v3 used "worksheets", v4+ uses "cells"
  );
}
```

Key signals: `nbformat` (integer >= 2) + `cells` array (v4+) or `worksheets` array (v3).

### Cell Types

```json
{
  "cell_type": "code" | "markdown" | "raw",
  "metadata": {},
  "source": ["line 1\n", "line 2\n"],
  "id": "abc123"
}
```

**Code cells** additionally have:
```json
{
  "execution_count": 5,
  "outputs": [ ... ]
}
```

**Markdown cells**: `source` contains GitHub-flavored Markdown (may include LaTeX `$...$`).

**Raw cells**: Unprocessed text; `metadata.format` hints at target format (e.g., `"text/html"`).

### Output Types

Code cell `outputs` is an array. Each output has `output_type`:

| output_type | Description | Key fields |
|---|---|---|
| `stream` | stdout/stderr text | `name` ("stdout"/"stderr"), `text` (string[]) |
| `display_data` | Rich display output | `data` (MIME dict), `metadata` |
| `execute_result` | Return value of cell | Same as display_data + `execution_count` |
| `error` | Exception traceback | `ename`, `evalue`, `traceback` (string[]) |

### The `data` MIME Dictionary

`display_data` and `execute_result` outputs contain a `data` dict keyed by MIME type:

```json
{
  "data": {
    "text/plain": "Figure(640x480)",
    "text/html": "<div>...</div>",
    "image/png": "iVBORw0KGgo...",   // base64-encoded
    "image/svg+xml": "<svg>...</svg>",
    "application/json": { ... },
    "text/latex": "$$E=mc^2$$",
    "application/vnd.jupyter.widget-view+json": { "model_id": "...", "version_major": 2 }
  },
  "metadata": {
    "image/png": { "width": 640, "height": 480 }
  }
}
```

Renderers pick the richest MIME type they can handle (preference order: widget > HTML > image > SVG > LaTeX > Markdown > plain text).

---

## 2. Browser-Only Rendering Libraries

### Option A: notebookjs (Recommended for non-React SPAs)

- **npm**: [`notebookjs`](https://www.npmjs.com/package/notebookjs) (v0.8.3)
- **GitHub**: [jsvine/notebookjs](https://github.com/jsvine/notebookjs)
- **Framework**: Vanilla JS -- returns DOM elements, no React/Vue dependency
- **Size**: Core is ~15KB unminified; BYOB (bring your own) marked + ansi_up + highlight.js
- **Last updated**: ~2023

**Usage (browser):**
```html
<script src="marked.min.js"></script>
<script src="ansi_up.min.js"></script>
<script src="notebook.js"></script>
<script>
  // Provide markdown renderer
  nb.markdown = function(text) { return marked.parse(text); };

  fetch('notebook.ipynb')
    .then(r => r.json())
    .then(ipynb => {
      const notebook = nb.parse(ipynb);
      const rendered = notebook.render();  // returns a DOM element
      document.getElementById('container').appendChild(rendered);
    });
</script>
```

**Usage (ES module / bundler):**
```typescript
import nb from 'notebookjs';
import { marked } from 'marked';
import AnsiUp from 'ansi_up';

nb.markdown = (text: string) => marked.parse(text);
nb.ansi = (text: string) => new AnsiUp().ansi_to_html(text);

const ipynb = await fetch(url).then(r => r.json());
const notebook = nb.parse(ipynb);
const rendered = notebook.render();  // HTMLElement
container.appendChild(rendered);
```

**What it renders:**
- Markdown cells (via pluggable markdown renderer)
- Code cells with syntax highlighting (if you provide highlight.js or Prism)
- Outputs: text/plain, text/html, image/png (base64), image/svg+xml, text/latex
- ANSI escape codes in outputs (via ansi_up)
- Stream outputs (stdout/stderr)
- Error tracebacks

**What it does NOT render:**
- Interactive widgets (`application/vnd.jupyter.widget-view+json`)
- Full MathJax -- only LaTeX subset via KaTeX if you add it
- Plotly/Bokeh interactive plots (static image fallback works if the notebook saved one)

**Pros for objex:**
- Vanilla JS -- works perfectly with Svelte (just mount the DOM element)
- No React dependency
- Small footprint
- Pluggable: swap markdown/syntax/ansi renderers

### Option B: nbviewer.js

- **GitHub**: [kokes/nbviewer.js](https://github.com/kokes/nbviewer.js/)
- **Demo**: [kokes.github.io/nbviewer.js/viewer.html](https://kokes.github.io/nbviewer.js/viewer.html)
- **Framework**: Vanilla JS (DOM manipulation)
- **Dependencies**: marked.js, Prism.js (bundled)
- **No npm package** -- use directly from GitHub or vendor it

**Usage:**
```javascript
// Single public method
nbv.render(ipynbJsonObject, document.getElementById('target'));
```

**Pros:**
- Dead simple API: one function call
- Privacy-friendly: no data leaves the browser
- Markdown + syntax highlighting + images built in

**Cons:**
- Not published to npm -- harder to integrate into a build system
- Less maintained than notebookjs
- No math/LaTeX rendering out of the box

### Option C: ipynb2html

- **npm**: [`ipynb2html`](https://www.npmjs.com/package/ipynb2html) (full bundle) or [`ipynb2html-core`](https://www.npmjs.com/package/ipynb2html-core) (no deps)
- **GitHub**: [jirutka/ipynb2html](https://github.com/jirutka/ipynb2html)
- **Output**: HTML string (not DOM elements)
- **Full bundle** (`ipynb2html-full.min.js`): includes marked, KaTeX, Anser, Highlight.js
- **Maintenance**: Inactive (no releases in 12+ months)

**Usage:**
```javascript
import { NbRenderer } from 'ipynb2html';

const renderer = new NbRenderer();
const htmlString = renderer.render(ipynbJson);
container.innerHTML = htmlString;
```

**Pros:**
- Returns HTML string -- easy to use with Svelte `{@html}`
- Full bundle includes KaTeX for math rendering
- Reference CSS stylesheet included

**Cons:**
- Inactive maintenance
- Full bundle is large (KaTeX + Highlight.js + marked)
- HTML string output requires careful sanitization (`{@html}` is XSS-prone)

### Option D: react-ipynb-renderer (React only)

- **npm**: [`react-ipynb-renderer`](https://www.npmjs.com/package/react-ipynb-renderer)
- **GitHub**: [righ/react-ipynb-renderer](https://github.com/righ/react-ipynb-renderer)
- **Framework**: React (not usable in Svelte without wrapper)

```jsx
import { IpynbRenderer } from "react-ipynb-renderer";
import "react-ipynb-renderer/dist/styles/monokai.css";

<IpynbRenderer ipynb={ipynbJson} syntaxTheme="xonokai" language="python" />
```

**Features:**
- Multiple themes (monokai, chesterish, solarized, grade3, oceans16)
- MathJax or KaTeX for formulas
- Handles images, HTML outputs, error tracebacks

**Not recommended for objex** -- requires React. Mentioned for completeness.

### Option E: @nteract packages (React only, heavy)

- [`@nteract/notebook-render`](https://github.com/nteract/notebook-render) -- React SSR-capable notebook renderer
- [`@nteract/outputs`](https://www.npmjs.com/package/@nteract/outputs) -- individual output type components
- [`@nteract/notebook-preview`](https://www.npmjs.com/package/@nteract/notebook-preview) -- static notebook preview

**Not recommended for objex** -- heavy React ecosystem, tightly coupled to nteract's Immutable.js data model, last published 3+ years ago.

---

## 3. iframe-Based Options (External Services)

### nbviewer.jupyter.org

The official Jupyter nbviewer service renders any publicly accessible `.ipynb` URL.

**URL format:**
```
https://nbviewer.jupyter.org/url/{hostname}/{path/to/notebook.ipynb}
```

**Examples:**
```
https://nbviewer.jupyter.org/url/example.com/data/analysis.ipynb
https://nbviewer.jupyter.org/github/{user}/{repo}/blob/{branch}/{path}.ipynb
https://nbviewer.jupyter.org/gist/{user}/{gist_id}
```

**iframe embedding:**
```html
<iframe
  src="https://nbviewer.jupyter.org/url/example.com/notebook.ipynb"
  width="100%"
  height="800px"
  style="border: none;"
></iframe>
```

**Cache control:** Append `?flush_cache=true` to force re-render.

**Pros:**
- Zero code -- just an iframe
- Full nbconvert rendering (images, math, HTML outputs)
- Handles large notebooks

**Cons:**
- Requires notebook to be publicly accessible via HTTP(S)
- External service dependency (uptime, latency)
- CORS/X-Frame-Options may block iframe embedding
- No control over styling
- Does NOT work for S3 pre-signed URLs (they expire, contain auth params)

### GitHub Rendering

GitHub natively renders `.ipynb` files in repositories. You can embed via:
```
https://github.com/{user}/{repo}/blob/{branch}/{path}.ipynb
```

But GitHub sets `X-Frame-Options: deny`, so iframe embedding does NOT work.

### Google Colab

```
https://colab.research.google.com/github/{user}/{repo}/blob/{branch}/{path}.ipynb
```

This is interactive (requires Google auth), not suitable for read-only viewing.

---

## 4. Rendering Challenges

### Images (Easy)
- Stored as base64 in `data["image/png"]` or `data["image/svg+xml"]`
- All renderers handle this well: just `<img src="data:image/png;base64,{data}">`
- Large images (>10KB base64) can bloat the notebook JSON significantly

### Math / LaTeX (Medium)
- Markdown cells often contain `$inline$` and `$$block$$` LaTeX
- Code outputs may contain `text/latex` MIME type
- Solutions: KaTeX (lighter, faster, incomplete coverage) or MathJax (heavier, more complete)
- notebookjs supports KaTeX via plugin; ipynb2html bundles KaTeX

### Interactive Plots -- Plotly, Bokeh, Altair (Medium)
- These libraries often save BOTH an interactive HTML representation AND a static PNG fallback
- `data["text/html"]` contains the interactive version (Plotly.js, Bokeh.js)
- The HTML output may reference external JS (CDN links to plotly.js etc.)
- **Static renderers show the HTML if the notebook saved it**, but interactive features may break if CDN scripts aren't loaded
- Plotly specifically stores data in `application/vnd.plotly.v1+json` -- needs Plotly.js to render

### Interactive Widgets -- ipywidgets (Hard / Impossible without kernel)
- Stored as `application/vnd.jupyter.widget-view+json` with a `model_id`
- **These fundamentally require a live kernel** to function
- Static renderers typically skip these entirely or show a placeholder
- The only solution is JupyterLite (Pyodide WASM kernel) -- overkill for a viewer

### HTML Outputs (Medium)
- `data["text/html"]` can contain arbitrary HTML including `<script>` tags
- Security concern: must sanitize with DOMPurify or similar
- Pandas DataFrames render as styled HTML tables -- works well
- Complex HTML (D3 visualizations, custom JS) may not work without their dependencies

### ANSI Escape Codes (Easy)
- Terminal-style colored output in `text/plain` outputs
- Libraries like `ansi_up` convert ANSI codes to styled HTML spans
- All major renderers support this

### Attachments (Easy)
- Markdown cells can have `attachments` dict with embedded images
- Format: `attachments: { "image.png": { "image/png": "base64..." } }`
- Referenced in markdown as `![alt](attachment:image.png)`
- Some renderers miss this -- notebookjs handles it

---

## 5. Recommendation for objex

### Best approach: `notebookjs` with Svelte wrapper

**Why:**
1. Vanilla JS -- no React dependency, integrates cleanly with Svelte
2. Returns DOM elements -- mount directly into Svelte component
3. Pluggable renderers -- use marked for Markdown, Prism/Highlight.js for syntax, ansi_up for ANSI
4. Small core -- only pull in what you need
5. Handles the common cases: markdown, code, images, HTML outputs, errors, streams

**Svelte component sketch:**

```svelte
<script lang="ts">
  import nb from 'notebookjs';
  import { marked } from 'marked';
  import AnsiUp from 'ansi_up';
  import hljs from 'highlight.js/lib/core';
  import python from 'highlight.js/lib/languages/python';

  hljs.registerLanguage('python', python);

  // Configure renderers
  nb.markdown = (text: string) => marked.parse(text);
  nb.ansi = (text: string) => new AnsiUp().ansi_to_html(text);
  nb.highlighter = (text: string, pre: HTMLPreElement, code: HTMLElement, lang: string) => {
    if (lang && hljs.getLanguage(lang)) {
      code.innerHTML = hljs.highlight(text, { language: lang }).value;
    }
  };

  interface Props {
    ipynb: Record<string, unknown>;
  }
  let { ipynb }: Props = $props();

  let container: HTMLDivElement;

  $effect(() => {
    if (container && ipynb) {
      container.innerHTML = '';
      const notebook = nb.parse(ipynb);
      const rendered = notebook.render();
      container.appendChild(rendered);
    }
  });
</script>

<div bind:this={container} class="notebook-viewer"></div>

<style>
  .notebook-viewer :global(.nb-notebook) { /* notebook styles */ }
  .notebook-viewer :global(.nb-cell) { margin-bottom: 1rem; }
  .notebook-viewer :global(.nb-code-cell .nb-input) { background: #f5f5f5; padding: 0.5rem; }
  .notebook-viewer :global(.nb-output) { padding: 0.5rem; }
  .notebook-viewer :global(.nb-cell-type-markdown) { /* markdown cell styles */ }
</style>
```

**Dependencies to add:**
```
pnpm add notebookjs marked ansi_up
pnpm add -D highlight.js    # or use Prism
```

### Alternative: ipynb2html for HTML-string approach

If you prefer `{@html}` rendering (simpler but needs sanitization):

```svelte
<script lang="ts">
  import { NbRenderer } from 'ipynb2html';
  import DOMPurify from 'dompurify';

  interface Props { ipynb: Record<string, unknown>; }
  let { ipynb }: Props = $props();

  const renderer = new NbRenderer();
  let html = $derived(DOMPurify.sanitize(renderer.render(ipynb)));
</script>

{@html html}
```

### Fallback: iframe to nbviewer

For publicly accessible notebooks, the zero-effort option:

```svelte
<script lang="ts">
  interface Props { notebookUrl: string; }
  let { notebookUrl }: Props = $props();

  // Strip protocol for nbviewer URL format
  const nbviewerUrl = $derived(
    `https://nbviewer.jupyter.org/url/${notebookUrl.replace(/^https?:\/\//, '')}`
  );
</script>

<iframe src={nbviewerUrl} title="Notebook viewer" class="w-full h-[80vh] border-0"></iframe>
```

---

## 6. Summary Table

| Approach | Framework | Bundle Size | Math | Images | Interactive Plots | Widgets | Maintenance |
|---|---|---|---|---|---|---|---|
| **notebookjs** | Vanilla JS | ~15KB + deps | KaTeX plugin | Yes (base64) | HTML fallback | No | Moderate |
| **nbviewer.js** | Vanilla JS | ~30KB bundled | No | Yes | HTML fallback | No | Low |
| **ipynb2html** | Vanilla JS | ~200KB full | KaTeX built-in | Yes | HTML fallback | No | Inactive |
| **react-ipynb-renderer** | React | ~50KB + deps | MathJax/KaTeX | Yes | HTML fallback | No | Active |
| **@nteract/** | React | Heavy (500KB+) | MathJax | Yes | Partial | Partial | Abandoned |
| **nbviewer iframe** | None | 0 | Full (server) | Yes | HTML fallback | No | Maintained |

**Recommendation**: Use `notebookjs` for the objex viewer. It matches the project's vanilla-JS-friendly Svelte 5 architecture, has the smallest footprint, and handles all common notebook outputs. Add KaTeX only if math rendering is needed.
