---
'@walkthru-earth/objex': minor
---

Canonical connection identity and deduplication across every write path.

- New `utils/connection-identity.ts` (exported from `src/lib/index.ts`): `connectionIdentityKey`, `isSameConnectionIdentity`, `normalizeEndpoint`, `normalizeProvider`, `ConnectionIdentityInput`. Identity is provider-aware: `azure` → `provider|endpoint|bucket`, `gcs` → `provider|bucket` (global namespace), `s3` with empty endpoint → `s3|bucket|region` (region is load-bearing for signing), all other S3-compatible providers → `provider|normalizedEndpoint|bucket`. `normalizeEndpoint` lowercases host, strips default ports (`:443`/`:80`) and trailing slashes, and preserves explicit non-default ports and pathnames so `http` vs `https`, `:443` vs empty, and trailing-slash drift collapse to one key.
- `connections` store: removed `findByBucketEndpoint` (bucket+endpoint string match, which produced silent duplicates for AWS same-bucket-different-region and custom S3-compat scheme/port drift, and was bypassed entirely by the manual Add Connection dialog). Every write path now dedups through `connectionIdentityKey`:
  - `save(config)` returns `{ id, existed }`. On `existed: true`, the row is reused and credentials from the new config overwrite the old ones.
  - `update(id, config)` throws the new `DuplicateConnectionError` when the new identity would collide with a different saved row, so edits can't silently produce phantom duplicates.
  - `saveHostConnection(detected)` continues to be the auto-detect entry and returns the final id, either reused or newly inserted.
  - New public `findByIdentity(input)` exposes the same key for callers that need to check without writing.
- `ConnectionDialog` surfaces both outcomes: amber "merged into existing" notice on dedup and destructive "already used by X" block on edit collision, with the offending connection's name.
- Build: svelte-check 0 errors, publint clean, no `$lib/` leaks in `dist/`.
