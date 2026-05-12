/**
 * Direct WKB → GeoArrow bridge (zero-copy).
 *
 * Reads raw WKB binary directly into pre-allocated Arrow typed arrays
 * without any intermediate JS object allocation. No parseWKB(), no GeoJSON.
 *
 * Data flow: WKB Uint8Array[] → DataView binary reads → Float64Array/Int32Array
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
	/** Maps local table row index → original WKB array index (for selection lookup). */
	sourceIndices: number[];
}

/** Map DuckDB ST_GeometryType output to our normalized type. */
export function normalizeGeomType(raw: string): GeoArrowGeomType {
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

// ─── WKB binary header reader ────────────────────────────────────────

interface WkbHeader {
	type: number; // base geometry type (1–6)
	le: boolean; // little-endian
	coordStride: number; // bytes per coordinate point (16=2D, 24=3D/M, 32=ZM)
	dataOffset: number; // byte offset where geometry data begins
}

/** Read WKB/EWKB header — 5 bytes + optional SRID. No allocations. */
function readWkbHeader(wkb: Uint8Array): WkbHeader | null {
	if (wkb.length < 5) return null;
	const le = wkb[0] === 1;
	const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
	const rawType = dv.getUint32(1, le);

	let headerSize = 5; // byte_order(1) + type(4)

	// EWKB SRID flag — 4 extra bytes after type
	if ((rawType & 0x20000000) !== 0) headerSize += 4;

	// EWKB dimension flags
	const ewkbZ = (rawType & 0x80000000) !== 0;
	const ewkbM = (rawType & 0x40000000) !== 0;

	// Strip all EWKB flags to get base type
	let type = rawType & 0x0fffffff;

	// ISO Z/M ranges: 1001–1006 (Z), 2001–2006 (M), 3001–3006 (ZM)
	let isoZ = false;
	let isoM = false;
	if (type > 3000) {
		isoZ = true;
		isoM = true;
		type -= 3000;
	} else if (type > 2000) {
		isoM = true;
		type -= 2000;
	} else if (type > 1000) {
		isoZ = true;
		type -= 1000;
	}

	const dims = (ewkbZ || isoZ ? 1 : 0) + (ewkbM || isoM ? 1 : 0);
	const coordStride = (2 + dims) * 8; // 16, 24, or 32 bytes

	return { type, le, coordStride, dataOffset: headerSize };
}

/** Classify WKB type from first 5 bytes. No full parse. */
function classifyWkbType(wkb: Uint8Array): GeoArrowGeomType | null {
	const h = readWkbHeader(wkb);
	if (!h) return null;
	switch (h.type) {
		case 1:
			return 'point';
		case 2:
			return 'linestring';
		case 3:
			return 'polygon';
		case 4:
			return 'multipoint';
		case 5:
			return 'multilinestring';
		case 6:
			return 'multipolygon';
		default:
			return null;
	}
}

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

/** Update bounds, skipping NaN coordinates (EMPTY geometries, invalid data). */
function expandBounds(b: BoundsTracker, x: number, y: number) {
	if (Number.isNaN(x) || Number.isNaN(y)) return;
	if (x < b.minX) b.minX = x;
	if (y < b.minY) b.minY = y;
	if (x > b.maxX) b.maxX = x;
	if (y > b.maxY) b.maxY = y;
}

// ─── Arrow coordinate type (shared) ─────────────────────────────────

const coordField = new Field('xy', new Float64());
const coordType = new FixedSizeList(2, coordField);

/** Build FixedSizeList<Float64> Data from a pre-allocated Float64Array. */
function makeCoordData(coords: Float64Array, numPoints: number): Data<FixedSizeList> {
	const floatData = makeData({ type: new Float64(), length: coords.length, data: coords });
	return makeData({ type: coordType, length: numPoints, nullCount: 0, child: floatData });
}

// ─── Direct WKB → Arrow builders (zero intermediate objects) ─────────

/**
 * POINT: [byte_order:1][type:4][x:8][y:8]
 * Direct read — 2 Float64 reads per geometry. Zero parseWKB.
 */
function buildPointData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	const n = wkbs.length;
	const coords = new Float64Array(n * 2);

	for (let i = 0; i < n; i++) {
		const wkb = wkbs[i];
		const h = readWkbHeader(wkb);
		if (!h || h.type !== 1) {
			coords[i * 2] = 0;
			coords[i * 2 + 1] = 0;
			continue;
		}
		const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
		const x = dv.getFloat64(h.dataOffset, h.le);
		const y = dv.getFloat64(h.dataOffset + 8, h.le);
		coords[i * 2] = x;
		coords[i * 2 + 1] = y;
		expandBounds(b, x, y);
	}

	return makeCoordData(coords, n);
}

