/**
 * WKB → GeoArrow bridge.
 *
 * Converts raw WKB binary arrays (from DuckDB ST_AsWKB) into an Apache Arrow v21
 * Table with GeoArrow extension metadata, suitable for @geoarrow/deck.gl-layers.
 *
 * Data flow: DuckDB WKB Uint8Array[] → flat coordinate buffers + offset arrays
 *            → arrow.makeData() → arrow.Table with ARROW:extension:name metadata
 */

import type { Data } from 'apache-arrow';
import {
	Field,
	FixedSizeList,
	Float64,
	List,
	makeData,
	RecordBatch,
	Schema,
	Struct,
	Table,
	Utf8
} from 'apache-arrow';
import { parseWKB } from './wkb.js';

export type GeoArrowGeomType =
	| 'point'
	| 'linestring'
	| 'polygon'
	| 'multipoint'
	| 'multilinestring'
	| 'multipolygon';

export interface GeoArrowResult {
	table: Table;
	geometryType: GeoArrowGeomType;
	bounds: [number, number, number, number]; // [minX, minY, maxX, maxY]
}

/** Map DuckDB ST_GeometryType output to our normalized type. */
function normalizeGeomType(raw: string): GeoArrowGeomType {
	const s = raw.toUpperCase().replace(/\s+/g, '');
	if (s === 'POINT') return 'point';
	if (s === 'LINESTRING') return 'linestring';
	if (s === 'POLYGON') return 'polygon';
	if (s === 'MULTIPOINT') return 'multipoint';
	if (s === 'MULTILINESTRING') return 'multilinestring';
	if (s === 'MULTIPOLYGON') return 'multipolygon';
	return 'polygon'; // fallback
}

/** GeoArrow extension name for each geometry type. */
const EXTENSION_NAMES: Record<GeoArrowGeomType, string> = {
	point: 'geoarrow.point',
	linestring: 'geoarrow.linestring',
	polygon: 'geoarrow.polygon',
	multipoint: 'geoarrow.multipoint',
	multilinestring: 'geoarrow.multilinestring',
	multipolygon: 'geoarrow.multipolygon'
};

// ─── Bounds tracking ─────────────────────────────────────────────────

interface BoundsTracker {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function newBounds(): BoundsTracker {
	return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function updateBounds(b: BoundsTracker, x: number, y: number) {
	if (x < b.minX) b.minX = x;
	if (y < b.minY) b.minY = y;
	if (x > b.maxX) b.maxX = x;
	if (y > b.maxY) b.maxY = y;
}

// ─── Helper: build the inner FixedSizeList(2, Float64) coord Data ────

/** FixedSizeList(2, Float64) — the coordinate type for interleaved 2D. */
const coordField = new Field('xy', new Float64());
const coordType = new FixedSizeList(2, coordField);

/** Build FixedSizeList<Float64> Data from flat coordinate array and point count. */
function makeCoordData(flatCoords: number[], numPoints: number): Data<FixedSizeList> {
	const values = new Float64Array(flatCoords);
	const floatData = makeData({ type: new Float64(), length: values.length, data: values });
	return makeData({ type: coordType, length: numPoints, nullCount: 0, child: floatData });
}

// ─── Arrow Data builders per geometry type ───────────────────────────

function buildPointData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	const allCoords: number[] = [];

	for (const wkb of wkbs) {
		const parsed = parseWKB(wkb);
		if (!parsed || parsed.type !== 'Point') {
			allCoords.push(0, 0);
			continue;
		}
		const pt = parsed.coordinates as number[];
		allCoords.push(pt[0], pt[1]);
		updateBounds(b, pt[0], pt[1]);
	}

	return makeCoordData(allCoords, wkbs.length);
}

function buildLineStringData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	const allCoords: number[] = [];
	const geomOffsets = new Int32Array(wkbs.length + 1);
	let coordIdx = 0;

	for (let i = 0; i < wkbs.length; i++) {
		geomOffsets[i] = coordIdx;
		const parsed = parseWKB(wkbs[i]);
		if (!parsed || (parsed.type !== 'LineString' && parsed.type !== 'MultiPoint')) continue;
		const pts = parsed.coordinates as number[][];
		for (const pt of pts) {
			allCoords.push(pt[0], pt[1]);
			updateBounds(b, pt[0], pt[1]);
			coordIdx++;
		}
	}
	geomOffsets[wkbs.length] = coordIdx;

