/**
 * Pure file entry sorting — framework-agnostic, works in Node.js.
 */

import type { FileEntry } from '../../../src/lib/types.js';

export type SortField = 'name' | 'size' | 'modified' | 'extension';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
	field: SortField;
	direction: SortDirection;
}

/**
 * Sort file entries by the given config.
 * Directories always sort before files regardless of sort field.
 * Returns a new array (does not mutate the input).
 */
export function sortFileEntries(entries: FileEntry[], config: SortConfig): FileEntry[] {
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

/**
 * Toggle sort config: same field flips direction, new field starts ascending.
 */
export function toggleSortField(current: SortConfig, field: SortField): SortConfig {
	if (current.field === field) {
		return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
	}
	return { field, direction: 'asc' };
}