/**
 * LINESTRING: [byte_order:1][type:4][num_points:4][x:8,y:8 × n]
 * Two-pass: count first to pre-allocate, then extract.
 */
function buildLineStringData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	const n = wkbs.length;
	const geomOffsets = new Int32Array(n + 1);
	let totalCoords = 0;

	// Pass 1: count coordinates
	for (let i = 0; i < n; i++) {
		geomOffsets[i] = totalCoords;
		const h = readWkbHeader(wkbs[i]);
		if (!h || h.type !== 2) continue;
		const dv = new DataView(wkbs[i].buffer, wkbs[i].byteOffset, wkbs[i].byteLength);
		const numPts = dv.getUint32(h.dataOffset, h.le);
		totalCoords += numPts;
	}
	geomOffsets[n] = totalCoords;

	// Pass 2: extract coordinates directly from binary
	const coords = new Float64Array(totalCoords * 2);
	let ci = 0;

	for (const wkb of wkbs) {
		const h = readWkbHeader(wkb);
		if (!h || h.type !== 2) continue;
		const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
		const numPts = dv.getUint32(h.dataOffset, h.le);
		let off = h.dataOffset + 4;
		for (let j = 0; j < numPts; j++) {
			const x = dv.getFloat64(off, h.le);
			const y = dv.getFloat64(off + 8, h.le);
			coords[ci++] = x;
			coords[ci++] = y;
			expandBounds(b, x, y);
			off += h.coordStride;
		}
	}

	const fslData = makeCoordData(coords, totalCoords);
	const listType = new List(new Field('vertices', coordType));
	return makeData({
		type: listType,
		length: n,
		nullCount: 0,
		valueOffsets: geomOffsets,
		child: fslData
	});
}

/**
 * POLYGON: [byte_order:1][type:4][num_rings:4]
 *   { [num_points:4][x:8,y:8 × n] } × rings
 * Two-pass: count rings+coords first, then extract.
 */
function buildPolygonData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	const n = wkbs.length;
	const geomOffsets = new Int32Array(n + 1);
	let totalRings = 0;
	let totalCoords = 0;

	// Pass 1: count rings and coordinates
	for (let i = 0; i < n; i++) {
		geomOffsets[i] = totalRings;
		const h = readWkbHeader(wkbs[i]);
		if (!h || h.type !== 3) continue;
		const dv = new DataView(wkbs[i].buffer, wkbs[i].byteOffset, wkbs[i].byteLength);
		const numRings = dv.getUint32(h.dataOffset, h.le);
		let off = h.dataOffset + 4;
		for (let r = 0; r < numRings; r++) {
			const numPts = dv.getUint32(off, h.le);
			off += 4 + numPts * h.coordStride;
			totalCoords += numPts;
			totalRings++;
		}
	}
	geomOffsets[n] = totalRings;

	// Pass 2: extract coordinates and ring offsets
	const ringOffsets = new Int32Array(totalRings + 1);
	const coords = new Float64Array(totalCoords * 2);
	let ri = 0;
	let ci = 0;

	for (const wkb of wkbs) {
		const h = readWkbHeader(wkb);
		if (!h || h.type !== 3) continue;
		const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
		const numRings = dv.getUint32(h.dataOffset, h.le);
		let off = h.dataOffset + 4;
		for (let r = 0; r < numRings; r++) {
			ringOffsets[ri++] = ci >> 1; // coordIndex = ci / 2
			const numPts = dv.getUint32(off, h.le);
			off += 4;
			for (let j = 0; j < numPts; j++) {
				const x = dv.getFloat64(off, h.le);
				const y = dv.getFloat64(off + 8, h.le);
				coords[ci++] = x;
				coords[ci++] = y;
				expandBounds(b, x, y);
				off += h.coordStride;
			}
		}
	}
	ringOffsets[totalRings] = ci >> 1;

	const coordCount = ci >> 1;
	const fslData = makeCoordData(coords, coordCount);

	const ringListType = new List(new Field('vertices', coordType));
	const ringListData = makeData({
		type: ringListType,
		length: totalRings,
		nullCount: 0,
		valueOffsets: ringOffsets,
		child: fslData
	});

	const polyType = new List(new Field('rings', ringListType));
	return makeData({
		type: polyType,
		length: n,
		nullCount: 0,
		valueOffsets: geomOffsets,
		child: ringListData
	});
}

