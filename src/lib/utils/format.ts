/**
 * Formats a byte count into a human-readable string.
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 0) return '0 B';
	if (bytes === 0) return '0 B';

	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const base = 1024;
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), units.length - 1);
	const value = bytes / base ** exponent;

	// Use integer display for bytes, one decimal for everything else
	if (exponent === 0) return `${bytes} B`;
	return `${value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Formats a unix timestamp (milliseconds) to a human-readable date string.
 * Shows relative time for recent dates, absolute for older ones.
 */
export function formatDate(timestamp: number): string {
	if (!timestamp || timestamp <= 0) return '--';

	const date = new Date(timestamp);
	const now = Date.now();
	const diffMs = now - timestamp;
	const diffSeconds = Math.floor(diffMs / 1000);
	const diffMinutes = Math.floor(diffSeconds / 60);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffSeconds < 60) return 'Just now';
	if (diffMinutes < 60) return `${diffMinutes}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;

	// For older dates, show absolute date
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

/**
 * Extracts the file extension from a filename, including the leading dot.
 * Returns an empty string if no extension is found.
 */
export function getFileExtension(filename: string): string {
	const lastDot = filename.lastIndexOf('.');
	if (lastDot <= 0) return '';
	return filename.slice(lastDot).toLowerCase();
}
