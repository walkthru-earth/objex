import { MAX_QUERY_HISTORY_ENTRIES, STORAGE_KEYS } from '$lib/constants.js';

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
		const raw = localStorage.getItem(STORAGE_KEYS.QUERY_HISTORY);
		if (raw) return JSON.parse(raw) as QueryHistoryEntry[];
	} catch {
		// ignore parse errors
	}
	return [];
}

function persistEntries(entries: QueryHistoryEntry[]) {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEYS.QUERY_HISTORY, JSON.stringify(entries));
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
			entries = [newEntry, ...entries].slice(0, MAX_QUERY_HISTORY_ENTRIES);
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