/** MultiPoint has same Arrow structure as LineString: List<FixedSizeList(2)>. */
function buildMultiPointData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	// MultiPoint WKB: [header][num_points:4]{Point WKB × n}
	// Each inner point has its own WKB header.
	const n = wkbs.length;
	const geomOffsets = new Int32Array(n + 1);
	let totalCoords = 0;

	// Pass 1: count
	for (let i = 0; i < n; i++) {
		geomOffsets[i] = totalCoords;
		const h = readWkbHeader(wkbs[i]);
		if (!h || h.type !== 4) continue;
		const dv = new DataView(wkbs[i].buffer, wkbs[i].byteOffset, wkbs[i].byteLength);
		totalCoords += dv.getUint32(h.dataOffset, h.le);
	}
	geomOffsets[n] = totalCoords;

	// Pass 2: extract from inner point WKBs
	const coords = new Float64Array(totalCoords * 2);
	let ci = 0;

	for (const wkb of wkbs) {
		const h = readWkbHeader(wkb);
		if (!h || h.type !== 4) continue;
		const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
		const numPts = dv.getUint32(h.dataOffset, h.le);
		let off = h.dataOffset + 4;
		for (let j = 0; j < numPts; j++) {
			// Each inner point is a full WKB: skip its header to get coords
			const innerH = readWkbHeader(
				new Uint8Array(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off)
			);
			if (innerH) {
				const x = dv.getFloat64(off + innerH.dataOffset, innerH.le);
				const y = dv.getFloat64(off + innerH.dataOffset + 8, innerH.le);
				coords[ci++] = x;
				coords[ci++] = y;
				expandBounds(b, x, y);
				off += innerH.dataOffset + innerH.coordStride;
			} else {
				coords[ci++] = 0;
				coords[ci++] = 0;
				off += 21; // minimum point WKB size
			}
		}
	}

	const fslData = makeCoordData(coords, totalCoords);
	const listType = new List(new Field('vertices', coordType));
	return makeData({
		type: listType,
		length: n,
		nullCount: 0,
		valueOffsets: geomOffsets,
		child: fslData
	});
}

/**
 * MULTILINESTRING: [header][num_lines:4]{LineString WKB × n}
 * Each inner LineString has its own WKB header.
 */
