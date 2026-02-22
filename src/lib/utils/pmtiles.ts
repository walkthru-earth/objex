import { PMTiles, Protocol } from 'pmtiles';

let protocol: Protocol | null = null;

export function getPmtilesProtocol(): Protocol {
	if (!protocol) {
		protocol = new Protocol();
	}
	return protocol;
}

const TILE_TYPE_LABELS: Record<number, string> = {
	0: 'Unknown',
	1: 'MVT',
	2: 'PNG',
	3: 'JPEG',
	4: 'WebP',
	5: 'AVIF',
	6: 'MLT'
};

const COMPRESSION_LABELS: Record<number, string> = {
	0: 'Unknown',
	1: 'None',
	2: 'Gzip',
	3: 'Brotli',
	4: 'Zstd'
};

export interface PmtilesMetadata {
	/** PMTiles spec version (e.g. 3) */
	specVersion: number;
	/** Tile format: mvt, png, jpeg, webp, avif, unknown */
	format: string;
	/** Human-readable tile format label */
	formatLabel: string;
	/** Internal (directory) compression */
	internalCompression: string;
	/** Tile data compression */
	tileCompression: string;
	/** Min zoom level */
	minZoom: number;
	/** Max zoom level */
	maxZoom: number;
	/** Geographic bounds [minLon, minLat, maxLon, maxLat] */
	bounds: [number, number, number, number] | null;
	/** Center point [lon, lat] */
	center: [number, number] | null;
	/** Center zoom level */
	centerZoom: number;
	/** Whether the archive is clustered (tiles ordered by Hilbert curve) */
	clustered: boolean;
	/** Total number of addressed tiles */
	numAddressedTiles: number;
	/** Number of unique tile entries in the directory */
	numTileEntries: number;
	/** Number of unique tile contents (deduplicated) */
	numTileContents: number;
	/** Vector tile layer names */
	layers: string[];
	/** JSON metadata: name */
	name?: string;
	/** JSON metadata: description */
	description?: string;
	/** JSON metadata: attribution */
	attribution?: string;
	/** JSON metadata: version */
	version?: string;
}

export async function getPmtilesMetadata(url: string): Promise<PmtilesMetadata> {
	const p = new PMTiles(url);
	const header = await p.getHeader();
	const jsonMeta = (await p.getMetadata()) as Record<string, unknown> | null;

	const tiletype = header.tileType;
	const formatMap: Record<number, string> = {
		1: 'mvt',
		2: 'png',
		3: 'jpeg',
		4: 'webp',
		5: 'avif',
		6: 'mlt'
	};
	const format = formatMap[tiletype] ?? 'unknown';

	const bounds: [number, number, number, number] | null =
		header.minLon !== undefined
			? [header.minLon, header.minLat, header.maxLon, header.maxLat]
			: null;

	const center: [number, number] | null =
		header.centerLon !== undefined ? [header.centerLon, header.centerLat] : null;

	// Extract layer names from vector_layers metadata
	const layers: string[] = [];
	if (jsonMeta && typeof jsonMeta === 'object' && 'vector_layers' in jsonMeta) {
		const vl = jsonMeta.vector_layers;
		if (Array.isArray(vl)) {
			for (const layer of vl) {
				if (layer.id) layers.push(layer.id);
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
		name: jsonMeta?.name as string | undefined,
		description: jsonMeta?.description as string | undefined,
		attribution: jsonMeta?.attribution as string | undefined,
		version: jsonMeta?.version as string | undefined
	};
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
	}

	return layers;
}
