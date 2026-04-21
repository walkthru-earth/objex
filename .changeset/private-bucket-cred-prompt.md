---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

Fix missing credential prompt when opening a private bucket via `?url=`.

Previously, auto-detected buckets (from the `?url=` query param) were always saved with `anonymous: true`. When the user shared a URL pointing at a private bucket, the LIST request would fail with 401/403 silently and no credential prompt opened. The only workaround was to manually edit the connection in the sidebar.

Fix:

- Added an `AuthRequiredError` class thrown by `BrowserCloudAdapter.listPageS3`, `listPageGcs`, and `BrowserAzureAdapter.listPage` when the server returns 401 or 403.
- The browser store (`stores/browser.svelte.ts`) catches `AuthRequiredError` during the first LIST of an anonymous connection and surfaces it on a new reactive `authRequired` field.
- `Sidebar.svelte` watches `browser.authRequired`, flips the connection to `anonymous: false` via `connections.update()`, and calls `ensureCredentials()`, which opens the credential dialog so the user can paste HMAC keys or a SAS token.

Public buckets (Source Cooperative, Overture Maps, etc.) keep the zero-click auto-open flow, the LIST returns 200 and `authRequired` is never triggered. Private buckets now transparently degrade to a credential prompt on first visit and on every reload in unauthenticated sessions.
