---
"@walkthru-earth/objex": minor
"@walkthru-earth/objex-utils": minor
---

Audit remediation across five dimensions.

Correctness fixes
- Geometry column detection now scans the first non-null value across rows instead of only row 0, so a table whose first row has a null geometry still renders on the map.
- GeometryCollection-only columns (WKB type 7) are no longer selected as the geometry column, since they render empty. Detection falls through to a renderable column.
- The stac-geoparquet low-memory default is now gated on a real mobile user agent, so a narrow desktop window is no longer misclassified and no longer silently drops ORDER BY datetime DESC or caps results to 200.

Performance
- query() now runs through the non-blocking conn.send() path so a data query no longer blocks the single DuckDB worker and starves other tabs.
- TableViewer skips the map-attribute extraction walk when the map view is not active and recomputes it on switch into map view.
- MultiCogViewer per-asset caches are now bounded with LruCache(64) per the viewer memory checklist.

New public API
- isWgs84(crs) helper in objex-utils for WGS84 lon/lat detection.
- DEFAULT_AWS_REGION, TILE_DEBOUNCE_MS, and FIRST_FEATURE_FLY_ZOOM constants.

UI consistency
- New shared ViewerHeader and ViewerStatus components adopted across the simple viewers, with loading and error states routed through i18n and semantic color tokens.
- Viewer error handling unified through handleLoadError and isAbortError so deck.gl abort cascades are silenced consistently.
- Shared signed-iframe-URL resolver extracted, ZarrViewer cleanup contract added, and raw zinc/red color utilities swept to semantic tokens.

Mobile responsiveness
- Horizontal resizable panes stack on small screens, TableGrid column resize works with pointer and touch input, PmtilesTileInspector panels stack on mobile, the tab close button is touch-visible, and the StatusBar drops non-essential segments on narrow screens.
