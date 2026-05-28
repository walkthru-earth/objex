---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

Harden the pure utilities against polynomial ReDoS (CodeQL `js/polynomial-redos`). No public API or behavior change, the same inputs produce the same outputs, but worst-case inputs now run in linear time instead of O(n^2).

- `connection-identity` and `storage-url`: replace the `/\/+$/` and `/^\/+|\/+$/g` slash-trim regexes with linear character-scan helpers.
- `cloud-url`: rewrite the `s3://` and `gcs://` matchers from `([^/]+)\/?(.*)` to `([^/]+)(?:\/(.*))?` to remove the `[^/]+` / `.*` backtracking ambiguity.
- `markdown-sql`: match the sql-fence name with `[ \t]` instead of `\s` so the trailing newline is an unambiguous boundary.
- `column-types`: strip the parenthesized type span via `indexOf`/`lastIndexOf` slicing instead of `/\(.*\)/`.
