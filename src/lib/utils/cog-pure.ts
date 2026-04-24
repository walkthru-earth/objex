// Dependency-free subset of `cog.ts` so that `@walkthru-earth/objex-utils`
// can re-export these helpers without dragging in `@developmentseed/epsg`,
// `@developmentseed/geotiff`, `@developmentseed/proj`, `proj4`, or
// `maplibre-gl`. tsup preserves bare side-effect imports from externalized
// modules even when all named bindings are tree-shaken, so the pure surface
// MUST live in a module that has zero heavy imports.

/** SampleFormat tag value → human label. */
export const SF_LABELS: Record<number, string> = {
	1: 'uint',
	2: 'int',
	3: 'float',
	4: 'void',
	5: 'complex int',
	6: 'complex float'
};

export interface GeoBounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

export interface CogInfo {
	width: number;
	height: number;
	bandCount: number;
	dataType: string;
	bounds: GeoBounds;
	downsampled?: boolean;
}

/** Safely clamp a number to a range, treating NaN/Infinity as the fallback. */
export function safeClamp(v: number, lo: number, hi: number, fallback: number): number {
	return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}

/** Clamp geographic bounds to valid MapLibre web-Mercator range. */
export function clampBounds(b: GeoBounds): GeoBounds {
	return {
		west: safeClamp(b.west, -180, 180, -180),
		south: safeClamp(b.south, -85.051129, 85.051129, -85.051129),
		east: safeClamp(b.east, -180, 180, 180),
		north: safeClamp(b.north, -85.051129, 85.051129, 85.051129)
	};
}

/**
 * Build a data-type label from GeoTIFF sample format and bits per sample.
 * e.g. "uint8", "float32", "int16"
 */
export function buildDataTypeLabel(sampleFormat: number, bitsPerSample: number): string {
	return `${SF_LABELS[sampleFormat] ?? `sf${sampleFormat}`}${bitsPerSample ?? ''}`;
}
