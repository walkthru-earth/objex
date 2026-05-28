import { describe, expect, it } from 'vitest';
import { isWgs84 } from './crs.js';

describe('isWgs84', () => {
	it('accepts the canonical WGS84 numeric codes', () => {
		expect(isWgs84(4326)).toBe(true);
		expect(isWgs84(4979)).toBe(true);
	});
	it('accepts the canonical WGS84 string forms', () => {
		expect(isWgs84('EPSG:4326')).toBe(true);
		expect(isWgs84('OGC:CRS84')).toBe(true);
		expect(isWgs84('epsg:4326')).toBe(true);
	});
	it('rejects projected / other CRS', () => {
		expect(isWgs84(3857)).toBe(false);
		expect(isWgs84('EPSG:3857')).toBe(false);
		expect(isWgs84(4267)).toBe(false); // NAD27 is a datum, not WGS84
	});
	it('handles null/undefined/garbage', () => {
		expect(isWgs84(null)).toBe(false);
		expect(isWgs84(undefined)).toBe(false);
		expect(isWgs84('')).toBe(false);
		expect(isWgs84(NaN)).toBe(false);
	});
});
