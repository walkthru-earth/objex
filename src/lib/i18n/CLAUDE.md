# i18n/

Simple key-based translation with `{param}` interpolation. Supports RTL.

```mermaid
graph LR
    T["t('files.size', {size: '1.2 MB'})"] --> IDX[index.svelte.ts]
    IDX --> EN[en.ts]
    IDX --> AR[ar.ts]
    IDX --> DIR["getDir() → 'ltr' | 'rtl'"]
```

| File | Exports | Used by |
|------|---------|---------|
| `index.svelte.ts` | `t()`, `getLocale()`, `setLocale()`, `getDir()`, `Locale` | Nearly all components (45+ files): all viewers, all browser components, all layout components, MilkdownEditor, +page.svelte, +layout.svelte, stores/settings |
| `en.ts` | English translations dict | index.svelte.ts |
| `ar.ts` | Arabic translations dict | index.svelte.ts |

Use `t('key')` for all user-facing strings. Add new keys to both `en.ts` and `ar.ts`.
