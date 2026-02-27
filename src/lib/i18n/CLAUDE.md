# i18n/

Simple key-based translation with `{param}` interpolation. Supports RTL.

```mermaid
graph LR
    T["t('files.size', {size: '1.2 MB'})"] --> IDX[index.svelte.ts]
    IDX --> EN[en.ts]
    IDX --> AR[ar.ts]
    IDX --> DIR["getDir() → 'ltr' | 'rtl'"]
```

| File | Exports |
|------|---------|
| `index.svelte.ts` | `t()`, `getLocale()`, `setLocale()`, `getDir()`, `Locale` type |
| `en.ts` | English translations dict |
| `ar.ts` | Arabic translations dict |

Use `t('key')` for all user-facing strings. Add new keys to both `en.ts` and `ar.ts`.
