<script lang="ts">
import { getViewerKind } from '$lib/file-icons/index.js';
import type { Tab } from '$lib/types';
import CodeViewer from './CodeViewer.svelte';
import ImageViewer from './ImageViewer.svelte';
import MediaViewer from './MediaViewer.svelte';
import RawViewer from './RawViewer.svelte';
import TableViewer from './TableViewer.svelte';

let { tab }: { tab: Tab } = $props();

const ext = $derived(tab?.extension ?? '');
const viewerKind = $derived(getViewerKind(ext));
</script>

{#if viewerKind === 'table'}
	<TableViewer {tab} />
{:else if viewerKind === 'image'}
	<ImageViewer {tab} />
{:else if viewerKind === 'video' || viewerKind === 'audio'}
	<MediaViewer {tab} />
{:else if viewerKind === 'markdown'}
	{#await import('./MarkdownViewer.svelte') then { default: MarkdownViewer }}
		<MarkdownViewer {tab} />
	{/await}
{:else if viewerKind === 'code'}
	<CodeViewer {tab} />
{:else if viewerKind === 'cog'}
	{#await import('./CogViewer.svelte') then { default: CogViewer }}
		<CogViewer {tab} />
	{/await}
{:else if viewerKind === 'pmtiles'}
	{#await import('./PmtilesViewer.svelte') then { default: PmtilesViewer }}
		<PmtilesViewer {tab} />
	{/await}
{:else if viewerKind === 'flatgeobuf'}
	{#await import('./FlatGeobufViewer.svelte') then { default: FlatGeobufViewer }}
		<FlatGeobufViewer {tab} />
	{/await}
{:else if viewerKind === 'pdf'}
	{#await import('./PdfViewer.svelte') then { default: PdfViewer }}
		<PdfViewer {tab} />
	{/await}
{:else if viewerKind === '3d'}
	{#await import('./ModelViewer.svelte') then { default: ModelViewer }}
		<ModelViewer {tab} />
	{/await}
{:else if viewerKind === 'archive'}
	{#await import('./ArchiveViewer.svelte') then { default: ArchiveViewer }}
		<ArchiveViewer {tab} />
	{/await}
{:else if viewerKind === 'database'}
	{#await import('./DatabaseViewer.svelte') then { default: DatabaseViewer }}
		<DatabaseViewer {tab} />
	{/await}
{:else if viewerKind === 'zarr'}
	{#await import('./ZarrViewer.svelte') then { default: ZarrViewer }}
		<ZarrViewer {tab} />
	{/await}
{:else if viewerKind === 'copc'}
	{#await import('./CopcViewer.svelte') then { default: CopcViewer }}
		<CopcViewer {tab} />
	{/await}
{:else}
	<RawViewer {tab} />
{/if}
