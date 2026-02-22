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

function formatValue(value: any): string {
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function escapeCsvField(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

export function exportToCsv(columns: string[], rows: Record<string, any>[], filename: string) {
	const header = columns.map(escapeCsvField).join(',');
	const body = rows
		.map((row) => columns.map((col) => escapeCsvField(formatValue(row[col]))).join(','))
		.join('\n');
	const csv = `${header}\n${body}`;
	triggerDownload(
		csv,
		filename.endsWith('.csv') ? filename : `${filename}.csv`,
		'text/csv;charset=utf-8;'
	);
}

export function exportToJson(columns: string[], rows: Record<string, any>[], filename: string) {
	const data = rows.map((row) => {
		const obj: Record<string, any> = {};
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
	const json = JSON.stringify(data, null, 2);
	triggerDownload(
		json,
		filename.endsWith('.json') ? filename : `${filename}.json`,
		'application/json'
	);
}
