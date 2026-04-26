/**
 * Tiny insertion-order LRU built on top of `Map`. `get` / `has` move the entry
 * to the most-recent slot, `set` evicts the oldest (and runs `onEvict`) once
 * the cap is exceeded.
 *
 * Keeps the implementation deliberately small. Used by viewer modules that
 * cache per-source resources (GeoTIFF headers, presigned URLs) which would
 * otherwise leak across long pan / viewport-reload sessions.
 */

export interface LruCacheOptions<K, V> {
	/** Maximum number of entries. Must be > 0. */
	max: number;
	/** Called when an entry is evicted (LRU overflow or `delete()`). */
	onEvict?: (key: K, value: V) => void;
}

export class LruCache<K, V> {
	private map = new Map<K, V>();
	readonly max: number;
	private onEvict?: (key: K, value: V) => void;

	constructor(opts: LruCacheOptions<K, V>) {
		if (opts.max <= 0) throw new Error('LruCache: max must be > 0');
		this.max = opts.max;
		this.onEvict = opts.onEvict;
	}

	get size(): number {
		return this.map.size;
	}

	has(key: K): boolean {
		return this.map.has(key);
	}

	get(key: K): V | undefined {
		const v = this.map.get(key);
		if (v === undefined) return undefined;
		// Move-to-end so this entry is now most-recent.
		this.map.delete(key);
		this.map.set(key, v);
		return v;
	}

	set(key: K, value: V): void {
		if (this.map.has(key)) {
			this.map.delete(key);
		}
		this.map.set(key, value);
		while (this.map.size > this.max) {
			const oldest = this.map.keys().next().value;
			if (oldest === undefined) break;
			const evicted = this.map.get(oldest) as V;
			this.map.delete(oldest);
			this.onEvict?.(oldest, evicted);
		}
	}

	delete(key: K): boolean {
		const v = this.map.get(key);
		if (v === undefined) return false;
		this.map.delete(key);
		this.onEvict?.(key, v);
		return true;
	}

	clear(): void {
		if (this.onEvict) {
			for (const [k, v] of this.map) this.onEvict(k, v);
		}
		this.map.clear();
	}
}
