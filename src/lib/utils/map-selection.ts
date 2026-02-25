/**
 * Shared selection highlight for all map viewers.
 *
 * Adds a MapLibre GeoJSON source + yellow outline layers that render
 * on top of any data layer (deck.gl or native MapLibre).
 * Works because every viewer uses MapLibre as its base map.
 */
import type maplibregl from 'maplibre-gl';

const SOURCE_ID = 'selection-highlight';
const SELECTION_COLOR = '#ffc800'; // QGIS-style yellow

/** Add an empty GeoJSON source + outline layers to the map. Call once in onMapReady. */
export function setupSelectionLayer(map: maplibregl.Map) {
	if (map.getSource(SOURCE_ID)) return; // idempotent

	map.addSource(SOURCE_ID, {
		type: 'geojson',
		data: { type: 'FeatureCollection', features: [] }
	});

	// Polygon / line outline
	map.addLayer({
		id: 'selection-outline',
		type: 'line',
		source: SOURCE_ID,
		paint: {
			'line-color': SELECTION_COLOR,
			'line-width': 3,
			'line-opacity': 1
		}
	});

	// Point halo
	map.addLayer({
		id: 'selection-point',
		type: 'circle',
		source: SOURCE_ID,
		filter: ['==', '$type', 'Point'],
		paint: {
			'circle-radius': 10,
			'circle-color': 'transparent',
			'circle-stroke-color': SELECTION_COLOR,
			'circle-stroke-width': 3
		}
	});
}

/** Set or clear the selected feature. Pass null to clear. */
export function updateSelection(map: maplibregl.Map, feature: GeoJSON.Feature | null) {
	const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
	if (!source) return;
	source.setData({
		type: 'FeatureCollection',
		features: feature ? [feature] : []
	});
}
