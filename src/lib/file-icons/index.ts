/**
 * Centralized file type detection module.
 *
 * Single source of truth for extension → icon, color, label, category,
 * viewer, DuckDB read function, MIME type, and queryability.
 *
 * Used by: FileRow, FileTreeSidebar, ViewerRouter, TableViewer, WasmQueryEngine, etc.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileCategory =
	| 'data'
	| 'geo'
	| 'code'
	| 'document'
	| 'config'
	| 'image'
	| 'video'
	| 'audio'
	| 'archive'
	| 'database'
	| '3d'
	| 'other';

export type ViewerKind =
	| 'table'
	| 'image'
	| 'video'
	| 'audio'
	| 'markdown'
	| 'code'
	| 'cog'
	| 'pmtiles'
	| 'flatgeobuf'
	| 'pdf'
	| '3d'
	| 'archive'
	| 'database'
	| 'zarr'
	| 'copc'
	| 'raw';

export type DuckDbReadFn = 'read_parquet' | 'read_csv' | 'read_json' | 'ST_Read';

export interface FileTypeInfo {
	/** Lucide icon name */
	icon: string;
	/** Tailwind color classes (light + dark) */
	color: string;
	/** Human-readable type label, e.g. "Apache Parquet" */
	label: string;
	/** High-level category */
	category: FileCategory;
	/** Which viewer component to use */
	viewer: ViewerKind;
	/** Whether this file can be queried with DuckDB */
	queryable: boolean;
	/** DuckDB read function (null if not queryable) */
	duckdbReadFn: DuckDbReadFn | null;
	/** MIME type */
	mimeType: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INFO: FileTypeInfo = {
	icon: 'File',
	color: 'text-zinc-400 dark:text-zinc-500',
	label: 'File',
	category: 'other',
	viewer: 'raw',
	queryable: false,
	duckdbReadFn: null,
	mimeType: 'application/octet-stream'
};

const FOLDER_INFO: FileTypeInfo = {
	icon: 'Folder',
	color: 'text-blue-500 dark:text-blue-400',
	label: 'Folder',
	category: 'other',
	viewer: 'raw',
	queryable: false,
	duckdbReadFn: null,
	mimeType: 'inode/directory'
};

// ---------------------------------------------------------------------------
// Extension registry
// ---------------------------------------------------------------------------

