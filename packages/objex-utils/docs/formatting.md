# Formatting, column types, hex, export

Display formatters, column-type classification, hex dump, and data serialization. All sync, pure, no browser APIs required unless noted.

Sources:

- `packages/objex-utils/src/format.ts`
- `packages/objex-utils/src/column-types.ts`
- `packages/objex-utils/src/hex.ts`
- `packages/objex-utils/src/export.ts`

## Formatters

### `formatFileSize(bytes)`

```ts
function formatFileSize(bytes: number): string
```

1024-based human-readable byte count. Integer for raw bytes (`'512 B'`), one decimal for everything else (`'1.5 MB'`). Returns `'0 B'` for `0`, `'-'` for negative.

### `formatDate(timestamp)`

```ts
function formatDate(timestamp: number): string
```

Format a unix timestamp **in milliseconds** as a human-readable date string.

- Recent timestamps render relative: `'just now'`, `'5m ago'`, `'2h ago'`, `'3d ago'`.
- Older render as `'YYYY-MM-DD'`.
- Missing / invalid → `'--'`.

### `formatValue(value)`

```ts
function formatValue(value: unknown): string
```

Format any value for display in tables, panels, or exports.

| Input | Output |
|-------|--------|
| `null` / `undefined` | `''` |
| `bigint` | `value.toString()` |
| `Date` | `value.toISOString()` |
| Object (incl. arrays) | `JSON.stringify(value, jsonReplacerBigInt)` |
| Everything else | `String(value)` |

### `getFileExtension(filename)`

```ts
function getFileExtension(filename: string): string
```

Return the extension **including** the leading dot (`'data.parquet' → '.parquet'`). Empty string if no extension. Case-preserving.

### `jsonReplacerBigInt(_key, value)`

```ts
function jsonReplacerBigInt(_key: string, value: unknown): unknown
```

`JSON.stringify` replacer that coerces `BigInt` to decimal strings so DuckDB `BIGINT`s don't explode serialization.

```ts
JSON.stringify(row, jsonReplacerBigInt);
```

## Column-type classification

### `TypeCategory`

```ts
type TypeCategory =
  | 'number' | 'string' | 'date' | 'boolean'
  | 'geo' | 'binary' | 'json' | 'other';
```

### `classifyType(duckdbType)`

```ts
function classifyType(duckdbType: string): TypeCategory
```

Classify a DuckDB/Arrow type string. Handles parameterized types (`DECIMAL(18,3)`, `VARCHAR(100)`), compound types (`STRUCT`, `MAP`, `LIST`), and fuzzy keyword matching as a fallback.

| Example inputs | Result |
|----------------|--------|
| `BIGINT`, `DOUBLE`, `DECIMAL(18,3)` | `'number'` |
| `VARCHAR`, `STRING`, `UTF8` | `'string'` |
| `TIMESTAMP`, `DATE`, `TIME` | `'date'` |
| `BOOLEAN` | `'boolean'` |
| `GEOMETRY`, `GEOMETRY('EPSG:27700')`, `POINT`, `WKB_BLOB` | `'geo'` |
| `BLOB`, `BINARY`, `VARBINARY` | `'binary'` |
| `STRUCT<...>`, `MAP<...>`, `LIST<...>`, `JSON` | `'json'` |
| Otherwise | `'other'` |

### `typeColor(category)`

```ts
function typeColor(category: TypeCategory): string
```

Tailwind text-color class (e.g. `'text-blue-500'`) for dots / badges.

### `typeBadgeClass(category)`

```ts
function typeBadgeClass(category: TypeCategory): string
```

Tailwind classes for a pill-style badge (background + text + border).

### `typeLabel(category)`

```ts
function typeLabel(category: TypeCategory): string
```

Short symbol (`'#'` for number, `'{}'` for json, `'geo'` for geo, etc.) for compact badges.

## Hex dump

### `HexRow`

```ts
interface HexRow {
  offset: string;     // hex offset, zero-padded (e.g. '00000000')
  hex: string[];      // per-byte hex (e.g. '48', '65')
  ascii: string;      // printable ASCII, '.' for non-printable
}
```

### `generateHexDump(data, bytesPerRow?)`

```ts
function generateHexDump(data: Uint8Array, bytesPerRow?: number): HexRow[]
```

Build a structured hex dump. `bytesPerRow` defaults to `16`. Pure — no DOM.

Rendering is left to the caller; `HexRow` maps directly to `<tr>` / CSV / JSON.

## Data export

### `escapeCsvField(value)`

```ts
function escapeCsvField(value: string): string
```

Escape a single CSV field per RFC 4180: wraps in double quotes and doubles any embedded quote **only when** the value contains `,`, `"`, `\n`, or `\r`. Otherwise returns the value unchanged.

### `serializeToCsv(columns, rows)`

```ts
function serializeToCsv(
  columns: string[],
  rows: Record<string, unknown>[]
): string
```

Pure serializer. Uses `formatValue` internally, so `bigint` / `Date` / objects round-trip correctly. Row terminator is `'\n'`.

### `serializeToJson(columns, rows)`

```ts
function serializeToJson(
  columns: string[],
  rows: Record<string, unknown>[]
): string
```

Pure. Returns pretty-printed JSON (`2`-space indent). `Date` → ISO, `BigInt` → decimal string, `null` preserved.

### `exportToCsv(columns, rows, filename)` / `exportToJson(columns, rows, filename)`

```ts
function exportToCsv(
  columns: string[],
  rows: Record<string, unknown>[],
  filename: string
): void;
function exportToJson(
  columns: string[],
  rows: Record<string, unknown>[],
  filename: string
): void;
```

Browser-only wrappers that build the blob and trigger a download via a hidden `<a>`. Throw `ReferenceError` in non-DOM environments — use the `serializeToCsv` / `serializeToJson` variants server-side.
