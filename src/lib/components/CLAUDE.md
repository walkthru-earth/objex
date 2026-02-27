# components/

All Svelte 5 components. Organized by function.

```mermaid
graph TD
    subgraph layout
        SB[Sidebar] --> FTS[FileTreeSidebar]
        SB --> AS[AboutSheet]
        TB[TabBar]
        CD[ConnectionDialog]
        STB[StatusBar]
    end
    subgraph browser
        FTS --> FB[FileBrowser]
        FB --> FR[FileRow]
        FB --> BC[Breadcrumb]
        FB --> SBar[SearchBar]
        FB --> DZ[DropZone]
    end
    subgraph viewers["viewers/ (18+)"]
        VR[ViewerRouter] -->|by ext| TV[TableViewer]
        VR --> CV[CogViewer]
        VR --> PV[PmtilesViewer]
        VR --> MORE[...]
    end
    subgraph editor
        SQL[SqlEditor] --> CM[CodeMirrorEditor]
    end
    subgraph ui["ui/ (bits-ui)"]
        BTN[button] & INP[input] & TT[tooltip] & CTX[context-menu] & DD[dropdown-menu]
    end
    TB --> VR
```

| Directory | Files | Role | Used by |
|-----------|-------|------|---------|
| `viewers/` | 34 | Per-format viewers | ViewerRouter → +page.svelte |
| `browser/` | 10 | File tree, search, upload, dialogs | FileTreeSidebar → Sidebar → +page.svelte |
| `layout/` | 8 | Sidebar, tabs, status bar, toggles, about sheet | +page.svelte, +layout.svelte |
| `editor/` | 4 | SQL editor, markdown editor, SQL results | TableViewer, MarkdownViewer |
| `map/` | 2 | MapContainer, AttributeTable | GeoParquetMapViewer, PmtilesMapView, MapViewer |
| `ui/` | 61 | bits-ui primitives (https://bits-ui.com/llms.txt) | Used across all components |

See `viewers/CLAUDE.md` for viewer-specific details.
