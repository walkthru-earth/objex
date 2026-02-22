import { getAdapter } from '$lib/storage/index.js';
import type { Connection, FileEntry } from '$lib/types.js';
import { credentialStore } from './credentials.svelte.js';
import { safeLock } from './safelock.svelte.js';

function createBrowserStore() {
	let activeConnection = $state<Connection | null>(null);
	let currentPrefix = $state<string>('');
	let entries = $state<FileEntry[]>([]);
	let loading = $state<boolean>(false);
	let error = $state<string | null>(null);
	let uploading = $state<boolean>(false);
	let uploadProgress = $state<{ current: number; total: number }>({ current: 0, total: 0 });

	async function browse(connection: Connection, prefix?: string) {
		activeConnection = connection;
		const startPrefix = prefix ?? connection.rootPrefix ?? '';
		currentPrefix = startPrefix;
		loading = true;
		error = null;
		entries = [];

		try {
			const adapter = getAdapter('remote', connection.id);
			const result = await adapter.list(startPrefix);
			entries = result;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function navigateTo(prefix: string) {
		if (!activeConnection) return;
		await browse(activeConnection, prefix);
	}

	async function navigateUp() {
		if (!activeConnection || !currentPrefix) return;
		const parts = currentPrefix.replace(/\/+$/, '').split('/');
		parts.pop();
		const parent = parts.length > 0 ? `${parts.join('/')}/` : '';
		await browse(activeConnection, parent);
	}

	function clear() {
		activeConnection = null;
		currentPrefix = '';
		entries = [];
		loading = false;
		error = null;
	}

	async function refresh() {
		if (!activeConnection) return;
		await browse(activeConnection, currentPrefix);
	}

	function assertWritable() {
		if (safeLock.locked)
			throw new Error('Safe lock is enabled. Unlock to perform write operations.');
		if (!activeConnection) throw new Error('No active connection.');
	}

	async function uploadFile(fileName: string, data: Uint8Array, contentType?: string) {
		assertWritable();
		const adapter = getAdapter('remote', activeConnection!.id);
		const key = currentPrefix + fileName;
		await adapter.put(key, data, contentType);
	}

	async function uploadFiles(files: Array<{ name: string; data: Uint8Array; type?: string }>) {
		assertWritable();
		uploading = true;
		uploadProgress = { current: 0, total: files.length };

		try {
			for (const file of files) {
				await uploadFile(file.name, file.data, file.type);
				uploadProgress = { current: uploadProgress.current + 1, total: files.length };
			}
			await refresh();
		} finally {
			uploading = false;
			uploadProgress = { current: 0, total: 0 };
		}
	}

	async function deleteEntry(entry: FileEntry) {
		assertWritable();
		const adapter = getAdapter('remote', activeConnection!.id);

		if (entry.is_dir) {
			await adapter.deletePrefix(entry.path);
		} else {
			await adapter.delete(entry.path);
		}

		await refresh();
	}

	async function renameEntry(entry: FileEntry, newName: string) {
		assertWritable();
		if (newName === entry.name) throw new Error('New name is the same as the current name.');
		const adapter = getAdapter('remote', activeConnection!.id);

		// Build the new key by replacing the last segment
		const parentPrefix = entry.path.replace(/[^/]*\/?$/, '');
		const newKey = entry.is_dir ? `${parentPrefix + newName}/` : parentPrefix + newName;

		await adapter.copy(entry.path, newKey);
		if (entry.is_dir) {
			await adapter.deletePrefix(entry.path);
		} else {
			await adapter.delete(entry.path);
		}

		await refresh();
	}

	async function createFolder(name: string) {
		assertWritable();
		const adapter = getAdapter('remote', activeConnection!.id);
		const key = `${currentPrefix + name}/`;
		await adapter.put(key, new Uint8Array(0));
		await refresh();
	}

	return {
		get activeConnection() {
			return activeConnection;
		},
		get currentPrefix() {
			return currentPrefix;
		},
		get entries() {
			return entries;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get uploading() {
			return uploading;
		},
		get uploadProgress() {
			return uploadProgress;
		},
		get canWrite() {
			if (!activeConnection) return false;
			if (activeConnection.anonymous) return false;
			return credentialStore.has(activeConnection.id);
		},
		browse,
		navigateTo,
		navigateUp,
		clear,
		refresh,
		uploadFile,
		uploadFiles,
		deleteEntry,
		renameEntry,
		createFolder
	};
}

export const browser = createBrowserStore();
