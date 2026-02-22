import type { Tab } from '$lib/types.js';

function createTabsStore() {
	let tabs = $state<Tab[]>([]);
	let activeTabId = $state<string | null>(null);

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

		open(tab: Tab) {
			// If a tab with the same id is already open, just activate it
			const existing = tabs.find((t) => t.id === tab.id);
			if (existing) {
				activeTabId = tab.id;
				return;
			}
			tabs = [...tabs, tab];
			activeTabId = tab.id;
		},

		close(id: string) {
			const index = tabs.findIndex((t) => t.id === id);
			if (index === -1) return;

			tabs = tabs.filter((t) => t.id !== id);

			// If we closed the active tab, activate an adjacent one
			if (activeTabId === id) {
				if (tabs.length === 0) {
					activeTabId = null;
				} else {
					// Prefer the tab at the same index, or the last one
					const newIndex = Math.min(index, tabs.length - 1);
					activeTabId = tabs[newIndex].id;
				}
			}
		},

		setActive(id: string) {
			if (tabs.find((t) => t.id === id)) {
				activeTabId = id;
			}
		}
	};
}

export const tabStore = createTabsStore();
export { tabStore as tabs };
