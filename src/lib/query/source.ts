/**
 * Resolve a Tab to a QuerySource — the abstraction every engine helper
 * consumes. A tab is either file-backed (path → `read_parquet('url')`) or
 * SQL-backed (`tab.sourceRef` is a pre-built FROM-clause target, such as an
 * attached DuckLake table).
 *
 * This module is the only place that knows how to map a Tab to both a SQL
 * FROM target AND a resolved file URL, so TableViewer and DatabaseViewer
 * stay free of ad-hoc branching.
 */

import { buildDuckDbSource } from '../file-icons/index.js';
import type { Tab } from '../types.js';
import { buildDuckDbUrl, buildDuckDbUrlAsync } from '../utils/url.js';
import type { QuerySource } from './engine.js';

/**
 * True when a source ref points at a self-authenticating HTTPS URL (e.g. a
 * presigned `read_parquet('https://...?X-Amz-Signature=...')`). Used to decide
 * whether DuckDB needs S3 credential config — presigned URLs don't.
 */
export function isHttpsSourceRef(ref: string): boolean {
	return /(?:^|\(\s*['"])https:\/\//.test(ref);
}

export interface ResolvedTableSource extends QuerySource {
	/**
	 * True when the tab is file-backed and hyparquet / parquet metadata
	 * shortcuts apply. False for SQL-backed sources like attached DuckLake
	 * tables.
	 */
	isFileSource: boolean;
	/** File URL used for hyparquet metadata fetches. Null for SQL-backed sources. */
	fileUrl: string | null;
	/** Display label, typically the tab name. */
	label: string;
}

function toResolved(tab: Tab, fileUrl: string | null): ResolvedTableSource {
	if (tab.sourceRef) {
		return {
			ref: tab.sourceRef,
			filePath: undefined,
			isFileSource: false,
			fileUrl: null,
			label: tab.name
		};
	}
	return {
		ref: buildDuckDbSource(tab.path, fileUrl ?? ''),
		filePath: tab.path,
		isFileSource: true,
		fileUrl,
		label: tab.name
	};
}

/**
 * Resolve a tab to its QuerySource. Must be called lazily (inside reactive
 * expressions or functions) because `tab.sourceRef` and `tab.path` can change
 * over a tab's lifetime.
 */
export function resolveTableSource(tab: Tab): ResolvedTableSource {
	return toResolved(tab, tab.sourceRef ? null : buildDuckDbUrl(tab));
}

/**
 * Async counterpart of `resolveTableSource`. Returns a presigned HTTPS URL
 * for `signed-s3` connections so DuckDB httpfs can fetch without the
 * `Authorization` header preflight.
 */
export async function resolveTableSourceAsync(tab: Tab): Promise<ResolvedTableSource> {
	return toResolved(tab, tab.sourceRef ? null : await buildDuckDbUrlAsync(tab));
}
