# File sorting

Sort a `FileEntry[]` with directories pinned on top. Pure — no mutation of the input.

Source: `src/lib/utils/file-sort.ts`.

## Types

### `SortField`

```ts
type SortField = 'name' | 'size' | 'modified' | 'extension';
```

### `SortDirection`

```ts
type SortDirection = 'asc' | 'desc';
```

### `SortConfig`

```ts
interface SortConfig {
  field: SortField;
  direction: SortDirection;
}
```

## Functions

### `sortFileEntries(entries, config)`

```ts
function sortFileEntries(entries: FileEntry[], config: SortConfig): FileEntry[]
```

Return a **new** array sorted according to `config`.

- Directories always sort before files regardless of direction.
- `name` uses locale-aware comparison.
- `size` and `modified` use numeric comparison.
- `extension` falls back to `name` when equal.
- Stable for equal keys.

### `toggleSortField(current, field)`

```ts
function toggleSortField(current: SortConfig, field: SortField): SortConfig
```

UI helper for clickable column headers:

- If `field === current.field`: flip direction.
- Otherwise: switch to `{ field, direction: 'asc' }`.

## Example

```ts
import { sortFileEntries, toggleSortField } from '@walkthru-earth/objex-utils';

let config = { field: 'modified', direction: 'desc' };
const sorted = sortFileEntries(entries, config);

// onClick a column header:
config = toggleSortField(config, 'size');
```