function buildMultiLineStringData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	const n = wkbs.length;
	const geomOffsetsArr: number[] = [0];
	let totalLines = 0;
	let totalCoords = 0;

	// Pass 1: count lines and coordinates
	for (const wkb of wkbs) {
		const h = readWkbHeader(wkb);
		if (!h || h.type !== 5) {
			geomOffsetsArr.push(totalLines);
			continue;
		}
		const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
		const numLines = dv.getUint32(h.dataOffset, h.le);
		let off = h.dataOffset + 4;
		for (let l = 0; l < numLines; l++) {
			const innerH = readWkbHeader(
				new Uint8Array(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off)
			);
			if (!innerH) break;
			const innerDv = new DataView(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off);
			const numPts = innerDv.getUint32(innerH.dataOffset, innerH.le);
			totalCoords += numPts;
			off += innerH.dataOffset + 4 + numPts * innerH.coordStride;
			totalLines++;
		}
		geomOffsetsArr.push(totalLines);
	}

	// Pass 2: extract
	const geomOffsets = new Int32Array(geomOffsetsArr);
	const lineOffsets = new Int32Array(totalLines + 1);
	const coords = new Float64Array(totalCoords * 2);
	let li = 0;
	let ci = 0;

	for (const wkb of wkbs) {
		const h = readWkbHeader(wkb);
		if (!h || h.type !== 5) continue;
		const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
		const numLines = dv.getUint32(h.dataOffset, h.le);
		let off = h.dataOffset + 4;
		for (let l = 0; l < numLines; l++) {
			lineOffsets[li++] = ci >> 1;
			const innerH = readWkbHeader(
				new Uint8Array(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off)
			);
			if (!innerH) break;
			const numPts = new DataView(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off).getUint32(
				innerH.dataOffset,
				innerH.le
			);
			let ptOff = off + innerH.dataOffset + 4;
			for (let j = 0; j < numPts; j++) {
				const x = dv.getFloat64(ptOff, innerH.le);
				const y = dv.getFloat64(ptOff + 8, innerH.le);
				coords[ci++] = x;
				coords[ci++] = y;
				expandBounds(b, x, y);
				ptOff += innerH.coordStride;
			}
			off = ptOff;
		}
	}
	lineOffsets[totalLines] = ci >> 1;

	const fslData = makeCoordData(coords, ci >> 1);
	const lineListType = new List(new Field('vertices', coordType));
	const lineListData = makeData({
		type: lineListType,
		length: totalLines,
		nullCount: 0,
		valueOffsets: lineOffsets,
		child: fslData
	});

	const multiLineType = new List(new Field('lines', lineListType));
	return makeData({
		type: multiLineType,
		length: n,
		nullCount: 0,
		valueOffsets: geomOffsets,
		child: lineListData
	});
}

/**
 * MULTIPOLYGON: [header][num_polys:4]{Polygon WKB × n}
 * Each inner Polygon has its own WKB header.
 */
