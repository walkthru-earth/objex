export type TypeCategory =
	| 'number'
	| 'string'
	| 'date'
	| 'boolean'
	| 'geo'
	| 'binary'
	| 'json'
	| 'other';

const NUMBER_TYPES = [
	'TINYINT',
	'SMALLINT',
	'INTEGER',
	'BIGINT',
	'HUGEINT',
	'UTINYINT',
	'USMALLINT',
	'UINTEGER',
	'UBIGINT',
	'FLOAT',
	'DOUBLE',
	'DECIMAL',
	'NUMERIC',
	'REAL',
	'INT',
	'INT1',
	'INT2',
	'INT4',
	'INT8',
	'SIGNED',
	'SHORT',
	'LONG'
];

const STRING_TYPES = ['VARCHAR', 'TEXT', 'STRING', 'CHAR', 'BPCHAR', 'NAME', 'UUID', 'ENUM'];

const DATE_TYPES = [
	'DATE',
	'TIME',
	'TIMESTAMP',
	'TIMESTAMP_S',
	'TIMESTAMP_MS',
	'TIMESTAMP_NS',
	'TIMESTAMP WITH TIME ZONE',
	'TIMESTAMPTZ',
	'INTERVAL',
	'TIMESTAMP_TZ'
];

const BOOLEAN_TYPES = ['BOOLEAN', 'BOOL', 'LOGICAL'];

const GEO_TYPES = [
	'GEOMETRY',
	'POINT',
	'LINESTRING',
	'POLYGON',
	'MULTIPOINT',
	'MULTILINESTRING',
	'MULTIPOLYGON',
	'GEOMETRYCOLLECTION',
	'WKB_GEOMETRY'
];

const BINARY_TYPES = ['BLOB', 'BYTEA', 'BINARY', 'VARBINARY'];

const JSON_TYPES = ['JSON', 'JSONB'];

export function classifyType(duckdbType: string): TypeCategory {
	const upper = duckdbType.toUpperCase().trim();

	// Handle parameterized types like DECIMAL(18,3), VARCHAR(100)
	const base = upper.replace(/\(.*\)/, '').trim();

	if (NUMBER_TYPES.includes(base)) return 'number';
	if (STRING_TYPES.includes(base)) return 'string';
	if (DATE_TYPES.includes(base)) return 'date';
	if (BOOLEAN_TYPES.includes(base)) return 'boolean';
	if (GEO_TYPES.includes(base)) return 'geo';
	if (BINARY_TYPES.includes(base)) return 'binary';
	if (JSON_TYPES.includes(base)) return 'json';

	// Compound types
	if (base.startsWith('STRUCT') || base.startsWith('MAP') || base.startsWith('UNION'))
		return 'json';
	if (base.endsWith('[]') || base.startsWith('LIST')) return 'json';

	// Fallback checks
	if (
		upper.includes('INT') ||
		upper.includes('FLOAT') ||
		upper.includes('DOUBLE') ||
		upper.includes('DECIMAL') ||
		upper.includes('NUMERIC')
	)
		return 'number';
	if (upper.includes('CHAR') || upper.includes('TEXT') || upper.includes('STRING')) return 'string';
	if (upper.includes('TIME') || upper.includes('DATE')) return 'date';
	if (upper.includes('BOOL')) return 'boolean';
	if (upper.includes('GEOMETRY') || upper.includes('GEO') || upper.includes('WKB')) return 'geo';
	if (upper.includes('BLOB') || upper.includes('BINARY')) return 'binary';
	if (
		upper.includes('JSON') ||
		upper.includes('STRUCT') ||
		upper.includes('MAP') ||
		upper.includes('LIST')
	)
		return 'json';

	return 'other';
}

const TYPE_COLORS: Record<TypeCategory, string> = {
	number: 'text-blue-500',
	string: 'text-green-500',
	date: 'text-amber-500',
	boolean: 'text-purple-500',
	geo: 'text-teal-500',
	binary: 'text-zinc-500',
	json: 'text-orange-500',
	other: 'text-zinc-400'
};

const TYPE_BADGE_CLASSES: Record<TypeCategory, string> = {
	number: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
	string: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
	date: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
	boolean: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
	geo: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
	binary: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20',
	json: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
	other: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20'
};

const TYPE_LABELS: Record<TypeCategory, string> = {
	number: '#',
	string: 'Aa',
	date: 'dt',
	boolean: 'T/F',
	geo: 'geo',
	binary: '01',
	json: '{}',
	other: '?'
};

export function typeColor(category: TypeCategory): string {
	return TYPE_COLORS[category];
}

export function typeBadgeClass(category: TypeCategory): string {
	return TYPE_BADGE_CLASSES[category];
}

export function typeLabel(category: TypeCategory): string {
	return TYPE_LABELS[category];
}
