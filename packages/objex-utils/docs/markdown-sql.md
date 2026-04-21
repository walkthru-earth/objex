# Markdown + SQL parsing

Parse markdown documents with YAML frontmatter and Evidence-style SQL code blocks, run interpolation, and stub blocks for server-side rendering.

Source: `src/lib/utils/markdown-sql.ts`.

## Peer dependency

- `yaml >= 2` — **dynamically imported** only when frontmatter is detected. If `yaml` is not installed and the document has frontmatter, parsing silently returns `frontmatter: {}` and continues. Consumers who never call `parseMarkdownDocument` do not need `yaml` at all.

## Types

### `SqlBlock`

```ts
interface SqlBlock {
  name: string;       // block identifier from ```sql <name>
  sql: string;        // raw SQL body
  startLine: number;  // 0-indexed line index of the opening ``` fence
  endLine: number;    // 0-indexed line index of the closing ``` fence
}
```

### `ParsedMarkdownDocument`

```ts
interface ParsedMarkdownDocument {
  frontmatter: Record<string, any>;
  content: string;     // markdown with frontmatter stripped
  sqlBlocks: SqlBlock[];
}
```

## Functions

### `parseMarkdownDocument(markdown)`

```ts
async function parseMarkdownDocument(
  markdown: string
): Promise<ParsedMarkdownDocument>
```

**Async** (since v1.2). Parses:

- YAML frontmatter delimited by `---\n ... \n---\n` at the top of the file.
- SQL blocks of the form:

  ```markdown
  ```sql some_query_name
  SELECT * FROM table
  ```
  ```

  The identifier must match `/^\w[\w-]*$/`. Content is captured verbatim until the matching closing fence.

**Behavior**

- Missing or malformed frontmatter → `frontmatter = {}`.
- Missing `yaml` peer dep → `frontmatter = {}` (silent).
- No SQL blocks → `sqlBlocks = []`.

### `interpolateTemplates(text, queryResults)`

```ts
function interpolateTemplates(
  text: string,
  queryResults: Map<string, Record<string, any>[]>
): string
```

Replace references of the form `{queryName.rows[N].columnName}` in `text` with the corresponding value from `queryResults`.

- Unknown query name → leave untouched.
- Missing row or column → leave untouched.
- Non-string values are coerced via `String(value)`.

### `markSqlBlocks(content)`

```ts
function markSqlBlocks(content: string): string
```

Replace every `` ```sql <name> ... ``` `` block in `content` with `<div data-sql-block="<name>"></div>`. Useful when streaming `content` through a markdown renderer — the caller can later hydrate each placeholder with the actual query result.

## Pattern

```ts
import {
  parseMarkdownDocument,
  interpolateTemplates,
  markSqlBlocks,
} from '@walkthru-earth/objex-utils';

const parsed = await parseMarkdownDocument(rawMarkdown);

if (parsed.sqlBlocks.length) {
  const results = new Map<string, Record<string, any>[]>();
  await Promise.all(
    parsed.sqlBlocks.map(async (b) => {
      results.set(b.name, await myEngine.query(b.sql));
    })
  );

  const interpolated = interpolateTemplates(parsed.content, results);
  const withPlaceholders = markSqlBlocks(interpolated);
  // hand withPlaceholders to your markdown renderer
}
```
