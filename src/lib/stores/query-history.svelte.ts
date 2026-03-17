import { MAX_QUERY_HISTORY_ENTRIES, STORAGE_KEYS } from '../constants.js';
import { loadFromStorage, persistToStorage } from '../utils/local-storage.js';

export interface QueryHistoryEntry {
	id: string;
	sql: string;
	timestamp: number;
	durationMs: number;
	rowCount: number;
	error?: string;
	connectionId?: string;
}

function createQueryHistoryStore() {
	let entries = $state<QueryHistoryEntry[]>(
		loadFromStorage<QueryHistoryEntry[]>(STORAGE_KEYS.QUERY_HISTORY, [])
	);

	function save() {
		persistToStorage(STORAGE_KEYS.QUERY_HISTORY, entries);
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
