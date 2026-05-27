import {
	type SortConfig,
	type SortField,
	sortFileEntries,
	toggleSortField
} from '@walkthru-earth/objex-utils';
import type { FileEntry } from '../types.js';

function createFilesStore() {
	let files = $state<FileEntry[]>([]);
	let currentPath = $state<string>('');
	let loading = $state<boolean>(false);
	let error = $state<string | null>(null);
	let sortConfig = $state<SortConfig>({ field: 'name', direction: 'asc' });

	return {
		get entries() {
			return files;
		},

		get currentPath() {
			return currentPath;
		},

		get loading() {
			return loading;
		},

		get error() {
			return error;
		},

		get sortConfig() {
			return sortConfig;
		},

		setFiles(entries: FileEntry[]) {
			files = sortFileEntries(entries, sortConfig);
			error = null;
		},

		setPath(path: string) {
			currentPath = path;
		},

		setLoading(state: boolean) {
			loading = state;
		},

		setError(message: string | null) {
			error = message;
		},

		sort(field: SortField) {
			sortConfig = toggleSortField(sortConfig, field);
			files = sortFileEntries(files, sortConfig);
		}
	};
}

export const files = createFilesStore();
