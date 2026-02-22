import YAML from 'yaml';

export interface SqlBlock {
	name: string;
	sql: string;
	startLine: number;
	endLine: number;
}

export interface ParsedMarkdownDocument {
	frontmatter: Record<string, any>;
	content: string;
	sqlBlocks: SqlBlock[];
}

/**
 * Parse a markdown document with YAML frontmatter and SQL code blocks.
 *
 * Evidence-compatible syntax:
 * ```sql query_name
 * SELECT * FROM table
 * ```
 */
export function parseMarkdownDocument(markdown: string): ParsedMarkdownDocument {
	let frontmatter: Record<string, any> = {};
	let content = markdown;

	// Extract YAML frontmatter
	const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	if (fmMatch) {
		try {
			frontmatter = YAML.parse(fmMatch[1]) || {};
		} catch {
			// Invalid YAML — ignore
		}
		content = markdown.slice(fmMatch[0].length);
	}

	// Extract SQL blocks
	const sqlBlocks: SqlBlock[] = [];
	const lines = content.split('\n');
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		const match = line.match(/^```sql\s+(\w[\w-]*)\s*$/);

		if (match) {
			const name = match[1];
			const startLine = i;
			const sqlLines: string[] = [];
			i++;

			while (i < lines.length && lines[i] !== '```') {
				sqlLines.push(lines[i]);
				i++;
			}

			sqlBlocks.push({
				name,
				sql: sqlLines.join('\n'),
				startLine,
				endLine: i
			});
		}
		i++;
	}

	return { frontmatter, content, sqlBlocks };
}

/**
 * Interpolate template variables in markdown text.
 * Supports {queryName.rows[0].columnName} syntax.
 */
export function interpolateTemplates(
	text: string,
	queryResults: Map<string, Record<string, any>[]>
): string {
	return text.replace(/\{(\w+)\.rows\[(\d+)\]\.(\w+)\}/g, (match, queryName, rowIdx, colName) => {
		const rows = queryResults.get(queryName);
		if (!rows) return match;
		const row = rows[parseInt(rowIdx, 10)];
		if (!row) return match;
		const value = row[colName];
		return value !== undefined ? String(value) : match;
	});
}

/**
 * Replace SQL blocks in markdown content with placeholder markers
 * that can be replaced with rendered components.
 */
export function markSqlBlocks(content: string): string {
	return content.replace(
		/```sql\s+(\w[\w-]*)\s*\n([\s\S]*?)```/g,
		(_, name) => `<div data-sql-block="${name}"></div>`
	);
}