	const fslData = makeCoordData(allCoords, coordIdx);
	const listType = new List(new Field('vertices', coordType));
	return makeData({
		type: listType,
		length: wkbs.length,
		nullCount: 0,
		valueOffsets: geomOffsets,
		child: fslData
	});
}

function buildPolygonData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	const allCoords: number[] = [];
	const geomOffsets = new Int32Array(wkbs.length + 1);
	const ringOffsetsArr: number[] = [0];
	let ringIdx = 0;
	let coordIdx = 0;

	for (let i = 0; i < wkbs.length; i++) {
		geomOffsets[i] = ringIdx;
		const parsed = parseWKB(wkbs[i]);
		if (!parsed || parsed.type !== 'Polygon') continue;
		const rings = parsed.coordinates as number[][][];
		for (const ring of rings) {
			for (const pt of ring) {
				allCoords.push(pt[0], pt[1]);
				updateBounds(b, pt[0], pt[1]);
				coordIdx++;
			}
			ringIdx++;
			ringOffsetsArr.push(coordIdx);
		}
	}
	geomOffsets[wkbs.length] = ringIdx;

	const ringOffsets = new Int32Array(ringOffsetsArr);
	const fslData = makeCoordData(allCoords, coordIdx);

	// Ring level: List<FixedSizeList(2)>
	const ringListType = new List(new Field('vertices', coordType));
	const ringListData = makeData({
		type: ringListType,
		length: ringIdx,
		nullCount: 0,
		valueOffsets: ringOffsets,
		child: fslData
	});

	// Polygon level: List<List<FixedSizeList(2)>>
	const polyType = new List(new Field('rings', ringListType));
	return makeData({
		type: polyType,
		length: wkbs.length,
		nullCount: 0,
		valueOffsets: geomOffsets,
		child: ringListData
	});
}

function buildMultiPointData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	// MultiPoint has same Arrow structure as LineString: List<FixedSizeList(2)>
	return buildLineStringData(wkbs, b);
}

function buildMultiLineStringData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	// MultiLineString: List<List<FixedSizeList(2)>>
	const allCoords: number[] = [];
	const geomOffsets = new Int32Array(wkbs.length + 1);
	const lineOffsetsArr: number[] = [0];
	let lineIdx = 0;
	let coordIdx = 0;

	for (let i = 0; i < wkbs.length; i++) {
		geomOffsets[i] = lineIdx;
		const parsed = parseWKB(wkbs[i]);
		if (!parsed || parsed.type !== 'MultiLineString') continue;
		const lines = parsed.coordinates as number[][][];
		for (const line of lines) {
			for (const pt of line) {
				allCoords.push(pt[0], pt[1]);
				updateBounds(b, pt[0], pt[1]);
				coordIdx++;
			}
			lineIdx++;
			lineOffsetsArr.push(coordIdx);
		}
	}
	geomOffsets[wkbs.length] = lineIdx;

	const lineOffsets = new Int32Array(lineOffsetsArr);
	const fslData = makeCoordData(allCoords, coordIdx);

	const lineListType = new List(new Field('vertices', coordType));
	const lineListData = makeData({
		type: lineListType,
		length: lineIdx,
		nullCount: 0,
		valueOffsets: lineOffsets,
		child: fslData
	});

	const multiLineType = new List(new Field('lines', lineListType));
	return makeData({
		type: multiLineType,
		length: wkbs.length,
		nullCount: 0,
		valueOffsets: geomOffsets,
		child: lineListData
	});
}

