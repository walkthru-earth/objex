// Ambient declarations for Vite asset-URL imports used by files under
// `src/lib/` that are bundled into this package's DTS output. Mirrors the
// minimal shape from `vite/client` without pulling in the full ambient types.

declare module '*?url' {
	const url: string;
	export default url;
}
