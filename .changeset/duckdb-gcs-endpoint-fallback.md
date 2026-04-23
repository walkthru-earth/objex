---
'@walkthru-earth/objex': patch
---

Fix authenticated reads against S3-compatible providers (notably GCS) by handing DuckDB a SigV4-query-string-signed HTTPS URL instead of `s3://bucket/key`.

Before: `buildDuckDbUrl` returned `s3://bucket/key` for `signed-s3` connections. `configureStorage` emitted `SET s3_access_key_id/secret/region/endpoint`, and DuckDB-WASM's httpfs signed each HEAD/GET with an `Authorization: AWS4-HMAC-SHA256 ...` header. The `Authorization` header forces a CORS preflight, which is fragile on GCS — a preflight cached before bucket CORS is configured, or a `responseHeader` list that doesn't include every header the browser actually requested, makes the preflight return 200 without `Access-Control-Allow-Origin` and the browser blocks the real request.

After: a new `presignHttpsUrl(conn, key, expiresIn?)` helper (in `storage/presign.ts`) uses `aws4fetch`'s `signQuery: true` mode to build a presigned HTTPS URL with `X-Amz-Signature` in the query string. `buildDuckDbUrlAsync` (in `utils/url.ts`) and `resolveTableSourceAsync` (in `query/source.ts`) surface this to callers; `TableViewer` awaits them inside `loadTable` and re-populates the editor with the presigned query. `configureStorage` now accepts the source ref and skips all S3 SETs when the ref starts with `https://`, saving a worker round-trip and preventing spurious `SET s3_*` that would be ignored anyway.

DuckDB's httpfs then fetches the presigned URL as plain HTTPS with `Range` only. No `Authorization` header means the preflight's `Access-Control-Request-Headers` is just `Range`, which is already in the bucket's CORS `responseHeader` list. Presigned URLs also stay self-contained, so large reads that span multiple Range requests all validate under the same signature.

Secondary fixes kept from the earlier attempt at this bug:

- `configureStorage` resolves the endpoint from the provider registry (`buildEndpointFromTemplate()`) when the connection's `endpoint` field is empty and the provider is not plain S3. Covers GCS, DO Spaces, Wasabi, B2, Storj, Contabo, Hetzner, Linode, OVHcloud — so auto-detected `?url=` connections that omit the endpoint still route DuckDB to the correct host on the `s3://` fallback path.
- Hardened `configureStorage` against Svelte-proxied `connId` values. Template-literal use of a proxied primitive could throw `TypeError: can't convert symbol to string` inside the swallowed catch, polluting the console. `connId` is now normalized to a plain string at the top of the function.
- Updated the in-app GCS CORS guidance (`CORS_HELP.gcs`) to include `Range` and the conditional `If-Match` / `If-Modified-Since` / `If-None-Match` / `If-Unmodified-Since` headers in `responseHeader`. DuckDB httpfs issues partial-content GETs with `Range`, and GCS treats `responseHeader` as dual-purpose (`Access-Control-Expose-Headers` AND `Access-Control-Allow-Headers`) — any missing request header makes the preflight return 200 without CORS headers and the browser blocks the real request.

Review follow-ups landed in the same changeset:

- `decimalScale()` in `query/wasm.ts` now matches both DuckDB DESCRIBE (`DECIMAL(10,2)`) and Arrow `toString()` (`Decimal[10e+2]`) forms. Previously the regex only matched the DESCRIBE form, and because callers derive `types` from `String(field.type)` on Arrow schema, `decimalCols` stayed empty and every DECIMAL column rendered as raw `Uint32Array` / `BigInt` — the exact bug the formatting path was meant to fix.
- Every `configureStorage` call site now threads either `source.ref` (`getSchema`, `getRowCount`, `getSchemaAndCrs`, `detectCrs`) or the raw `sql` (`query`, `queryForMap`, `queryCancellable`, `queryForMapCancellable`) so the presigned-HTTPS short-circuit fires on every query path, not just the one-shot schema probe at tab open.
- `ZarrViewer` and `ZarrMapViewer` migrated to `buildHttpsUrlAsync`. Previously they used the sync builder and fed the unsigned URL to zarrita's range-request fetcher, which 403'd on private `signed-s3` buckets.
