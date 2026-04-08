# Hetzner Object Storage - Read-Only Key

| Field | Value |
|-------|-------|
| **Provider** | Hetzner Object Storage |
| **Region** | nbg1 |
| **Endpoint** | `https://nbg1.your-objectstorage.com` |
| **Bucket** | `tabaqat-data` |
| **Access Key** | `A1ID3Q07NNBQV5JE37MH` |
| **Secret Key** | `zhRcXRB8AtoLxHMoxN11mzmKSVQy4QSdsLW3cWH9` |
| **Project ID** | `4052810` |

## Permissions

This key is **read-only**. The following actions are denied via bucket policy:

- `s3:PutObject` (upload)
- `s3:DeleteObject` (delete)
- `s3:AbortMultipartUpload`
- `s3:PutBucketPolicy` (modify policy)
- `s3:DeleteBucketPolicy` (remove policy)

Allowed: list, get, head, range requests.

## CORS

CORS is configured to allow browser access from any origin:

- Methods: `GET`, `HEAD`
- Exposed headers: `ETag`, `Content-Length`, `Content-Type`, `Content-Range`, `Accept-Ranges`
- Max age: 86400s (24h)

## Recovery

To restore write access, generate a new key from the
[Hetzner Console](https://console.hetzner.com/projects/4052810/servers)
and use it to delete or replace the bucket policy.