function buildMultiPolygonData(wkbs: Uint8Array[], b: BoundsTracker): Data {
	const n = wkbs.length;
	const geomOffsetsArr: number[] = [0];
	let totalPolys = 0;
	let totalRings = 0;
	let totalCoords = 0;

	// Pass 1: count polygons, rings, coordinates
	for (const wkb of wkbs) {
		const h = readWkbHeader(wkb);
		if (!h || h.type !== 6) {
			geomOffsetsArr.push(totalPolys);
			continue;
		}
		const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
		const numPolys = dv.getUint32(h.dataOffset, h.le);
		let off = h.dataOffset + 4;
		for (let p = 0; p < numPolys; p++) {
			const innerH = readWkbHeader(
				new Uint8Array(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off)
			);
			if (!innerH) break;
			const innerDv = new DataView(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off);
			const numRings = innerDv.getUint32(innerH.dataOffset, innerH.le);
			let ringOff = innerH.dataOffset + 4;
			for (let r = 0; r < numRings; r++) {
				const numPts = innerDv.getUint32(ringOff, innerH.le);
				ringOff += 4 + numPts * innerH.coordStride;
				totalCoords += numPts;
				totalRings++;
			}
			off += ringOff;
			totalPolys++;
		}
		geomOffsetsArr.push(totalPolys);
	}

	// Pass 2: extract
	const geomOffsets = new Int32Array(geomOffsetsArr);
	const polyOffsets = new Int32Array(totalPolys + 1);
	const ringOffsets = new Int32Array(totalRings + 1);
	const coords = new Float64Array(totalCoords * 2);
	let pi = 0;
	let ri = 0;
	let ci = 0;

	for (const wkb of wkbs) {
		const h = readWkbHeader(wkb);
		if (!h || h.type !== 6) continue;
		const dv = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
		const numPolys = dv.getUint32(h.dataOffset, h.le);
		let off = h.dataOffset + 4;
		for (let p = 0; p < numPolys; p++) {
			polyOffsets[pi++] = ri;
			const innerH = readWkbHeader(
				new Uint8Array(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off)
			);
			if (!innerH) break;
			const innerDv = new DataView(wkb.buffer, wkb.byteOffset + off, wkb.byteLength - off);
			const numRings = innerDv.getUint32(innerH.dataOffset, innerH.le);
			let ringOff = off + innerH.dataOffset + 4;
			for (let r = 0; r < numRings; r++) {
				ringOffsets[ri++] = ci >> 1;
				const numPts = dv.getUint32(ringOff, innerH.le);
				ringOff += 4;
				for (let j = 0; j < numPts; j++) {
					const x = dv.getFloat64(ringOff, innerH.le);
					const y = dv.getFloat64(ringOff + 8, innerH.le);
					coords[ci++] = x;
					coords[ci++] = y;
					expandBounds(b, x, y);
					ringOff += innerH.coordStride;
				}
			}
			off = ringOff;
		}
	}
	polyOffsets[totalPolys] = ri;
	ringOffsets[totalRings] = ci >> 1;

	const fslData = makeCoordData(coords, ci >> 1);

	const ringListType = new List(new Field('vertices', coordType));
	const ringListData = makeData({
		type: ringListType,
		length: totalRings,
		nullCount: 0,
		valueOffsets: ringOffsets,
		child: fslData
	});

	const polyListType = new List(new Field('rings', ringListType));
	const polyListData = makeData({
		type: polyListType,
		length: totalPolys,
		nullCount: 0,
		valueOffsets: polyOffsets,
		child: ringListData
	});

	const multiPolyType = new List(new Field('polygons', polyListType));
	return makeData({
		type: multiPolyType,
		length: n,
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
		const sampleEnd = Math.min(n, 100);
		for (let i = 0; i < sampleEnd; i++) {
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
			const offsets = new Int32Array(n + 1);
			let totalBytes = 0;

			// Single pass: encode directly into a growing buffer
			const strParts: Uint8Array[] = [];
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
	const attrCols = buildAttributeColumns(indices, attributes);

	const fields: Field[] = [geomField, ...attrCols.fields];
	const childrenData: Data[] = [geomData, ...attrCols.data];

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
		bounds: [b.minX, b.minY, b.maxX, b.maxY],
		sourceIndices: indices
	};
}

// ─── Main entry point ────────────────────────────────────────────────

/**
 * Build GeoArrow tables from raw WKB arrays, automatically splitting by geometry type.
 * Returns one GeoArrowResult per non-empty type group, with shared merged bounds.
 *
 * @param wkbArrays Raw WKB binary arrays from DuckDB
 * @param attributes Attribute columns (non-geometry)
 * @param knownGeomType If provided (e.g. from GeoParquet metadata), skip classification
 */
export function buildGeoArrowTables(
	wkbArrays: Uint8Array[],
	attributes: Map<string, { values: any[]; type: string }>,
	knownGeomType?: GeoArrowGeomType
): GeoArrowResult[] {
	if (wkbArrays.length === 0) return [];

	// Fast path: known geometry type from metadata — skip classification entirely
	if (knownGeomType) {
		const globalBounds = newBounds();
		const indices = Array.from({ length: wkbArrays.length }, (_, i) => i);
		const result = buildSingleTable(knownGeomType, wkbArrays, indices, attributes, globalBounds);
		return [result];
	}

	// Classify by reading only the type bytes (5 bytes per WKB, not full parse)
	const groups = new Map<GeoArrowGeomType, { wkbs: Uint8Array[]; indices: number[] }>();

	for (let i = 0; i < wkbArrays.length; i++) {
		const geomType = classifyWkbType(wkbArrays[i]);
		if (!geomType) continue;

		let group = groups.get(geomType);
		if (!group) {
			group = { wkbs: [], indices: [] };
			groups.set(geomType, group);
		}
		group.wkbs.push(wkbArrays[i]);
		group.indices.push(i);
	}

	if (groups.size === 0) return [];

	const globalBounds = newBounds();
	const results: GeoArrowResult[] = [];

	for (const [geomType, { wkbs, indices }] of groups) {
		const result = buildSingleTable(geomType, wkbs, indices, attributes, globalBounds);
		results.push(result);
	}

	// Share merged bounds across all results
	const mergedBounds: [number, number, number, number] = [
		globalBounds.minX,
		globalBounds.minY,
		globalBounds.maxX,
		globalBounds.maxY
	];
	for (const r of results) r.bounds = mergedBounds;

	return results;
}
