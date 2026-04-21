---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

Fix in-app GCS CORS guidance, private buckets accessed with HMAC keys need the AWS SigV4 request headers in the CORS `responseHeader` list.

Root cause: GCS's `responseHeader` field is dual-purpose, it becomes both `Access-Control-Expose-Headers` on real responses and `Access-Control-Allow-Headers` on preflights. When the browser signs a request with AWS v4 (Authorization, x-amz-content-sha256, x-amz-date), the preflight includes them in `Access-Control-Request-Headers`. If they aren't listed in `responseHeader`, GCS silently omits `Access-Control-Allow-Origin` from the preflight response and the browser blocks the request with no useful error.

The GCS `CORS_HELP` entry now:

- Emits a `cors.json` template that includes `Authorization`, `x-amz-content-sha256`, `x-amz-date`, plus `x-amz-*` and `x-goog-*` wildcards in `responseHeader`.
- Updates the note to call out that this is required for HMAC-signed (private-bucket) access, with a hint about the silent-preflight-rejection failure mode.
