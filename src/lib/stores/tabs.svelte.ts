import type { Tab } from '$lib/types.js';
import { tabResources } from './tab-resources.svelte.js';

/** Maximum number of viewer instances kept alive (mounted but hidden). */
const MAX_ALIVE = 5;

function releaseDuckDbMemory() {
	import('$lib/query/index.js')
		.then(({ getQueryEngine }) => getQueryEngine().then((engine) => engine.releaseMemory()))
		.catch(() => {});
}

function createTabsStore() {
	let tabs = $state<Tab[]>([]);
	let activeTabId = $state<string | null>(null);

	// LRU order: most recently activated tab IDs first.
	// Used to decide which tabs stay alive in the DOM.
	let recentOrder = $state<string[]>([]);

	function touchRecent(id: string) {
		recentOrder = [id, ...recentOrder.filter((r) => r !== id)];

		// Dispose resources for tabs that fell out of the alive window.
		// This fires asynchronously to avoid blocking the tab switch.
		const evicted = recentOrder.slice(MAX_ALIVE);
		for (const evictedId of evicted) {
			if (tabResources.has(evictedId)) {
				tabResources.dispose(evictedId);
			}
		}
	}

	function pruneRecent() {
		// Remove IDs that no longer exist in tabs
		const ids = new Set(tabs.map((t) => t.id));
		recentOrder = recentOrder.filter((r) => ids.has(r));
	}

	return {
		get items() {
			return tabs;
		},

		get activeTabId() {
			return activeTabId;
		},

		get active(): Tab | undefined {
			if (!activeTabId) return undefined;
			return tabs.find((t) => t.id === activeTabId);
		},

		/**
		 * Tabs that should be kept alive in the DOM (mounted but hidden if inactive).
		 * Returns up to MAX_ALIVE tabs in MRU order. The active tab is always included.
		 */
		get aliveTabs(): Tab[] {
			const aliveIds = recentOrder.slice(0, MAX_ALIVE);
			// Ensure active tab is always included
			if (activeTabId && !aliveIds.includes(activeTabId)) {
				aliveIds.pop();
				aliveIds.unshift(activeTabId);
			}
			const idSet = new Set(aliveIds);
			return tabs.filter((t) => idSet.has(t.id));
		},

		open(tab: Tab) {
			// If a tab with the same id is already open, just activate it
			const existing = tabs.find((t) => t.id === tab.id);
			if (existing) {
				activeTabId = tab.id;
				touchRecent(tab.id);
				return;
			}
			tabs = [...tabs, tab];
			activeTabId = tab.id;
			touchRecent(tab.id);
		},

		async close(id: string) {
			const index = tabs.findIndex((t) => t.id === id);
			if (index === -1) return;

			// Dispose viewer resources (maps, abort controllers, cached data)
			await tabResources.dispose(id);

			tabs = tabs.filter((t) => t.id !== id);
			pruneRecent();

			// If we closed the active tab, activate an adjacent one
			if (activeTabId === id) {
				if (tabs.length === 0) {
					activeTabId = null;
				} else {
					// Prefer the most recently used tab, or the tab at the same index
					const nextId = recentOrder[0] ?? tabs[Math.min(index, tabs.length - 1)]?.id;
					activeTabId = nextId ?? null;
				}
			}

			releaseDuckDbMemory();
		},

		async closeOthers(id: string) {
			// Dispose resources for all tabs except the kept one
			await tabResources.disposeAllExcept(id);

			tabs = tabs.filter((t) => t.id === id);
			activeTabId = id;
			recentOrder = [id];

			releaseDuckDbMemory();
		},

		setActive(id: string) {
			if (tabs.find((t) => t.id === id)) {
				activeTabId = id;
				touchRecent(id);
			}
		},

		update(id: string, partial: Partial<Omit<Tab, 'id'>>) {
			tabs = tabs.map((t) => (t.id === id ? { ...t, ...partial } : t));
		}
	};
}

export const tabStore = createTabsStore();
export { tabStore as tabs };
