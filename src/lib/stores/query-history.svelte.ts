const STORAGE_KEY = 'obstore-explore-query-history';
const MAX_ENTRIES = 200;

export interface QueryHistoryEntry {
	id: string;
	sql: string;
	timestamp: number;
	durationMs: number;
	rowCount: number;
	error?: string;
	connectionId?: string;
}

function loadEntries(): QueryHistoryEntry[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw) as QueryHistoryEntry[];
	} catch {
		// ignore parse errors
	}
	return [];
}

function persistEntries(entries: QueryHistoryEntry[]) {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// ignore storage errors
	}
}

function createQueryHistoryStore() {
	let entries = $state<QueryHistoryEntry[]>(loadEntries());

	function save() {
		persistEntries(entries);
	}

	return {
		get entries() {
			return entries;
		},
		add(entry: Omit<QueryHistoryEntry, 'id'>) {
			const newEntry: QueryHistoryEntry = {
				...entry,
				id: crypto.randomUUID()
			};
			entries = [newEntry, ...entries].slice(0, MAX_ENTRIES);
			save();
		},
		remove(id: string) {
			entries = entries.filter((e) => e.id !== id);
			save();
		},
		clear() {
			entries = [];
			save();
		},
		search(query: string): QueryHistoryEntry[] {
			const q = query.toLowerCase();
			return entries.filter((e) => e.sql.toLowerCase().includes(q));
		}
	};
}

export const queryHistory = createQueryHistoryStore();
