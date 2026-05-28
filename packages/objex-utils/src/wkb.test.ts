import { describe, expect, it } from 'vitest';
import { findGeoColumnFromRows } from './wkb.js';

describe('findGeoColumnFromRows', () => {
	const schema = [
		{ name: 'id', type: 'INTEGER' },
		{ name: 'geometry', type: 'BLOB' }
	];
	// Minimal valid little-endian WKB Point (0x01, type=1, x=0, y=0)
	const wkbPoint = new Uint8Array([
		0x01, 0x01, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
	]);

	it('finds the geometry column when row 0 is null but a later row has WKB', () => {
		const rows = [
			{ id: 1, geometry: null },
			{ id: 2, geometry: wkbPoint }
		];
		expect(findGeoColumnFromRows(rows, schema)).toBe('geometry');
	});

	it('still finds it when row 0 already has WKB (regression)', () => {
		const rows = [{ id: 1, geometry: wkbPoint }];
		expect(findGeoColumnFromRows(rows, schema)).toBe('geometry');
	});

	it('returns null when no row has geometry', () => {
		const rows = [
			{ id: 1, geometry: null },
			{ id: 2, geometry: null }
		];
		expect(findGeoColumnFromRows(rows, schema)).toBeNull();
	});
});
