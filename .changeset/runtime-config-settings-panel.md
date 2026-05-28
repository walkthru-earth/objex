---
'@walkthru-earth/objex': minor
'@walkthru-earth/objex-utils': minor
---

Add a runtime config and an in-app settings panel.

- A bundled `static/config.json` (or a remote `?config=<url>` file) now seeds defaults for theme, locale, row and STAC item limits, chrome visibility, basemaps, and connection seeds, so hosts can customize objex without a rebuild. Malformed config falls back to safe defaults and the app still boots.
- New pure helpers in `@walkthru-earth/objex-utils` (`AppConfig`, `mergeAppConfig`, `resolveSetting`, `parseVisibilityParam`, and value coercers) provide a field-by-field merge of untrusted JSON and a first-match-wins precedence resolver. Covered by unit tests.
- The settings store resolves each value through query parameter, then localStorage, then config, then a hardcoded fallback. Only keys the user explicitly changes are persisted, so config edits still reach untouched keys.
- A new settings panel (gear icon in the sidebar) edits appearance, language, data limits, and interface visibility, with copy config JSON and reset to defaults. Per-link overrides via `?sidebar=`, `?tree=`, `?panel=`, and `?config=` are supported, and toggles locked by a link parameter are shown as read-only.
