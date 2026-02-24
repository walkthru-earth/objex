/**
 * Tab resource registry — deterministic cleanup for viewer resources.
 *
 * Viewers register cleanup callbacks (abort controllers, map instances,
 * cached data) when they mount.  The tab store calls `dispose(tabId)`
 * on close so resources are freed immediately instead of relying on
 * garbage collection.
 */

type CleanupFn = () => void | Promise<void>;

function createTabResourceRegistry() {
	const registry = new Map<string, CleanupFn[]>();

	return {
		/**
		 * Register a cleanup callback for a tab.
		 * Returns an unregister function (useful in $effect cleanup).
		 */
		register(tabId: string, cleanup: CleanupFn): () => void {
			if (!registry.has(tabId)) {
				registry.set(tabId, []);
			}
			registry.get(tabId)!.push(cleanup);

			return () => {
				const fns = registry.get(tabId);
				if (fns) {
					const idx = fns.indexOf(cleanup);
					if (idx !== -1) fns.splice(idx, 1);
					if (fns.length === 0) registry.delete(tabId);
				}
			};
		},

		/** Dispose all resources for a single tab. */
		async dispose(tabId: string): Promise<void> {
			const fns = registry.get(tabId);
			if (!fns) return;
			registry.delete(tabId);

			const results = await Promise.allSettled(fns.map((fn) => fn()));
			for (const r of results) {
				if (r.status === 'rejected') {
					console.warn('[tab-resources] cleanup error for tab', tabId, r.reason);
				}
			}
		},

		/** Dispose all resources except for the given tab. */
		async disposeAllExcept(keepTabId: string): Promise<void> {
			const entries = [...registry.entries()].filter(([id]) => id !== keepTabId);
			await Promise.allSettled(entries.map(([id]) => this.dispose(id)));
		},

		/** Dispose every registered tab. */
		async disposeAll(): Promise<void> {
			const ids = [...registry.keys()];
			await Promise.allSettled(ids.map((id) => this.dispose(id)));
		},

		/** Check if a tab has any registered resources. */
		has(tabId: string): boolean {
			return registry.has(tabId);
		}
	};
}

export const tabResources = createTabResourceRegistry();
