/**
 * PMTiles tile decoding utilities.
 *
 * Fetches individual tiles from a PMTiles archive and decodes MVT
 * vector tiles into a structure suitable for SVG rendering and
 * feature inspection.
 */

import type { PMTiles } from 'pmtiles';

export interface DecodedTile {
	z: number;
	x: number;
	y: number;
	layers: DecodedLayer[];
	rawSize: number;
}

export interface DecodedLayer {
	name: string;
	extent: number;
	features: DecodedFeature[];
}

export interface DecodedFeature {
	type: 'Point' | 'LineString' | 'Polygon' | 'Unknown';
	/** Raw tile coordinates (0..extent) — ring arrays. */
	geometry: number[][][];
	properties: Record<string, unknown>;
	id?: number;
}

const GEOM_TYPES = ['Unknown', 'Point', 'LineString', 'Polygon'] as const;

/**
 * Fetch and decode an MVT tile from a PMTiles archive.
 * Returns null if the tile does not exist or for raster archives.
 */
export async function decodeMvtTile(
	pmtiles: PMTiles,
	z: number,
	x: number,
	y: number
): Promise<DecodedTile | null> {
	const resp = await pmtiles.getZxy(z, x, y);
	if (!resp) return null;

	const bytes = new Uint8Array(resp.data);
	const rawSize = bytes.length;

	// Lazy-load @mapbox/vector-tile + pbf (only when inspector is opened)
	const [{ VectorTile }, { default: Pbf }] = await Promise.all([
		import('@mapbox/vector-tile'),
		import('pbf')
	]);

	const tile = new VectorTile(new Pbf(bytes));
	const layers: DecodedLayer[] = [];

	for (const [name, vtLayer] of Object.entries(tile.layers)) {
		const features: DecodedFeature[] = [];
		for (let i = 0; i < vtLayer.length; i++) {
			const f = vtLayer.feature(i);
			const rawGeom = f.loadGeometry();
			const geometry: number[][][] = rawGeom.map((ring) => ring.map((pt) => [pt.x, pt.y]));
			features.push({
				type: GEOM_TYPES[f.type] ?? 'Unknown',
				geometry,
				properties: f.properties as Record<string, unknown>,
				id: f.id
			});
		}
		layers.push({ name, extent: vtLayer.extent, features });
	}

	return { z, x, y, layers, rawSize };
}

/** Convert tile bytes to a Blob URL for raster tile preview. */
export async function tileToImageUrl(
	pmtiles: PMTiles,
	z: number,
	x: number,
	y: number,
	mimeType: string
): Promise<string | null> {
	const resp = await pmtiles.getZxy(z, x, y);
	if (!resp) return null;
	const blob = new Blob([resp.data], { type: mimeType });
	return URL.createObjectURL(blob);
}

/** MIME type for a PMTiles tile format string. */
export function tileMimeType(format: string): string {
	const map: Record<string, string> = {
		png: 'image/png',
		jpeg: 'image/jpeg',
		webp: 'image/webp',
		avif: 'image/avif'
	};
	return map[format] ?? 'application/octet-stream';
}

/** Compute the hue for layer index i (same palette as buildPmtilesLayers). */
export function layerHue(i: number): number {
	return (i * 137) % 360;
}
