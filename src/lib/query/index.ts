import type { QueryEngine } from './engine';

let engine: QueryEngine | null = null;

export async function getQueryEngine(): Promise<QueryEngine> {
	if (engine) return engine;

	console.log('[query] Using WASM DuckDB engine (browser)');
	const { WasmQueryEngine } = await import('./wasm');
	engine = new WasmQueryEngine();

	return engine;
}

export type { MapQueryResult, QueryEngine, QueryResult, SchemaField } from './engine';
