import type { QueryEngine, QueryResult } from '../../../src/lib/query/engine.js';

/**
 * Executes the SQL blocks parsed out of a markdown document (Evidence.dev style)
 * against an injected query engine, and caches the results by block name. Pairs
 * with `markdown-sql.ts` (the parser). Pure TypeScript, the engine is supplied by
 * the host so this module never imports DuckDB or any other heavy dependency.
 */
export class MarkdownSqlContext {
	private engine: QueryEngine;
	private connId: string;
	private prefix: string;
	private results = new Map<string, { result: QueryResult; rows: Record<string, any>[] }>();

	constructor(engine: QueryEngine, connId: string, prefix = '') {
		this.engine = engine;
		this.connId = connId;
		this.prefix = prefix;
	}

	/** Execute a SQL query and store the result under the given name. */
	async executeSql(sql: string, queryName: string): Promise<Record<string, any>[]> {
		const transformedSql = this.transformPaths(sql);
		const result = await this.engine.query(this.connId, transformedSql);
		const rows = result.rows ?? [];
		this.results.set(queryName, { result, rows });
		return rows;
	}

	/**
	 * Transform relative file paths in SQL to full S3 URLs.
	 * e.g. read_parquet('data.parquet') becomes read_parquet('s3://bucket/prefix/data.parquet').
	 */
	private transformPaths(sql: string): string {
		if (!this.connId || !this.prefix) return sql;
		return sql.replace(/(read_(?:parquet|csv|json|csv_auto))\('([^']+)'\)/g, (match, fn, path) => {
			if (path.startsWith('s3://') || path.startsWith('http') || path.startsWith('/')) {
				return match;
			}
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
		if (!entry) return [];
		return entry.result.columns;
	}
}