function buildMultiPolygonData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	// MultiPolygon: List<List<List<FixedSizeList(2)>>>
	const allCoords: number[] = [];
	const geomOffsetsArr: number[] = [0];
	const polyOffsetsArr: number[] = [0];
	const ringOffsetsArr: number[] = [0];
	let polyIdx = 0;
	let ringIdx = 0;
	let coordIdx = 0;

	for (const wkb of wkbs) {
		const parsed = parseWKB(wkb);
		if (!parsed || parsed.type !== 'MultiPolygon') {
			geomOffsetsArr.push(polyIdx);
			continue;
		}
		const polys = parsed.coordinates as number[][][][];
		for (const poly of polys) {
			for (const ring of poly) {
				for (const pt of ring) {
					allCoords.push(pt[0], pt[1]);
					updateBounds(b, pt[0], pt[1]);
					coordIdx++;
				}
				ringIdx++;
				ringOffsetsArr.push(coordIdx);
			}
			polyIdx++;
			polyOffsetsArr.push(ringIdx);
		}
		geomOffsetsArr.push(polyIdx);
	}

	const geomOffsets = new Int32Array(geomOffsetsArr);
	const polyOffsets = new Int32Array(polyOffsetsArr);
	const ringOffsets = new Int32Array(ringOffsetsArr);

	const fslData = makeCoordData(allCoords, coordIdx);

	// Ring level: List<FSL>
	const ringListType = new List(new Field('vertices', coordType));
	const ringListData = makeData({
		type: ringListType,
		length: ringIdx,
		nullCount: 0,
		valueOffsets: ringOffsets,
		child: fslData
	});

	// Polygon level: List<List<FSL>>
	const polyListType = new List(new Field('rings', ringListType));
	const polyListData = makeData({
		type: polyListType,
		length: polyIdx,
		nullCount: 0,
		valueOffsets: polyOffsets,
		child: ringListData
	});

	// MultiPolygon level: List<List<List<FSL>>>
	const multiPolyType = new List(new Field('polygons', polyListType));
	return makeData({
		type: multiPolyType,
		length: wkbs.length,
		nullCount: 0,
		valueOffsets: geomOffsets,
		child: polyListData
	});
}

// ─── Build a single GeoArrow table for one type group ────────────────

/** Build attribute columns for a subset of rows identified by indices. */
function buildAttributeColumns(
	indices: number[],
	attributes: Map<string, { values: any[]; type: string }>
): { fields: Field[]; data: Data[] } {
	const n = indices.length;
	const fields: Field[] = [];
	const dataArr: Data[] = [];

	for (const [name, col] of attributes) {
		const { values } = col;

		// Detect whether values are numeric or string
		let isNumeric = true;
		for (let i = 0; i < Math.min(n, 100); i++) {
			if (values[indices[i]] != null && typeof values[indices[i]] !== 'number') {
				isNumeric = false;
				break;
			}
		}

		if (isNumeric) {
			const arr = new Float64Array(n);
			for (let i = 0; i < n; i++) arr[i] = values[indices[i]] ?? NaN;
			const data = makeData({ type: new Float64(), length: n, data: arr });
			fields.push(new Field(name, new Float64(), true));
			dataArr.push(data);
		} else {
			const encoder = new TextEncoder();
			const strParts: Uint8Array[] = [];
			const offsets = new Int32Array(n + 1);
			let totalBytes = 0;

			for (let i = 0; i < n; i++) {
				offsets[i] = totalBytes;
				const s = values[indices[i]] != null ? String(values[indices[i]]) : '';
				const encoded = encoder.encode(s);
				strParts.push(encoded);
				totalBytes += encoded.length;
			}
			offsets[n] = totalBytes;

			const valueBuffer = new Uint8Array(totalBytes);
			let pos = 0;
			for (const sv of strParts) {
				valueBuffer.set(sv, pos);
				pos += sv.length;
			}

			const data = makeData({
				type: new Utf8(),
				length: n,
				valueOffsets: offsets,
				data: valueBuffer
			});
			fields.push(new Field(name, new Utf8(), true));
			dataArr.push(data);
		}
	}

	return { fields, data: dataArr };
}

