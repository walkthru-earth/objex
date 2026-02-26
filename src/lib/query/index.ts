import type { QueryEngine } from './engine';

// Cache the promise (not the resolved value) to prevent race conditions.
// Multiple concurrent callers before the first resolves would otherwise
// each create a separate WasmQueryEngine instance.
let enginePromise: Promise<QueryEngine> | null = null;

export async function getQueryEngine(): Promise<QueryEngine> {
	if (!enginePromise) {
		enginePromise = (async () => {
			console.log('[query] Using WASM DuckDB engine (browser)');
			const { WasmQueryEngine } = await import('./wasm');
			return new WasmQueryEngine();
		})();
		// If init fails, clear the promise so it can be retried
		enginePromise.catch(() => {
			enginePromise = null;
		});
	}
	return enginePromise;
}

export type {
	MapQueryHandle,
	MapQueryResult,
	QueryEngine,
	QueryHandle,
	QueryResult,
	SchemaField
} from './engine';
export { QueryCancelledError } from './engine';
