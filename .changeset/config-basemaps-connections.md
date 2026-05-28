---
'@walkthru-earth/objex': minor
'@walkthru-earth/objex-utils': minor
---

Wire config-driven basemaps and default connections into the live app.

- Hosts can now set the basemap list, the default basemap per theme, and the preloaded buckets from `config.json` or `?config=<url>` without a rebuild. A basemap picker in the Settings panel lets the user override the basemap, with an Auto option that follows the theme.
- `MapContainer` resolves its basemap through the new pure `resolveBasemap()` selector and falls back to the hardcoded CartoDB styles when no basemaps are configured, so a failed config never blanks the map. Raster basemaps are supported via a generated MapLibre style.
- The connection rail seeds its rows from `config.json` connections on first run, auto-opening the first anonymous bucket and saving private buckets as rows that prompt for credentials on click. When no connections are configured it falls back to the Source Cooperative demo bucket.
