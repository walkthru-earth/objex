---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

Clarify the two-layer utility split. Rename `cog-pure` to `cog-info` and the app-side `url` to `signed-url`, move the markdown SQL execution context into `@walkthru-earth/objex-utils` as `MarkdownSqlContext` (engine injected by the host), add a two-layer utility map to the root guide, and fix stale documentation paths. No runtime behavior changes.