const EXTENSIONS: Record<string, FileTypeInfo> = {
	// ── Data / Tabular ──────────────────────────────────────────────────
	'.parquet': {
		icon: 'Columns3',
		color: 'text-purple-600 dark:text-purple-400',
		label: 'Apache Parquet',
		category: 'data',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_parquet',
		mimeType: 'application/vnd.apache.parquet'
	},
	'.geoparquet': {
		icon: 'Globe',
		color: 'text-purple-500 dark:text-purple-400',
		label: 'GeoParquet',
		category: 'geo',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_parquet',
		mimeType: 'application/vnd.apache.parquet'
	},
	'.gpq': {
		icon: 'Globe',
		color: 'text-purple-500 dark:text-purple-400',
		label: 'GeoParquet',
		category: 'geo',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_parquet',
		mimeType: 'application/vnd.apache.parquet'
	},
	'.gparquet': {
		icon: 'Globe',
		color: 'text-purple-500 dark:text-purple-400',
		label: 'GeoParquet',
		category: 'geo',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_parquet',
		mimeType: 'application/vnd.apache.parquet'
	},
	'.csv': {
		icon: 'Table',
		color: 'text-green-600 dark:text-green-400',
		label: 'CSV',
		category: 'data',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_csv',
		mimeType: 'text/csv'
	},
	'.tsv': {
		icon: 'Table',
		color: 'text-green-600 dark:text-green-400',
		label: 'TSV',
		category: 'data',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_csv',
		mimeType: 'text/tab-separated-values'
	},
	'.json': {
		icon: 'Braces',
		color: 'text-yellow-600 dark:text-yellow-400',
		label: 'JSON',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/json'
	},
	'.jsonl': {
		icon: 'Braces',
		color: 'text-yellow-500 dark:text-yellow-400',
		label: 'JSON Lines',
		category: 'data',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_json',
		mimeType: 'application/x-jsonlines'
	},
	'.ndjson': {
		icon: 'Braces',
		color: 'text-yellow-500 dark:text-yellow-400',
		label: 'NDJSON',
		category: 'data',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_json',
		mimeType: 'application/x-ndjson'
	},
	'.geojson': {
		icon: 'Globe',
		color: 'text-emerald-600 dark:text-emerald-400',
		label: 'GeoJSON',
		category: 'geo',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'read_json',
		mimeType: 'application/geo+json'
	},
	'.arrow': {
		icon: 'Zap',
		color: 'text-orange-500 dark:text-orange-400',
		label: 'Apache Arrow',
		category: 'data',
		viewer: 'raw',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/vnd.apache.arrow.file'
	},
	'.feather': {
		icon: 'Zap',
		color: 'text-orange-500 dark:text-orange-400',
		label: 'Feather',
		category: 'data',
		viewer: 'raw',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/vnd.apache.arrow.file'
	},
	'.ipc': {
		icon: 'Zap',
		color: 'text-orange-500 dark:text-orange-400',
		label: 'Arrow IPC',
		category: 'data',
		viewer: 'raw',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/vnd.apache.arrow.stream'
	},

	// ── Images ──────────────────────────────────────────────────────────
	'.png': {
		icon: 'Image',
		color: 'text-pink-500 dark:text-pink-400',
		label: 'PNG Image',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/png'
	},
	'.jpg': {
		icon: 'Image',
		color: 'text-pink-500 dark:text-pink-400',
		label: 'JPEG Image',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/jpeg'
	},
	'.jpeg': {
		icon: 'Image',
		color: 'text-pink-500 dark:text-pink-400',
		label: 'JPEG Image',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/jpeg'
	},
	'.gif': {
		icon: 'Image',
		color: 'text-pink-500 dark:text-pink-400',
		label: 'GIF Image',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/gif'
	},
	'.webp': {
		icon: 'Image',
		color: 'text-pink-500 dark:text-pink-400',
		label: 'WebP Image',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/webp'
	},
	'.avif': {
		icon: 'Image',
		color: 'text-pink-500 dark:text-pink-400',
		label: 'AVIF Image',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/avif'
	},
	'.svg': {
		icon: 'Palette',
		color: 'text-pink-600 dark:text-pink-400',
		label: 'SVG',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/svg+xml'
	},
	'.bmp': {
		icon: 'Image',
		color: 'text-pink-500 dark:text-pink-400',
		label: 'BMP Image',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/bmp'
	},
	'.ico': {
		icon: 'Image',
		color: 'text-pink-500 dark:text-pink-400',
		label: 'Icon',
		category: 'image',
		viewer: 'image',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/x-icon'
	},

	// ── Video ───────────────────────────────────────────────────────────
	'.mp4': {
		icon: 'Film',
		color: 'text-violet-500 dark:text-violet-400',
		label: 'MP4 Video',
		category: 'video',
		viewer: 'video',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'video/mp4'
	},
	'.webm': {
		icon: 'Film',
		color: 'text-violet-500 dark:text-violet-400',
		label: 'WebM Video',
		category: 'video',
		viewer: 'video',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'video/webm'
	},
	'.mov': {
		icon: 'Film',
		color: 'text-violet-500 dark:text-violet-400',
		label: 'MOV Video',
		category: 'video',
		viewer: 'video',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'video/quicktime'
	},
	'.avi': {
		icon: 'Film',
		color: 'text-violet-500 dark:text-violet-400',
		label: 'AVI Video',
		category: 'video',
		viewer: 'video',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'video/x-msvideo'
	},
	'.mkv': {
		icon: 'Film',
		color: 'text-violet-500 dark:text-violet-400',
		label: 'MKV Video',
		category: 'video',
		viewer: 'video',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'video/x-matroska'
	},

	// ── Audio ───────────────────────────────────────────────────────────
	'.mp3': {
		icon: 'Music',
		color: 'text-rose-500 dark:text-rose-400',
		label: 'MP3 Audio',
		category: 'audio',
		viewer: 'audio',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'audio/mpeg'
	},
	'.wav': {
		icon: 'Music',
		color: 'text-rose-500 dark:text-rose-400',
		label: 'WAV Audio',
		category: 'audio',
		viewer: 'audio',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'audio/wav'
	},
	'.ogg': {
		icon: 'Music',
		color: 'text-rose-500 dark:text-rose-400',
		label: 'OGG Audio',
		category: 'audio',
		viewer: 'audio',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'audio/ogg'
	},
	'.flac': {
		icon: 'Music',
		color: 'text-rose-500 dark:text-rose-400',
		label: 'FLAC Audio',
		category: 'audio',
		viewer: 'audio',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'audio/flac'
	},
	'.aac': {
		icon: 'Music',
		color: 'text-rose-500 dark:text-rose-400',
		label: 'AAC Audio',
		category: 'audio',
		viewer: 'audio',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'audio/aac'
	},

	// ── Code ────────────────────────────────────────────────────────────
	'.py': {
		icon: 'FileCode',
		color: 'text-sky-600 dark:text-sky-400',
		label: 'Python',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-python'
	},
	'.ts': {
		icon: 'FileCode',
		color: 'text-blue-600 dark:text-blue-400',
		label: 'TypeScript',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/typescript'
	},
	'.js': {
		icon: 'FileCode',
		color: 'text-yellow-500 dark:text-yellow-400',
		label: 'JavaScript',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/javascript'
	},
	'.rs': {
		icon: 'FileCode',
		color: 'text-orange-700 dark:text-orange-400',
		label: 'Rust',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-rust'
	},
	'.go': {
		icon: 'FileCode',
		color: 'text-cyan-600 dark:text-cyan-400',
		label: 'Go',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-go'
	},
	'.java': {
		icon: 'FileCode',
		color: 'text-red-600 dark:text-red-400',
		label: 'Java',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-java'
	},
	'.c': {
		icon: 'FileCode',
		color: 'text-blue-500 dark:text-blue-400',
		label: 'C',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-c'
	},
	'.cpp': {
		icon: 'FileCode',
		color: 'text-blue-500 dark:text-blue-400',
		label: 'C++',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-c++'
	},
	'.h': {
		icon: 'FileCode',
		color: 'text-blue-500 dark:text-blue-400',
		label: 'C Header',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-c'
	},
	'.hpp': {
		icon: 'FileCode',
		color: 'text-blue-500 dark:text-blue-400',
		label: 'C++ Header',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-c++'
	},
	'.rb': {
		icon: 'FileCode',
		color: 'text-red-500 dark:text-red-400',
		label: 'Ruby',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-ruby'
	},
	'.php': {
		icon: 'FileCode',
		color: 'text-indigo-500 dark:text-indigo-400',
		label: 'PHP',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-php'
	},
	'.swift': {
		icon: 'FileCode',
		color: 'text-orange-500 dark:text-orange-400',
		label: 'Swift',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-swift'
	},
	'.kt': {
		icon: 'FileCode',
		color: 'text-violet-600 dark:text-violet-400',
		label: 'Kotlin',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-kotlin'
	},
	'.scala': {
		icon: 'FileCode',
		color: 'text-red-600 dark:text-red-400',
		label: 'Scala',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-scala'
	},
	'.r': {
		icon: 'FileCode',
		color: 'text-blue-600 dark:text-blue-400',
		label: 'R',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-r'
	},
	'.lua': {
		icon: 'FileCode',
		color: 'text-blue-800 dark:text-blue-400',
		label: 'Lua',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-lua'
	},
	'.html': {
		icon: 'Globe',
		color: 'text-orange-600 dark:text-orange-400',
		label: 'HTML',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/html'
	},
	'.css': {
		icon: 'Paintbrush',
		color: 'text-blue-500 dark:text-blue-400',
		label: 'CSS',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/css'
	},
	'.sql': {
		icon: 'DatabaseZap',
		color: 'text-blue-500 dark:text-blue-400',
		label: 'SQL',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-sql'
	},
	'.sh': {
		icon: 'Terminal',
		color: 'text-green-600 dark:text-green-400',
		label: 'Shell Script',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-shellscript'
	},
	'.bash': {
		icon: 'Terminal',
		color: 'text-green-600 dark:text-green-400',
		label: 'Bash Script',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/x-shellscript'
	},
	'.vim': {
		icon: 'FileCode',
		color: 'text-green-700 dark:text-green-400',
		label: 'Vim Script',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},
	'.dockerfile': {
		icon: 'FileCode',
		color: 'text-blue-600 dark:text-blue-400',
		label: 'Dockerfile',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},
	'.makefile': {
		icon: 'FileCode',
		color: 'text-orange-600 dark:text-orange-400',
		label: 'Makefile',
		category: 'code',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},

	// ── Documents ───────────────────────────────────────────────────────
	'.md': {
		icon: 'BookText',
		color: 'text-blue-500 dark:text-blue-400',
		label: 'Markdown',
		category: 'document',
		viewer: 'markdown',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/markdown'
	},
	'.markdown': {
		icon: 'BookText',
		color: 'text-blue-500 dark:text-blue-400',
		label: 'Markdown',
		category: 'document',
		viewer: 'markdown',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/markdown'
	},
	'.pdf': {
		icon: 'FileText',
		color: 'text-red-600 dark:text-red-400',
		label: 'PDF',
		category: 'document',
		viewer: 'pdf',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/pdf'
	},
	'.txt': {
		icon: 'FileText',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'Text',
		category: 'document',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},
	'.log': {
		icon: 'FileText',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'Log File',
		category: 'document',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},

	// ── Config ──────────────────────────────────────────────────────────
	'.xml': {
		icon: 'FileCode',
		color: 'text-orange-500 dark:text-orange-400',
		label: 'XML',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/xml'
	},
	'.yaml': {
		icon: 'Settings',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'YAML',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/yaml'
	},
	'.yml': {
		icon: 'Settings',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'YAML',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/yaml'
	},
	'.toml': {
		icon: 'Settings',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'TOML',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},
	'.ini': {
		icon: 'Settings',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'INI',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},
	'.cfg': {
		icon: 'Settings',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'Config',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},
	'.conf': {
		icon: 'Settings',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'Config',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},
	'.env': {
		icon: 'Settings',
		color: 'text-zinc-500 dark:text-zinc-400',
		label: 'Environment',
		category: 'config',
		viewer: 'code',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},

	// ── Archives ────────────────────────────────────────────────────────
	'.zip': {
		icon: 'Archive',
		color: 'text-amber-600 dark:text-amber-400',
		label: 'ZIP Archive',
		category: 'archive',
		viewer: 'archive',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/zip'
	},
	'.tar': {
		icon: 'Archive',
		color: 'text-amber-600 dark:text-amber-400',
		label: 'TAR Archive',
		category: 'archive',
		viewer: 'archive',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/x-tar'
	},
	'.gz': {
		icon: 'Archive',
		color: 'text-amber-600 dark:text-amber-400',
		label: 'GZIP',
		category: 'archive',
		viewer: 'archive',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/gzip'
	},
	'.tgz': {
		icon: 'Archive',
		color: 'text-amber-600 dark:text-amber-400',
		label: 'TGZ Archive',
		category: 'archive',
		viewer: 'archive',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/gzip'
	},
	'.7z': {
		icon: 'Archive',
		color: 'text-amber-600 dark:text-amber-400',
		label: '7-Zip',
		category: 'archive',
		viewer: 'archive',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/x-7z-compressed'
	},
	'.rar': {
		icon: 'Archive',
		color: 'text-amber-600 dark:text-amber-400',
		label: 'RAR',
		category: 'archive',
		viewer: 'archive',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/vnd.rar'
	},
	'.bz2': {
		icon: 'Archive',
		color: 'text-amber-600 dark:text-amber-400',
		label: 'BZIP2',
		category: 'archive',
		viewer: 'archive',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/x-bzip2'
	},

	// ── Geo / Map ───────────────────────────────────────────────────────
	'.tif': {
		icon: 'Map',
		color: 'text-green-600 dark:text-green-400',
		label: 'GeoTIFF',
		category: 'geo',
		viewer: 'cog',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/tiff'
	},
	'.tiff': {
		icon: 'Map',
		color: 'text-green-600 dark:text-green-400',
		label: 'GeoTIFF',
		category: 'geo',
		viewer: 'cog',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'image/tiff'
	},
	'.pmtiles': {
		icon: 'Layers',
		color: 'text-teal-600 dark:text-teal-400',
		label: 'PMTiles',
		category: 'geo',
		viewer: 'pmtiles',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	},
	'.fgb': {
		icon: 'Globe',
		color: 'text-teal-500 dark:text-teal-400',
		label: 'FlatGeobuf',
		category: 'geo',
		viewer: 'flatgeobuf',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	},
	'.shp': {
		icon: 'Globe',
		color: 'text-green-600 dark:text-green-400',
		label: 'Shapefile',
		category: 'geo',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'ST_Read',
		mimeType: 'application/x-esri-shape'
	},
	'.gpkg': {
		icon: 'Database',
		color: 'text-green-600 dark:text-green-400',
		label: 'GeoPackage',
		category: 'geo',
		viewer: 'table',
		queryable: true,
		duckdbReadFn: 'ST_Read',
		mimeType: 'application/geopackage+sqlite3'
	},

	// ── Database ────────────────────────────────────────────────────────
	'.duckdb': {
		icon: 'Database',
		color: 'text-yellow-600 dark:text-yellow-400',
		label: 'DuckDB',
		category: 'database',
		viewer: 'database',
		queryable: true,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	},
	'.sqlite': {
		icon: 'Database',
		color: 'text-sky-600 dark:text-sky-400',
		label: 'SQLite',
		category: 'database',
		viewer: 'database',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/x-sqlite3'
	},
	'.db': {
		icon: 'Database',
		color: 'text-amber-500 dark:text-amber-400',
		label: 'Database',
		category: 'database',
		viewer: 'database',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	},

	// ── 3D Models ───────────────────────────────────────────────────────
	'.glb': {
		icon: 'Box',
		color: 'text-violet-600 dark:text-violet-400',
		label: 'GLB Model',
		category: '3d',
		viewer: '3d',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'model/gltf-binary'
	},
	'.gltf': {
		icon: 'Box',
		color: 'text-violet-600 dark:text-violet-400',
		label: 'glTF Model',
		category: '3d',
		viewer: '3d',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'model/gltf+json'
	},
	'.obj': {
		icon: 'Box',
		color: 'text-violet-600 dark:text-violet-400',
		label: 'OBJ Model',
		category: '3d',
		viewer: '3d',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'text/plain'
	},
	'.stl': {
		icon: 'Box',
		color: 'text-violet-600 dark:text-violet-400',
		label: 'STL Model',
		category: '3d',
		viewer: '3d',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'model/stl'
	},
	'.fbx': {
		icon: 'Box',
		color: 'text-violet-600 dark:text-violet-400',
		label: 'FBX Model',
		category: '3d',
		viewer: '3d',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	},

	// ── Special ─────────────────────────────────────────────────────────
	'.zarr': {
		icon: 'Layers',
		color: 'text-purple-500 dark:text-purple-400',
		label: 'Zarr',
		category: 'data',
		viewer: 'zarr',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	},
	'.zr3': {
		icon: 'Layers',
		color: 'text-purple-500 dark:text-purple-400',
		label: 'Zarr',
		category: 'data',
		viewer: 'zarr',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	},

	// ── Point Cloud ─────────────────────────────────────────────────────
	'.laz': {
		icon: 'Orbit',
		color: 'text-cyan-600 dark:text-cyan-400',
		label: 'COPC / LAZ',
		category: 'geo',
		viewer: 'copc',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	},
	'.las': {
		icon: 'Orbit',
		color: 'text-cyan-600 dark:text-cyan-400',
		label: 'LAS Point Cloud',
		category: 'geo',
		viewer: 'copc',
		queryable: false,
		duckdbReadFn: null,
		mimeType: 'application/octet-stream'
	}
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns full file type information for a given extension.
 * Extension may be with or without leading dot: ".parquet" or "parquet".
 */
export function getFileTypeInfo(extension: string, isDir = false): FileTypeInfo {
	if (isDir) return FOLDER_INFO;
	const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
	return EXTENSIONS[ext] ?? DEFAULT_INFO;
}

/** Returns the DuckDB read function name for a file path. Falls back to read_parquet. */
export function getDuckDbReadFn(pathOrExt: string): string {
	const ext = pathOrExt.includes('.') ? `.${pathOrExt.split('.').pop()!.toLowerCase()}` : '';
	return EXTENSIONS[ext]?.duckdbReadFn ?? 'read_parquet';
}

/**
 * Returns a DuckDB FROM-clause expression for a file.
 *
 * For GeoJSON files the raw `read_json_auto` returns a single row with the
 * FeatureCollection structure (`type`, `features`, `bbox`). This helper
 * unnests the features array so each feature becomes its own row with
 * property columns + a geometry column.
 */
export function buildDuckDbSource(pathOrExt: string, url: string): string {
	const ext = pathOrExt.includes('.') ? `.${pathOrExt.split('.').pop()!.toLowerCase()}` : '';
	if (ext === '.geojson') {
		return `(SELECT unnest(feature.properties), to_json(feature.geometry)::VARCHAR AS geometry FROM (SELECT unnest(features) AS feature FROM read_json_auto('${url}', maximum_object_size=1073741824, ignore_errors=true)))`;
	}
	const readFn = EXTENSIONS[ext]?.duckdbReadFn ?? 'read_parquet';
	return `${readFn}('${url}')`;
}

/**
 * Cloud-native formats that DuckDB can query via range requests — metadata
 * reads (schema, row count) are cheap and don't download the full file.
 *
 * Other cloud-native formats (.fgb, .pmtiles, .zarr) also support range
 * requests but have dedicated viewers and don't go through DuckDB/TableViewer.
 */
const CLOUD_NATIVE_EXTS = new Set(['.parquet', '.geoparquet', '.gpq', '.gparquet']);

export function isCloudNativeFormat(pathOrExt: string): boolean {
	const ext = pathOrExt.includes('.') ? `.${pathOrExt.split('.').pop()!.toLowerCase()}` : '';
	return CLOUD_NATIVE_EXTS.has(ext);
}

/** Returns the viewer kind for a given extension. */
export function getViewerKind(extension: string): ViewerKind {
	return getFileTypeInfo(extension).viewer;
}

/** Returns whether a file can be queried with DuckDB. */
export function isQueryable(extension: string): boolean {
	return getFileTypeInfo(extension).queryable;
}

/** Returns the MIME type for a file extension. */
export function getMimeType(extension: string): string {
	return getFileTypeInfo(extension).mimeType;
}

/** Re-export folder info for components that need it directly. */
export { FOLDER_INFO, DEFAULT_INFO };
