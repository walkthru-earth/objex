// Ambient declarations for Vite asset-URL imports used by files under
// `src/lib/` that are bundled into this package's DTS output. Mirrors the
// minimal shape from `vite/client` without pulling in the full ambient types.

declare module '*?url' {
	const url: string;
	export default url;
}

// Minimal `import.meta.env` shape so `host-detection.ts`'s dev-tracing guard
// type-checks under the tsup DTS build (no `vite/client` ambient).
interface ImportMeta {
	readonly env?: {
		readonly DEV?: boolean;
		readonly PROD?: boolean;
		readonly MODE?: string;
		readonly SSR?: boolean;
	};
}
