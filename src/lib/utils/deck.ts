/**
 * Shared deck.gl utilities for map viewers.
 *
 * - GeoJSON overlay: used by FlatGeobufViewer
 * - GeoArrow overlay: used by GeoParquetMapViewer (zero-copy DuckDB → GPU pipeline)
 */

import type { GeoArrowResult } from './geoarrow.js';

// ─── GeoJSON overlay (FlatGeobufViewer) ──────────────────────────────

/** Lazy-load deck.gl modules (MapboxOverlay + GeoJsonLayer). */
export async function loadDeckModules() {
	const [{ MapboxOverlay }, { GeoJsonLayer }] = await Promise.all([
		import('@deck.gl/mapbox'),
		import('@deck.gl/layers')
	]);
	return { MapboxOverlay, GeoJsonLayer };
}

export interface DeckOverlayOptions {
	layerId: string;
	data: GeoJSON.FeatureCollection;
	fillColor?: [number, number, number, number];
	lineColor?: [number, number, number, number];
	onClick?: (feature: Record<string, any>) => void;
}

/**
 * Create a MapboxOverlay with a single GeoJsonLayer.
 * Returns the overlay instance ready to be added to a MapLibre map via `map.addControl()`.
 */
export function createDeckOverlay(
	modules: { MapboxOverlay: any; GeoJsonLayer: any },
	options: DeckOverlayOptions
) {
	const { MapboxOverlay, GeoJsonLayer } = modules;
	const {
		layerId,
		data,
		fillColor = [232, 121, 61, 110],
		lineColor = [230, 81, 0, 220],
		onClick
	} = options;

	return new MapboxOverlay({
		interleaved: false,
		layers: [
			new GeoJsonLayer({
				id: layerId,
				data,
				pickable: true,
				stroked: true,
				filled: true,
				pointType: 'circle',
				getFillColor: fillColor,
				getLineColor: lineColor,
				getPointRadius: 6,
				getLineWidth: 2.5,
				lineWidthMinPixels: 1.5,
				pointRadiusMinPixels: 4,
				pointRadiusMaxPixels: 12,
				autoHighlight: true,
				highlightColor: [255, 255, 255, 100],
				onClick: (info: any) => {
					if (info.object?.properties && onClick) {
						onClick({ ...info.object.properties });
					}
				}
			})
		]
	});
}

// ─── GeoArrow overlay (GeoParquetMapViewer) ──────────────────────────

/** Lazy-load GeoArrow deck.gl layers + MapboxOverlay. */
export async function loadGeoArrowModules() {
	const [{ MapboxOverlay }, geoarrowLayers] = await Promise.all([
		import('@deck.gl/mapbox'),
		import('@geoarrow/deck.gl-layers')
	]);
	return { MapboxOverlay, ...geoarrowLayers };
}

export interface GeoArrowOverlayOptions {
	layerId: string;
	geoArrowResults: GeoArrowResult[];
	fillColor?: [number, number, number, number];
	lineColor?: [number, number, number, number];
	onClick?: (properties: Record<string, any>) => void;
}

/** Create a single deck.gl layer for one GeoArrowResult. */
function createLayerForResult(
	modules: Record<string, any>,
	result: GeoArrowResult,
	layerId: string,
	fillColor: [number, number, number, number],
	lineColor: [number, number, number, number],
	onClick?: (properties: Record<string, any>) => void
): any {
	const { GeoArrowScatterplotLayer, GeoArrowPathLayer, GeoArrowPolygonLayer } = modules;
	const { table, geometryType } = result;

	if (geometryType === 'point' || geometryType === 'multipoint') {
		return new GeoArrowScatterplotLayer({
			id: layerId,
			data: table,
			getFillColor: fillColor,
			getRadius: 6,
			radiusUnits: 'pixels',
			radiusMinPixels: 4,
			radiusMaxPixels: 12,
			pickable: true,
			autoHighlight: true,
			highlightColor: [255, 255, 255, 100],
			_validate: false,
			onClick: (info: any) => onClick?.(extractPickedProps(info))
		});
	} else if (geometryType === 'linestring' || geometryType === 'multilinestring') {
		return new GeoArrowPathLayer({
			id: layerId,
			data: table,
			getColor: lineColor,
			getWidth: 2.5,
			widthUnits: 'pixels',
			widthMinPixels: 1.5,
			pickable: true,
			autoHighlight: true,
			highlightColor: [255, 255, 255, 100],
			_validate: false,
			onClick: (info: any) => onClick?.(extractPickedProps(info))
		});
	} else {
		return new GeoArrowPolygonLayer({
			id: layerId,
			data: table,
			getFillColor: fillColor,
			getLineColor: lineColor,
			getLineWidth: 2,
			lineWidthMinPixels: 1.5,
			pickable: true,
			autoHighlight: true,
			highlightColor: [255, 255, 255, 100],
			_validate: false,
			onClick: (info: any) => onClick?.(extractPickedProps(info))
		});
	}
}

/**
 * Create MapboxOverlay with GeoArrow layers — one per geometry type group.
 * Accepts an array of GeoArrowResults and renders them all in a single overlay.
 */
export function createGeoArrowOverlay(
	modules: Record<string, any>,
	options: GeoArrowOverlayOptions
) {
	const { MapboxOverlay } = modules;
	const {
		layerId,
		geoArrowResults,
		fillColor = [232, 121, 61, 110],
		lineColor = [230, 81, 0, 220],
		onClick
	} = options;

	const layers = geoArrowResults.map((result) =>
		createLayerForResult(
			modules,
			result,
			`${layerId}-${result.geometryType}`,
			fillColor,
			lineColor,
			onClick
		)
	);

	return new MapboxOverlay({ interleaved: false, layers });
}

/** Convert GeoArrow picking result to plain object (skip geometry column). */
function extractPickedProps(info: any): Record<string, any> {
	if (!info.object) return {};
	const props: Record<string, any> = {};
	for (const key of Object.keys(info.object)) {
		if (key !== 'geometry') props[key] = info.object[key];
	}
	return props;
}
