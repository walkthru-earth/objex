import { jsonReplacerBigInt } from './format.js';

function triggerDownload(content: string, filename: string, mimeType: string) {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/** Format a cell value for export (empty string for null/undefined). */
function formatCellValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'object') return JSON.stringify(value, jsonReplacerBigInt);
	return String(value);
}

/**
 * Escape a CSV field value per RFC 4180.
 */
export function escapeCsvField(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/**
 * Serialize column/row data to a CSV string.
 * Pure function — no browser APIs, works in Node.js.
 */
export function serializeToCsv(columns: string[], rows: Record<string, unknown>[]): string {
	const header = columns.map(escapeCsvField).join(',');
	const body = rows
		.map((row) => columns.map((col) => escapeCsvField(formatCellValue(row[col]))).join(','))
		.join('\n');
	return `${header}\n${body}`;
}

/**
 * Serialize column/row data to a formatted JSON string.
 * Pure function — no browser APIs, works in Node.js.
 */
export function serializeToJson(columns: string[], rows: Record<string, unknown>[]): string {
	const data = rows.map((row) => {
		const obj: Record<string, unknown> = {};
		for (const col of columns) {
			const val = row[col];
			if (val instanceof Date) {
				obj[col] = val.toISOString();
			} else {
				obj[col] = val ?? null;
			}
		}
		return obj;
	});
	return JSON.stringify(data, jsonReplacerBigInt, 2);
}

/**
 * Export data as CSV file (triggers browser download).
 */
export function exportToCsv(columns: string[], rows: Record<string, unknown>[], filename: string) {
	triggerDownload(
		serializeToCsv(columns, rows),
		filename.endsWith('.csv') ? filename : `${filename}.csv`,
		'text/csv;charset=utf-8;'
	);
}

/**
 * Export data as JSON file (triggers browser download).
 */
export function exportToJson(columns: string[], rows: Record<string, unknown>[], filename: string) {
	triggerDownload(
		serializeToJson(columns, rows),
		filename.endsWith('.json') ? filename : `${filename}.json`,
		'application/json'
	);
}
