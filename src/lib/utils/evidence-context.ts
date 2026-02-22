import { tableFromIPC } from 'apache-arrow';
import type { QueryResult } from '$lib/query/engine';
import { getQueryEngine } from '$lib/query/index.js';

export class EvidenceContext {
	private connId: string;
	private prefix: string;
	private results = new Map<string, { result: QueryResult; rows: Record<string, any>[] }>();

	constructor(connId: string, prefix: string = '') {
		this.connId = connId;
		this.prefix = prefix;
	}

	/**
	 * Execute a SQL query and store the result under the given name.
	 */
	async executeSql(sql: string, queryName: string): Promise<Record<string, any>[]> {
		const engine = await getQueryEngine();

		// Transform relative file paths to full paths
		const transformedSql = this.transformPaths(sql);

		const result = await engine.query(this.connId, transformedSql);

		if (result.arrowBytes.length === 0) {
			this.results.set(queryName, { result, rows: [] });
			return [];
		}

		const table = tableFromIPC(result.arrowBytes);
		const columns = table.schema.fields.map((f) => f.name);
		const rows: Record<string, any>[] = [];

		for (let i = 0; i < table.numRows; i++) {
			const row: Record<string, any> = {};
			for (const col of columns) {
				row[col] = table.getChild(col)?.get(i);
			}
			rows.push(row);
		}

		this.results.set(queryName, { result, rows });
		return rows;
	}

	/**
	 * Transform relative file paths in SQL to full S3 URLs.
	 * e.g., read_parquet('data.parquet') → read_parquet('s3://bucket/prefix/data.parquet')
	 */
	private transformPaths(sql: string): string {
		if (!this.connId || !this.prefix) return sql;

		// Match read_parquet('path'), read_csv('path'), read_json('path')
		return sql.replace(/(read_(?:parquet|csv|json|csv_auto))\('([^']+)'\)/g, (match, fn, path) => {
			// Skip absolute paths and URLs
			if (path.startsWith('s3://') || path.startsWith('http') || path.startsWith('/')) {
				return match;
			}
			// Resolve relative path
			const fullPath = `s3://${this.prefix}/${path}`;
			return `${fn}('${fullPath}')`;
		});
	}

	getResult(queryName: string) {
		return this.results.get(queryName);
	}

	getAllResults(): Map<string, Record<string, any>[]> {
		const map = new Map<string, Record<string, any>[]>();
		for (const [name, { rows }] of this.results) {
			map.set(name, rows);
		}
		return map;
	}

	getColumns(queryName: string): string[] {
		const entry = this.results.get(queryName);
		if (!entry || entry.result.arrowBytes.length === 0) return [];
		const table = tableFromIPC(entry.result.arrowBytes);
		return table.schema.fields.map((f) => f.name);
	}
}
