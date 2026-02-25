import { type Header, PMTiles, Protocol } from 'pmtiles';

let protocol: Protocol | null = null;

export function getPmtilesProtocol(): Protocol {
	if (!protocol) {
		protocol = new Protocol();
	}
	return protocol;
}

export const TILE_TYPE_LABELS: Record<number, string> = {
	0: 'Unknown',
	1: 'MVT',
	2: 'PNG',
	3: 'JPEG',
	4: 'WebP',
	5: 'AVIF',
	6: 'MLT'
};

export const COMPRESSION_LABELS: Record<number, string> = {
	0: 'Unknown',
	1: 'None',
	2: 'Gzip',
	3: 'Brotli',
	4: 'Zstd'
};

/** Rich vector layer info from TileJSON metadata. */
export interface VectorLayerInfo {
	id: string;
	description?: string;
	minzoom?: number;
	maxzoom?: number;
	fields: Record<string, string>;
}

export interface PmtilesMetadata {
	specVersion: number;
	format: string;
	formatLabel: string;
	internalCompression: string;
	tileCompression: string;
	minZoom: number;
	maxZoom: number;
	bounds: [number, number, number, number] | null;
	center: [number, number] | null;
	centerZoom: number;
	clustered: boolean;
	numAddressedTiles: number;
	numTileEntries: number;
	numTileContents: number;
	layers: string[];
	vectorLayers: VectorLayerInfo[];
	jsonMetadata: Record<string, unknown> | null;
	header: Header;
	name?: string;
	description?: string;
	attribution?: string;
	version?: string;
}

const FORMAT_MAP: Record<number, string> = {
	1: 'mvt',
	2: 'png',
	3: 'jpeg',
	4: 'webp',
	5: 'avif',
	6: 'mlt'
};

function extractMetadata(
	header: Header,
	jsonMeta: Record<string, unknown> | null
): PmtilesMetadata {
	const tiletype = header.tileType;
	const format = FORMAT_MAP[tiletype] ?? 'unknown';

	const bounds: [number, number, number, number] | null =
		header.minLon !== undefined
			? [header.minLon, header.minLat, header.maxLon, header.maxLat]
			: null;

	const center: [number, number] | null =
		header.centerLon !== undefined ? [header.centerLon, header.centerLat] : null;

	const layers: string[] = [];
	const vectorLayers: VectorLayerInfo[] = [];
	if (jsonMeta && typeof jsonMeta === 'object' && 'vector_layers' in jsonMeta) {
		const vl = jsonMeta.vector_layers;
		if (Array.isArray(vl)) {
			for (const layer of vl) {
				if (layer.id) {
					layers.push(layer.id);
					vectorLayers.push({
						id: layer.id,
						description: layer.description,
						minzoom: layer.minzoom,
						maxzoom: layer.maxzoom,
						fields: layer.fields ?? {}
					});
				}
			}
		}
	}

	return {
		specVersion: header.specVersion,
		format,
		formatLabel: TILE_TYPE_LABELS[tiletype] ?? 'Unknown',
		internalCompression: COMPRESSION_LABELS[header.internalCompression] ?? 'Unknown',
		tileCompression: COMPRESSION_LABELS[header.tileCompression] ?? 'Unknown',
		minZoom: header.minZoom,
		maxZoom: header.maxZoom,
		bounds,
		center,
		centerZoom: header.centerZoom,
		clustered: header.clustered,
		numAddressedTiles: header.numAddressedTiles,
		numTileEntries: header.numTileEntries,
		numTileContents: header.numTileContents,
		layers,
		vectorLayers,
		jsonMetadata: jsonMeta,
		header,
		name: jsonMeta?.name as string | undefined,
		description: jsonMeta?.description as string | undefined,
		attribution: jsonMeta?.attribution as string | undefined,
		version: jsonMeta?.version as string | undefined
	};
}

/** Load a PMTiles archive and return both the instance and its metadata. */
export async function loadPmtiles(url: string): Promise<{
	pmtiles: PMTiles;
	metadata: PmtilesMetadata;
}> {
	const pmtiles = new PMTiles(url);
	const header = await pmtiles.getHeader();
	const jsonMeta = (await pmtiles.getMetadata()) as Record<string, unknown> | null;
	return { pmtiles, metadata: extractMetadata(header, jsonMeta) };
}

/**
 * Build vector tile layers for PMTiles source.
 * Each source layer gets a fill + line layer with distinct hue.
 */
export function buildPmtilesLayers(
	sourceId: string,
	metadata: PmtilesMetadata
): maplibregl.LayerSpecification[] {
	const layers: maplibregl.LayerSpecification[] = [];

	for (let i = 0; i < metadata.layers.length; i++) {
		const layerId = metadata.layers[i];
		const hue = (i * 137) % 360;

		layers.push({
			id: `${layerId}-fill`,
			type: 'fill',
			source: sourceId,
			'source-layer': layerId,
			paint: {
				'fill-color': `hsl(${hue}, 70%, 55%)`,
				'fill-opacity': 0.4
			}
		} as maplibregl.LayerSpecification);

		layers.push({
			id: `${layerId}-line`,
			type: 'line',
			source: sourceId,
			'source-layer': layerId,
			paint: {
				'line-color': `hsl(${hue}, 70%, 40%)`,
				'line-width': 1.5
			}
		} as maplibregl.LayerSpecification);

		layers.push({
			id: `${layerId}-circle`,
			type: 'circle',
			source: sourceId,
			'source-layer': layerId,
			filter: ['==', '$type', 'Point'],
			paint: {
				'circle-radius': 5,
				'circle-color': `hsl(${hue}, 70%, 55%)`,
				'circle-stroke-width': 1.5,
				'circle-stroke-color': '#fff'
			}
		} as maplibregl.LayerSpecification);
	}

	return layers;
}
