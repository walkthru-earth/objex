# components/

All Svelte 5 components. Organized by function.

```mermaid
graph TD
    subgraph layout
        SB[Sidebar] --> FTS[FileTreeSidebar]
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
    subgraph ui["ui/ (shadcn-svelte)"]
        BTN[button] & INP[input] & TT[tooltip] & CTX[context-menu] & DD[dropdown-menu]
    end
    TB --> VR
```

| Directory | Files | Role |
|-----------|-------|------|
| `viewers/` | 34 | Per-format viewers (Table, Map, Code, PDF, 3D, Archive...) |
| `browser/` | 10 | File tree, breadcrumbs, search, upload, dialogs |
| `layout/` | 7 | Sidebar, tabs, status bar, connection dialog, toggles |
| `editor/` | 4 | CodeMirror SQL editor, Milkdown markdown, SQL result blocks |
| `map/` | 2 | Shared MapContainer, AttributeTable |
| `ui/` | 61 | shadcn-svelte primitives (bits-ui based) |

See `viewers/CLAUDE.md` for viewer-specific details.
