import type { FileEntry } from '$lib/types.js';

export type SortField = 'name' | 'size' | 'modified' | 'extension';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
	field: SortField;
	direction: SortDirection;
}

function sortEntries(entries: FileEntry[], config: SortConfig): FileEntry[] {
	const sorted = [...entries];
	const dir = config.direction === 'asc' ? 1 : -1;

	sorted.sort((a, b) => {
		// Directories always come first
		if (a.is_dir && !b.is_dir) return -1;
		if (!a.is_dir && b.is_dir) return 1;

		switch (config.field) {
			case 'name':
				return dir * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
			case 'size':
				return dir * (a.size - b.size);
			case 'modified':
				return dir * (a.modified - b.modified);
			case 'extension':
				return dir * a.extension.localeCompare(b.extension, undefined, { sensitivity: 'base' });
			default:
				return 0;
		}
	});

	return sorted;
}

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
			files = sortEntries(entries, sortConfig);
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
			if (sortConfig.field === field) {
				// Toggle direction if clicking the same field
				sortConfig = {
					field,
					direction: sortConfig.direction === 'asc' ? 'desc' : 'asc'
				};
			} else {
				sortConfig = { field, direction: 'asc' };
			}
			files = sortEntries(files, sortConfig);
		}
	};
}

export const fileStore = createFilesStore();
export { fileStore as files };
