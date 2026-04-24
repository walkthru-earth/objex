# stac-geoparquet

Pure transforms and detection for the [stac-geoparquet](https://github.com/stac-utils/stac-geoparquet) format. Zero Svelte / DuckDB / deck.gl dependencies, framework-agnostic. Decoupled from any single WKB library via a caller-supplied `wkbParser`, so consumers can plug in `parseWKB` from this package, `geoarrow-wasm`, `wkx`, or anything else.

```ts
import {
  STAC_GEOPARQUET_REQUIRED_COLUMNS,
  isStacGeoparquetSchema,
  flattenStacBbox,
  resolveStacAssetHref,
  pickStacPrimaryAsset,
  stacRowToItem,
  parseWKB,
} from '@walkthru-earth/objex-utils';
```

## Types

### `StacGeoparquetSchemaColumn`

```ts
interface StacGeoparquetSchemaColumn {
  name: string;
  type?: string;
}
```

Minimal shape for a column descriptor. Works with hyparquet's leaf array, DuckDB's `DESCRIBE` rows, Arrow `Field`s, or any other source. `type` is optional because detection only keys on `name`.

### `StacBboxStruct`

```ts
interface StacBboxStruct {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}
```

Bbox in struct form, as DuckDB returns it for the recommended `bbox struct(xmin double, ymin double, xmax double, ymax double)` column.

### `StacGeoparquetRow`

```ts
type StacGeoparquetRow = Record<string, unknown>;
```

Generic row shape after DuckDB / Arrow / hyparquet decoding. Pass directly into `stacRowToItem`.

### `StacRowToItemOptions`

```ts
interface StacRowToItemOptions {
  /** WKB decoder, e.g. `parseWKB` from this package. */
  wkbParser?: (bytes: Uint8Array) => unknown;
  /** Column holding the WKB bytes. Default `"geom_wkb"`. */
  wkbColumn?: string;
  /** Column holding pre-decoded GeoJSON geometry. Default `"geometry"`. */
  geometryColumn?: string;
}
```

The default `wkbColumn` of `"geom_wkb"` matches the recommended SQL projection `ST_AsWKB(geometry) AS geom_wkb`, which avoids DuckDB's GEOMETRY type hitting Arrow's WASM serializer.

## Constants

### `STAC_GEOPARQUET_REQUIRED_COLUMNS`

```ts
const STAC_GEOPARQUET_REQUIRED_COLUMNS = [
  'stac_version',
  'type',
  'geometry',
  'assets',
] as const;
```

Columns every stac-geoparquet file MUST carry per the spec. `isStacGeoparquetSchema` checks that all four are present.

## Functions

### `isStacGeoparquetSchema(schema)`

```ts
function isStacGeoparquetSchema(
  schema: StacGeoparquetSchemaColumn[]
): boolean
```

Returns `true` when every required STAC column is present in `schema`. Type-agnostic on purpose: some pipelines know the column type (DuckDB `DESCRIBE`, Arrow `Field`), others only have the name list (hyparquet schema walk). The set of names is sufficient for routing.

**Important** when used with `readParquetMetadata`: pass `meta.topLevelColumns.map((name) => ({ name }))`, not `meta.schema`. `meta.schema` flattens struct parents away and would hide the `assets` column.

```ts
import { readParquetMetadata, isStacGeoparquetSchema } from '@walkthru-earth/objex-utils';

const meta = await readParquetMetadata(url);
const isStac = isStacGeoparquetSchema(
  meta.topLevelColumns.map((name) => ({ name }))
);
```

### `flattenStacBbox(bbox)`

```ts
function flattenStacBbox(
  bbox: StacBboxStruct | number[] | null | undefined
): [number, number, number, number] | null
```

Normalize a DuckDB `struct(xmin,ymin,xmax,ymax)` bbox to the `[minX, minY, maxX, maxY]` array shape that STAC Items and deck.gl-geotiff `MosaicLayer` expect. Pass-through for inputs that are already arrays. Returns `null` when any component is non-finite or the input is missing.

### `resolveStacAssetHref(href, baseUrl)`

```ts
function resolveStacAssetHref(href: string, baseUrl: string): string
```

Resolve a possibly-relative STAC asset href against a base URL. `./foo.tif` and `foo.tif` become absolute against `baseUrl`. URLs that already carry a scheme (`http(s)://`, `s3://`, `gs://`, …) are returned unchanged.

### `pickStacPrimaryAsset(assets, preferredKeys?)`

```ts
function pickStacPrimaryAsset(
  assets: Record<string, StacAsset> | null | undefined,
  preferredKeys?: readonly string[]
): { key: string; asset: StacAsset } | null
```

Pick the "primary" asset from a STAC Item's `assets` map. Priority order:

1. The first key listed in `preferredKeys` that exists.
2. The asset under the conventional `data` key.
3. The first asset whose `roles` array contains `'data'`.
4. The first asset.

Returns `null` when the map is empty or the input is not an object.

### `stacRowToItem(row, baseUrl, opts?)`

```ts
function stacRowToItem(
  row: StacGeoparquetRow,
  baseUrl: string,
  opts?: StacRowToItemOptions
): StacItem
```

Convert one stac-geoparquet row into a standard STAC Item JSON object. Handles:

- `assets` named-struct flattening + relative href resolution against `baseUrl`
- `bbox` struct → `[minX, minY, maxX, maxY]` array via `flattenStacBbox`
- Optional WKB geometry → GeoJSON via `opts.wkbParser`
- `datetime` → ISO string (passes through already-string values)
- Promotes `properties.*` columns (`proj:*`, `raster:*`, `eo:*`, `bands`, `datetime`) onto `item.properties`

Asset hrefs in stac-geoparquet are typically written relative to each item's original `self` URL, **not** the parquet URL. The stactools default layout places each item JSON at `{catalog_dir}/{item.id}/{item.id}.json`, so callers should compute a per-row base of `{parquet_dir}/{item.id}/` and pass that as `baseUrl`. Resolving against the bare parquet URL strips the item-id subfolder and every COG 404s.

## End-to-end example

```ts
import {
  isStacGeoparquetSchema,
  parseWKB,
  readParquetMetadata,
  stacRowToItem,
} from '@walkthru-earth/objex-utils';

const parquetUrl = 'https://example.com/catalog.parquet';

// 1. Detect — use topLevelColumns, not schema, so the `assets` struct parent is visible.
const meta = await readParquetMetadata(parquetUrl);
const isStac = isStacGeoparquetSchema(
  meta.topLevelColumns.map((name) => ({ name }))
);
if (!isStac) throw new Error('Not stac-geoparquet');

// 2. Materialize via your DuckDB / Arrow / hyparquet pipeline. Recommended SQL:
//    SELECT id, type, stac_version, assets, bbox, links, datetime,
//           ST_AsWKB(geometry) AS geom_wkb
//    FROM 'catalog.parquet'
const rows: Record<string, unknown>[] = await runYourQuery();

// 3. Build STAC Items. Per-row base = {parquet_dir}/{item.id}/.
const parquetDir = parquetUrl.replace(/[^/]*(?:\?.*)?$/, '');
const items = rows.map((row) => {
  const id = String(row.id ?? '');
  const itemBase = id ? `${parquetDir}${id}/` : parquetUrl;
  return stacRowToItem(row, itemBase, { wkbParser: parseWKB });
});

const featureCollection = { type: 'FeatureCollection', features: items };
```

## Peer dependencies

None. The functions are pure and runtime-agnostic. The `wkbParser` option lets callers plug in any WKB decoder, including `parseWKB` from this same package.
