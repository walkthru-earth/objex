/**
 * Zarr tab-opening helper.
 * Centralizes Zarr store tab creation to avoid duplicating the same logic
 * across FileBrowser, FileRow, FileTreeSidebar, and +page.svelte.
 *
 * Kept separate from zarr.ts to avoid adding a store dependency to a pure utility.
 */

import { tabs } from '../stores/tabs.svelte.js';

interface ZarrTabContext {
	/** 'remote' for object-storage connections, 'url' for direct URL tabs. */
	source: 'remote' | 'url';
	/** Connection ID — required for remote sources. */
	connectionId?: string;
	/** Fallback name when the path has no meaningful last segment (e.g. bucket root). */
	bucketFallback?: string;
}

/**
 * Open a directory path as a Zarr store tab.
 * Normalizes the path, derives a display name, and deduplicates via a
 * deterministic tab ID so calling this twice with the same path is a no-op.
 */
export function openZarrTab(dirPath: string, ctx: ZarrTabContext): void {
	const path =
		ctx.source === 'remote'
			? dirPath.endsWith('/')
				? dirPath
				: `${dirPath}/`
			: dirPath.replace(/\/+$/, '');
	const name =
		path.replace(/\/+$/, '').split('/').pop()?.split('?')[0] || ctx.bucketFallback || 'zarr';
	const id = ctx.connectionId ? `${ctx.connectionId}:${path}` : `url:${path}`;
	tabs.open({
		id,
		name,
		path,
		source: ctx.source,
		...(ctx.connectionId ? { connectionId: ctx.connectionId } : {}),
		extension: 'zarr'
	});
}
