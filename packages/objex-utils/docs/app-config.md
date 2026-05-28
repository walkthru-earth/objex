# App config

Runtime configuration schema and precedence resolver for objex self-hosting (a bundled `config.json`, an optional `?config=<url>` remote override, and an in-app settings panel).

Source: `packages/objex-utils/src/app-config.ts`.

## Types

### `BasemapConfig`

```ts
interface BasemapConfig {
  id: string;
  label: string;
  type: 'vector' | 'raster';
  url: string;
  variant?: 'light' | 'dark';
}
```

A basemap option a host can offer. `variant` tags the basemap as suited to a light or dark theme, used by [`resolveBasemap`](#resolvebasemapconfig-variant-userid) to match the active theme. Consumed in Phase 2.

### `ConnectionSeed`

```ts
interface ConnectionSeed {
  name: string;
  provider: string;
  bucket: string;
  region?: string;
  endpoint?: string;
  anonymous?: boolean;
  authMethod?: 'sigv4' | 'sas-token';
  rootPrefix?: string;
}
```

A preloaded connection definition baked into the config. **Never carries secrets**, it describes where data lives, not how to authenticate. Consumed in Phase 2.

### `AppConfigDefaults`

```ts
interface AppConfigDefaults {
  theme: Theme;
  locale: string;
  featureLimit: number;
  mosaicItemLimit: number;
}
```

Default app behaviour. `theme` is the shared [`Theme`](./types-constants.md#theme) union (`'light' | 'dark' | 'system'`). `featureLimit` caps rows pulled into a map layer, `mosaicItemLimit` caps STAC mosaic items.

### `AppConfigUi`

```ts
interface AppConfigUi {
  showConnectionRail: boolean;
  showFileTree: boolean;
  showSettings: boolean;
}
```

Chrome visibility toggles for embedding objex with a trimmed UI.

### `AppConfig`

```ts
interface AppConfig {
  defaults: AppConfigDefaults;
  ui: AppConfigUi;
  basemaps: BasemapConfig[];
  defaultBasemap: { light?: string; dark?: string };
  connections: ConnectionSeed[];
}
```

The full resolved configuration. `defaultBasemap.light` / `defaultBasemap.dark` reference a `BasemapConfig.id` to pick the preferred basemap per theme variant.

## Functions

### `DEFAULT_APP_CONFIG`

```ts
const DEFAULT_APP_CONFIG: AppConfig;
```

The hardcoded fallback, matching the app's behaviour when no config is present:

```ts
{
  defaults: { theme: 'system', locale: 'en', featureLimit: 1000, mosaicItemLimit: 2000 },
  ui: { showConnectionRail: true, showFileTree: true, showSettings: true },
  basemaps: [],
  defaultBasemap: {},
  connections: []
}
```

Use this as the `base` argument to [`mergeAppConfig`](#mergeappconfigbase-override) when no bundled config exists.

### `mergeAppConfig(base, override)`

```ts
function mergeAppConfig(base: AppConfig, override: unknown): AppConfig
```

Merge an untrusted JSON value over a base config, field by field. Returns a fully populated `AppConfig`. Behaviour:

- When `override` is not a plain object (null, array, primitive), `base` is returned unchanged.
- Unknown fields are ignored.
- Each scalar runs through its `coerce*` validator. A malformed value (wrong type, blank string, non-positive int) falls back to the matching `base` value.
- `basemaps` and `connections` are filtered: each entry is validated and well-formed entries are kept. A basemap is dropped unless it has a non-blank `id`, `label`, `url`, and a `type` of `'vector'` or `'raster'`. A connection is dropped unless it has a non-blank `name` and `bucket`; its `provider` defaults to `'s3'` when blank. When the field is not an array at all, the whole `base` list is kept.
- Never reads secrets.

### `resolveSetting<T>(...candidates)`

```ts
function resolveSetting<T>(...candidates: (T | null | undefined)[]): T | undefined
```

Returns the first candidate that is neither `null` nor `undefined`, or `undefined` when all are. This encodes objex's settings precedence chain, list candidates highest priority first:

```
query-param  >  user override  >  config value  >  hardcoded fallback
```

Because the test is strict (`!== null && !== undefined`), falsy-but-valid values such as `0`, `''`, and `false` are treated as present and win over later candidates. Pre-validate user-supplied strings with the `coerce*` helpers so an invalid value collapses to `undefined` and the chain falls through.

### `parseVisibilityParam(value)`

```ts
function parseVisibilityParam(value: string | null): boolean | undefined
```

Maps the `?rail` / `?tree` visibility query param to a boolean. `'hide'` returns `false`, `'show'` returns `true`, anything else (including `null`) returns `undefined`. The `undefined` case is designed to slot in as the top candidate of [`resolveSetting`](#resolvesettingtcandidates), so an absent or invalid param defers to the config.

### `coerceTheme(v)`

```ts
function coerceTheme(v: unknown): Theme | undefined
```

Returns `v` only when it is exactly `'light'`, `'dark'`, or `'system'`, otherwise `undefined`.

### `coerceString(v)`

```ts
function coerceString(v: unknown): string | undefined
```

Returns the trimmed string when `v` is a string with non-whitespace content, otherwise `undefined`. Note the return value is trimmed, leading/trailing whitespace is stripped.

### `coercePositiveInt(v)`

```ts
function coercePositiveInt(v: unknown): number | undefined
```

Returns `Math.floor(v)` when `v` is a finite number `>= 1`, otherwise `undefined`. Fractional inputs are floored, zero and negatives are rejected.

### `coerceBool(v)`

```ts
function coerceBool(v: unknown): boolean | undefined
```

Returns `v` only when it is a real boolean, otherwise `undefined`. Truthy/falsy strings like `'true'` are **not** coerced.

### `resolveBasemap(config, variant, userId)`

```ts
function resolveBasemap(
  config: AppConfig,
  variant: 'light' | 'dark',
  userId: string | undefined
): BasemapConfig | undefined
```

Pick the basemap a map should render. Pick order:

1. **Explicit user pick** -- the basemap whose `id` equals `userId`, but only if it still exists in the configured list (a stale `userId` from local storage is ignored).
2. **Configured default for the variant** -- the basemap whose `id` equals `config.defaultBasemap[variant]`, when present and still in the list.
3. **First basemap matching the variant** -- the first entry with `variant` equal to the requested variant.
4. **First basemap of any variant** -- `config.basemaps[0]`.

Returns `undefined` only when no basemaps are configured (`config.basemaps` is empty), signalling the caller to fall back to its own hardcoded default.

## Example

Resolving the active theme through the full precedence chain (query param over user override over config over fallback):

```ts
import {
  DEFAULT_APP_CONFIG,
  mergeAppConfig,
  resolveSetting,
  coerceTheme,
} from '@walkthru-earth/objex-utils';

// Bundled config.json merged over the hardcoded fallback.
const config = mergeAppConfig(DEFAULT_APP_CONFIG, {
  defaults: { theme: 'light', locale: 'en' },
});

const params = new URLSearchParams(location.search);
const userTheme = loadFromStorage('theme', undefined); // may be undefined

const theme = resolveSetting(
  coerceTheme(params.get('theme')), // query-param  (highest priority)
  coerceTheme(userTheme),           // user override
  config.defaults.theme,            // config value
  'system',                         // hardcoded fallback (always wins last)
);
// ?theme=dark  ->  'dark'
// no param, user picked 'light'  ->  'light'
// nothing set  ->  config.defaults.theme === 'light'
```

Picking the basemap for the active theme variant:

```ts
import { resolveBasemap } from '@walkthru-earth/objex-utils';

const config = mergeAppConfig(DEFAULT_APP_CONFIG, {
  basemaps: [
    { id: 'osm', label: 'OSM', type: 'raster', url: 'https://…', variant: 'light' },
    { id: 'dark-matter', label: 'Dark Matter', type: 'vector', url: 'https://…', variant: 'dark' },
  ],
  defaultBasemap: { dark: 'dark-matter' },
});

resolveBasemap(config, 'dark', undefined);      // -> the 'dark-matter' entry (config default)
resolveBasemap(config, 'light', undefined);     // -> the 'osm' entry (first matching variant)
resolveBasemap(config, 'dark', 'osm');          // -> the 'osm' entry (user pick wins)
resolveBasemap(config, 'dark', 'gone');         // -> 'dark-matter' (stale id ignored, default used)
resolveBasemap(DEFAULT_APP_CONFIG, 'light', undefined); // -> undefined (no basemaps configured)
```
