/**
 * Shared deck.gl utilities for map viewers.
 *
 * - GeoJSON overlay: used by FlatGeobufViewer
 * - GeoArrow overlay: used by GeoParquetMapViewer (zero-copy DuckDB → GPU pipeline)
 */

import type { GeoArrowResult } from './geoarrow.js';

// ─── Shared hover cursor helper ─────────────────────────────────────

/**
 * Create an onHover callback that toggles the cursor on the MapLibre canvas.
 * With `interleaved: false`, deck.gl's own canvas has pointer-events: none,
 * so getCursor on MapboxOverlay has no visible effect — we must set cursor
 * directly on the MapLibre map canvas instead.
 */
export function hoverCursor(map: { getCanvas: () => HTMLElement }) {
	return (info: { picked?: boolean }) => {
		map.getCanvas().style.cursor = info.picked ? 'pointer' : '';
	};
}

// ─── Geometry-type color palette ─────────────────────────────────────

type RGBA = [number, number, number, number];

/** Distinct fill/line colors per geometry type. */
export const GEOMETRY_COLORS: Record<string, { fill: RGBA; line: RGBA }> = {
	point: { fill: [66, 133, 244, 180], line: [25, 103, 210, 220] },
	linestring: { fill: [0, 172, 193, 160], line: [0, 131, 143, 220] },
	polygon: { fill: [232, 121, 61, 110], line: [230, 81, 0, 220] }
};

/** Lookup colors for a geometry type, falling back to polygon palette. */
function colorsForType(geomType: string): { fill: RGBA; line: RGBA } {
	const t = geomType.toLowerCase().replace('multi', '');
	return GEOMETRY_COLORS[t] ?? GEOMETRY_COLORS.polygon;
}

/**
 * GeoJSON accessor: return fill color based on feature geometry type.
 * Used as deck.gl accessor function for getFillColor / getLineColor.
 */
export function geojsonFillColor(feature: any): RGBA {
	return colorsForType(feature.geometry?.type ?? 'polygon').fill;
}

export function geojsonLineColor(feature: any): RGBA {
	return colorsForType(feature.geometry?.type ?? 'polygon').line;
}

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
	/** Called with properties and the full GeoJSON Feature (for selection highlight). */
	onClick?: (properties: Record<string, any>, feature: GeoJSON.Feature) => void;
	/** Layer-level onHover — use hoverCursor(map) to toggle pointer on MapLibre canvas. */
	onHover?: (info: { picked?: boolean }) => void;
}

/**
 * Create a MapboxOverlay with a single GeoJsonLayer.
 * Colors are assigned per-feature based on geometry type.
 */
export function createDeckOverlay(
	modules: { MapboxOverlay: any; GeoJsonLayer: any },
	options: DeckOverlayOptions
) {
	const { MapboxOverlay, GeoJsonLayer } = modules;
	const { layerId, data, onClick, onHover } = options;

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
				getFillColor: geojsonFillColor,
				getLineColor: geojsonLineColor,
				getPointRadius: 6,
				getLineWidth: 2.5,
				lineWidthMinPixels: 1.5,
				pointRadiusMinPixels: 4,
				pointRadiusMaxPixels: 12,
				autoHighlight: true,
				highlightColor: [255, 255, 255, 100],
				onHover,
				onClick: (info: any) => {
					if (info.object?.properties && onClick) {
						onClick({ ...info.object.properties }, info.object);
					}
				}
			})
		]
	});
}

// ─── GeoArrow overlay (GeoParquetMapViewer) ──────────────────────────

/** Lazy-load GeoArrow deck.gl layers + MapboxOverlay + GeoJsonLayer (for selection). */
export async function loadGeoArrowModules() {
	const [{ MapboxOverlay }, geoarrowLayers, { GeoJsonLayer }] = await Promise.all([
		import('@deck.gl/mapbox'),
		import('@geoarrow/deck.gl-layers'),
		import('@deck.gl/layers')
	]);
	return { MapboxOverlay, GeoJsonLayer, ...geoarrowLayers };
}

export interface GeoArrowOverlayOptions {
	layerId: string;
	geoArrowResults: GeoArrowResult[];
	/** Called with properties and the original WKB array index (for selection highlight). */
	onClick?: (properties: Record<string, any>, sourceIndex: number) => void;
	/** Layer-level onHover — use hoverCursor(map) to toggle pointer on MapLibre canvas. */
	onHover?: (info: { picked?: boolean }) => void;
}

