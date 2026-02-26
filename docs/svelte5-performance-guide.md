# Svelte 5 Performance Guide — Project-Specific

> Best practices drawn from Svelte 5 docs, GitHub issues, and community research.
> Focused on patterns relevant to this codebase (data-heavy SPA with deck.gl, DuckDB, MapLibre).

---

## 1. `$state` vs `$state.raw` — When to Use Each

### Rule: Use `$state.raw` for any array/object with 100+ items or passed to external libraries

`$state` wraps values in deep `Proxy` objects for fine-grained reactivity. This is great for small UI state but has real costs:

- **Proxy overhead:** Every property access on a proxied array goes through a trap handler
- **`deep_read` freeze:** When proxied state is passed to non-rune Svelte 4 interop code, Svelte runs `deep_read()` which recursively walks the entire structure. At 10k+ items this freezes the browser (Svelte issue #10637)
- **External library incompatibility:** deck.gl, DuckDB, Arrow, MapLibre all expect plain objects. Proxied state can cause subtle bugs

```ts
// BAD — proxies a 5000-row array
let rows = $state<Record<string, any>[]>([]);

// GOOD — no proxy, update by reassignment
let rows = $state.raw<Record<string, any>[]>([]);
rows = newRows; // triggers reactivity
```

### When `$state` IS correct:
- Small UI state: `loading`, `error`, `filterQuery`, `expanded`
- Objects with <50 properties that are mutated in-place
- TreeNode objects where you need `node.expanded = true` to trigger updates

### When to use `$state.snapshot()`:
- Before passing reactive state to external JS libraries:
```ts
const plain = $state.snapshot(reactiveData);
deckOverlay.setProps({ data: plain });
```

---

## 2. `$effect` Patterns — Async Work and Cleanup

### The async `$effect` anti-pattern

`$effect` cannot be async — it must return a cleanup function (or nothing), not a Promise.

```ts
// BAD — returns a Promise, cleanup function lost
$effect(async () => {
  const data = await fetch(url);
  result = await data.json();
});

// GOOD — fire-and-forget async with cancellation
$effect(() => {
  const currentTab = tab; // read deps SYNCHRONOUSLY first
  if (!currentTab) return;

  const ac = new AbortController();
  loadData(currentTab, ac.signal); // async, not awaited
  return () => ac.abort(); // cleanup cancels in-flight work
});
```

### Critical: Dependencies must be read synchronously

Any value read AFTER an `await` or inside a `setTimeout` callback is NOT tracked:

```ts
$effect(() => {
  // connection.id is tracked here (synchronous read)
  const connId = connection.id;

  (async () => {
    await somePromise;
    // WARNING: reading `connection.provider` here does NOT create a dependency
    // The effect won't re-run when `connection.provider` changes
    console.log(connection.provider);
  })();
});
```

### `$effect` vs `onDestroy`

| Pattern | Fires on | Use for |
|---|---|---|
| `$effect(() => () => cleanup())` | Every dep change + unmount | Subscriptions, event listeners tied to reactive deps |
| `onDestroy(() => cleanup())` | Only component unmount | One-time teardown with no reactive deps |
| Both together | Different triggers | Use `$effect` for dep-change cleanup, `onDestroy` for final cleanup |

In this codebase, most viewers should use BOTH:
- `$effect` with `tabResources.register()` for LRU eviction
- `onDestroy(cleanup)` for guaranteed final cleanup

---

## 3. `$derived` Best Practices

### Avoid deep derived chains

Due to Svelte issue #15936, chains of `$derived` values can cause exponential recomputation:

```ts
// BAD — 4-level chain, exponential re-evaluation risk
const a = $derived(source.value);
const b = $derived(a * 2);
const c = $derived(b + 1);
const d = $derived(c.toString()); // reads c → b → a → source on every change
```

```ts
// GOOD — flatten to 1-2 levels
const computed = $derived.by(() => {
  const a = source.value;
  const b = a * 2;
  const c = b + 1;
  return c.toString();
});
```

### `$derived` vs `$derived.by`

Functionally identical. Use `$derived` for single expressions, `$derived.by` for block bodies:

```ts
const count = $derived(items.length);                    // single expression
const filtered = $derived.by(() => {                     // block body
  if (!query) return items;
  return items.filter(i => i.name.includes(query));
});
```

### `$derived` for filtering large lists — with `$state.raw`

```ts
let allNodes = $state.raw<TreeNode[]>([]);
let filterQuery = $state('');

// This runs whenever allNodes or filterQuery changes
const filteredNodes = $derived(
  filterQuery ? filterTree(allNodes, filterQuery.toLowerCase()) : allNodes
);
```

With `$state.raw`, `filteredNodes` re-derives only when `allNodes` is reassigned or `filterQuery` changes — not on individual item mutations.

---

## 4. Recursive Snippets — Tree Rendering at Scale

### The `{#if}` guard is critical

Without it, a 3000-node tree renders all nodes on mount, even collapsed ones:

```svelte
{#snippet treeItem(node, depth)}
  <div>...</div>
  <!-- CRITICAL: only render children if expanded -->
  {#if node.expanded}
    {#each node.children as child (child.entry.path)}
      {@render treeItem(child, depth + 1)}
    {/each}
  {/if}
{/snippet}
```

### Snippets vs separate components

Snippets render in the parent component's scope — no component instance overhead. For trees with thousands of nodes, this is significantly faster than `<svelte:self>` or separate components.

### Keyed `{#each}` for stable updates

Always use a key for `{#each}` in trees. Without it, Svelte recreates all children when the list changes:

```svelte
{#each nodes as node (node.entry.path)}  <!-- keyed by unique path -->
  {@render treeItem(node, 0)}
{/each}
```

---

## 5. `untrack()` — Breaking Circular Dependencies

### When to use

`untrack()` prevents a read from creating a reactive dependency. Use it when an effect needs to read a value without re-running when that value changes:

```ts
$effect(() => {
  const trigger = someReactiveValue; // this triggers the effect
  const snapshot = untrack(() => otherValue); // read without subscribing
  doSomething(trigger, snapshot);
});
```

### Common pattern in this codebase

```ts
$effect(() => {
  const _connId = connection.id; // trigger on connection change
  untrack(() => loadRoot());     // loadRoot reads rootNodes etc. without creating deps
});
```

### Warning: `untrack` doesn't prevent infinite loops from mutations

If the mutation itself triggers the effect through other tracked dependencies, `untrack` won't help. Add a conditional guard:

```ts
$effect(() => {
  const newVal = computeFrom(source);
  untrack(() => {
    if (target !== newVal) target = newVal; // guard prevents loop
  });
});
```

---

## 6. Store Architecture — Module-Level Singletons

### Current pattern (correct for SPA):

```ts
// src/lib/stores/xxx.svelte.ts
function createXxxStore() {
  let value = $state(...);
  return { get value() { return value; }, ... };
}
export const xxxStore = createXxxStore();
```

### Key points:
- Module-level singletons are safe for client-only SPA (no SSR)
- If SSR is ever added, these must move to `setContext`/`getContext`
- Use `$state.raw` for any store holding large data (rows, entries, etc.)
- Store exports should be the reactive object itself, not a `$state` wrapping it

### Known memory issue (Svelte #11817):

`$derived` values created inside components that reference module-level rune state may not always clean up correctly on component unmount. If memory grows in long sessions, check for this pattern.

---

## 7. SPA / Static Adapter Notes

Current setup is correct:
```js
// svelte.config.js
adapter: adapter({ fallback: 'index.html' })

// +layout.ts
export const ssr = false;
export const prerender = false;
```

### Optimization opportunities:
- The fallback page should be as lean as possible — every navigation loads it
- Code-split heavy viewers via dynamic `import()` (already done for deck.gl, MapLibre)
- Prefetch adapter WASM/workers on idle (`requestIdleCallback`)

---

## 8. Performance Checklist for New Viewers

When adding a new viewer component, ensure:

- [ ] `cleanup()` function that nulls all heavy state
- [ ] `$effect(() => { const unreg = tabResources.register(tab.id, cleanup); return unreg; })`
- [ ] `onDestroy(cleanup)` as final safety net
- [ ] `AbortController` created in load `$effect`, signal passed to `adapter.read()`
- [ ] `$effect` return aborts the controller
- [ ] Large data arrays use `$state.raw`, not `$state`
- [ ] Generation counter or abort check after every `await` in the load function
- [ ] `URL.revokeObjectURL()` for any blob URLs created
- [ ] WebGL/canvas resources explicitly disposed (not just nulled)
- [ ] No `document.addEventListener` without matching removal in cleanup