/** Build a single GeoArrow table for one geometry type group. */
function buildSingleTable(
	geomType: GeoArrowGeomType,
	wkbs: Uint8Array[],
	indices: number[],
	attributes: Map<string, { values: any[]; type: string }>,
	b: BoundsTracker
): GeoArrowResult {
	const n = wkbs.length;

	// Build geometry column Arrow Data
	let geomData: Data;
	switch (geomType) {
		case 'point':
			geomData = buildPointData(wkbs, b);
			break;
		case 'linestring':
			geomData = buildLineStringData(wkbs, b);
			break;
		case 'polygon':
			geomData = buildPolygonData(wkbs, b);
			break;
		case 'multipoint':
			geomData = buildMultiPointData(wkbs, b);
			break;
		case 'multilinestring':
			geomData = buildMultiLineStringData(wkbs, b);
			break;
		case 'multipolygon':
			geomData = buildMultiPolygonData(wkbs, b);
			break;
	}

	// Create geometry field with GeoArrow extension metadata
	const extensionName = EXTENSION_NAMES[geomType];
	const geomMetadata = new Map<string, string>([
		['ARROW:extension:name', extensionName],
		[
			'ARROW:extension:metadata',
			JSON.stringify({
				crs: {
					type: 'name',
					properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' }
				}
			})
		]
	]);

	const geomField = new Field('geometry', geomData.type, false, geomMetadata);

	// Build attribute columns (sliced to this group's indices)
	const attrCols = buildAttributeColumns(indices, attributes);

	const fields: Field[] = [geomField, ...attrCols.fields];
	const childrenData: Data[] = [geomData, ...attrCols.data];

	// Assemble Table via RecordBatch
	const arrowSchema = new Schema(fields);
	const structType = new Struct(fields);
	const structData = makeData({
		type: structType,
		length: n,
		nullCount: 0,
		children: childrenData
	});
	const batch = new RecordBatch(arrowSchema, structData);
	const table = new Table(arrowSchema, batch);

	return {
		table,
		geometryType: geomType,
		bounds: [b.minX, b.minY, b.maxX, b.maxY]
	};
}

// ─── Main entry point ────────────────────────────────────────────────

/** Map a WKB-parsed type name to GeoArrowGeomType, or null if unsupported. */
function wkbTypeToGeoArrow(type: string): GeoArrowGeomType | null {
	switch (type) {
		case 'Point':
			return 'point';
		case 'LineString':
			return 'linestring';
		case 'Polygon':
			return 'polygon';
		case 'MultiPoint':
			return 'multipoint';
		case 'MultiLineString':
			return 'multilinestring';
		case 'MultiPolygon':
			return 'multipolygon';
		default:
			return null; // Unknown, GeometryCollection — skip
	}
}

/**
 * Build GeoArrow tables from raw WKB arrays, automatically splitting by geometry type.
 * Returns one GeoArrowResult per non-empty type group, with shared merged bounds.
 */
export function buildGeoArrowTables(
	wkbArrays: Uint8Array[],
	attributes: Map<string, { values: any[]; type: string }>
): GeoArrowResult[] {
	// Classify each WKB by geometry type
	const groups = new Map<GeoArrowGeomType, { wkbs: Uint8Array[]; indices: number[] }>();

	for (let i = 0; i < wkbArrays.length; i++) {
		const parsed = parseWKB(wkbArrays[i]);
		if (!parsed) continue;
		const geomType = wkbTypeToGeoArrow(parsed.type);
		if (!geomType) continue; // skip Unknown / GeometryCollection

		let group = groups.get(geomType);
		if (!group) {
			group = { wkbs: [], indices: [] };
			groups.set(geomType, group);
		}
		group.wkbs.push(wkbArrays[i]);
		group.indices.push(i);
	}

	if (groups.size === 0) return [];

	// Build a table per group with shared bounds
	const globalBounds = newBounds();
	const results: GeoArrowResult[] = [];

	for (const [geomType, { wkbs, indices }] of groups) {
		const result = buildSingleTable(geomType, wkbs, indices, attributes, globalBounds);
		results.push(result);
	}

	// Stamp shared bounds across all results
	const mergedBounds: [number, number, number, number] = [
		globalBounds.minX,
		globalBounds.minY,
		globalBounds.maxX,
		globalBounds.maxY
	];
	for (const r of results) r.bounds = mergedBounds;

	return results;
}

/**
 * Build a single GeoArrow table (legacy convenience wrapper).
 * Delegates to buildGeoArrowTables and returns the first result,
 * or falls back to the specified geometryType if classification yields nothing.
 */
export function buildGeoArrowTable(
	wkbArrays: Uint8Array[],
	geometryType: string,
	attributes: Map<string, { values: any[]; type: string }>
): GeoArrowResult {
	const results = buildGeoArrowTables(wkbArrays, attributes);
	if (results.length > 0) return results[0];

	// Fallback: build empty table with the declared type
	const geomType = normalizeGeomType(geometryType);
	const b = newBounds();
	return buildSingleTable(geomType, [], [], attributes, b);
}
