export interface HexRow {
	offset: string;
	hex: string[];
	ascii: string;
}

/**
 * Generates a hex dump from binary data.
 * Returns rows of offset | hex bytes | ASCII representation.
 */
export function generateHexDump(data: Uint8Array, bytesPerRow = 16): HexRow[] {
	const rows: HexRow[] = [];

	for (let i = 0; i < data.length; i += bytesPerRow) {
		const slice = data.slice(i, i + bytesPerRow);
		const offset = i.toString(16).padStart(8, '0');

		const hex: string[] = [];
		for (let j = 0; j < bytesPerRow; j++) {
			if (j < slice.length) {
				hex.push(slice[j].toString(16).padStart(2, '0'));
			} else {
				hex.push('  ');
			}
		}

		let ascii = '';
		for (let j = 0; j < slice.length; j++) {
			const byte = slice[j];
			ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
		}

		rows.push({ offset, hex, ascii });
	}

	return rows;
}