/** Create a single deck.gl layer for one GeoArrowResult. */
function createLayerForResult(
	modules: Record<string, any>,
	result: GeoArrowResult,
	layerId: string,
	onClick?: (properties: Record<string, any>, sourceIndex: number) => void,
	onHover?: (info: { picked?: boolean }) => void
): any {
	const { GeoArrowScatterplotLayer, GeoArrowPathLayer, GeoArrowPolygonLayer } = modules;
	const { table, geometryType, sourceIndices } = result;
	const { fill, line } = colorsForType(geometryType);

	const handleClick = (info: any) => {
		if (!onClick) return;
		const props = extractPickedProps(info);
		const srcIdx = sourceIndices[info.index] ?? info.index;
		onClick(props, srcIdx);
	};

	if (geometryType === 'point' || geometryType === 'multipoint') {
		return new GeoArrowScatterplotLayer({
			id: layerId,
			data: table,
			getFillColor: fill,
			getRadius: 6,
			radiusUnits: 'pixels',
			radiusMinPixels: 4,
			radiusMaxPixels: 12,
			pickable: true,
			autoHighlight: true,
			highlightColor: [255, 255, 255, 100],
			_validate: false,
			onHover,
			onClick: handleClick
		});
	} else if (geometryType === 'linestring' || geometryType === 'multilinestring') {
		return new GeoArrowPathLayer({
			id: layerId,
			data: table,
			getColor: line,
			getWidth: 2.5,
			widthUnits: 'pixels',
			widthMinPixels: 1.5,
			pickable: true,
			autoHighlight: true,
			highlightColor: [255, 255, 255, 100],
			_validate: false,
			onHover,
			onClick: handleClick
		});
	} else {
		return new GeoArrowPolygonLayer({
			id: layerId,
			data: table,
			getFillColor: fill,
			getLineColor: line,
			getLineWidth: 2,
			lineWidthMinPixels: 1.5,
			pickable: true,
			autoHighlight: true,
			highlightColor: [255, 255, 255, 100],
			_validate: false,
			onHover,
			onClick: handleClick
		});
	}
}

/**
 * Create MapboxOverlay with GeoArrow layers — one per geometry type group.
 * Returns both the overlay and the data layers array (for adding selection layers later).
 */
export function createGeoArrowOverlay(
	modules: Record<string, any>,
	options: GeoArrowOverlayOptions
): { overlay: any; layers: any[] } {
	const { MapboxOverlay } = modules;
	const { layerId, geoArrowResults, onClick, onHover } = options;

	const layers = geoArrowResults.map((result) =>
		createLayerForResult(modules, result, `${layerId}-${result.geometryType}`, onClick, onHover)
	);

	return { overlay: new MapboxOverlay({ interleaved: false, layers }), layers };
}

/**
 * Create GeoArrow layers without an overlay — for in-place overlay updates.
 */
export function createGeoArrowLayers(
	modules: Record<string, any>,
	options: GeoArrowOverlayOptions
): any[] {
	const { layerId, geoArrowResults, onClick, onHover } = options;
	return geoArrowResults.map((result) =>
		createLayerForResult(modules, result, `${layerId}-${result.geometryType}`, onClick, onHover)
	);
}

// ─── Selection highlight layer (shared by deck.gl viewers) ──────────

/**
 * Build a deck.gl GeoJsonLayer that draws a yellow outline around a single feature.
 * Used for QGIS-style click-selection highlight on the deck.gl canvas (which sits
 * above MapLibre, so a native MapLibre layer would be hidden).
 */
export function buildSelectionLayer(
	GeoJsonLayer: any,
	feature: GeoJSON.Feature | null
): any | null {
	if (!feature) return null;
	return new GeoJsonLayer({
		id: 'selection-highlight',
		data: { type: 'FeatureCollection', features: [feature] },
		pickable: false,
		stroked: true,
		filled: false,
		pointType: 'circle',
		getLineColor: [255, 200, 0, 255],
		getLineWidth: 3,
		lineWidthMinPixels: 2,
		getPointRadius: 10,
		pointRadiusMinPixels: 8,
		pointRadiusMaxPixels: 14
	});
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
