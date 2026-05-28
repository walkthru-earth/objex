---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

Improve generic S3-compatible support and connection URL handling.

- Relabel the `minio` provider to "MinIO / RustFS / Custom" so self-hosted and S3-compatible stores (MinIO, RustFS, Ceph RGW, and other custom endpoints) are a first-class choice. No `id` change, so existing connections and host detection keep working.
- Fix the file tree "Copy HTTP URL" action emitting an AWS URL for non-AWS connections. It now routes through a shared, provider-aware `buildHttpsUrlForConnection` helper that resolves GCS, R2, Wasabi, and the rest correctly, including connections with an empty endpoint.
- Replace the silent, misleading "Empty bucket" state when a bucket listing is blocked. The file tree now detects a CORS/network failure and explains it, with guidance that the bucket needs a CORS policy or proxy access.
