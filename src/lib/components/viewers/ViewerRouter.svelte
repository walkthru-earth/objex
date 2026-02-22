<script lang="ts">
import { getViewerKind } from '$lib/file-icons/index.js';
import type { Tab } from '$lib/types';
import ArchiveViewer from './ArchiveViewer.svelte';
import CodeViewer from './CodeViewer.svelte';
import CogViewer from './CogViewer.svelte';
import DatabaseViewer from './DatabaseViewer.svelte';
import FlatGeobufViewer from './FlatGeobufViewer.svelte';
import ImageViewer from './ImageViewer.svelte';
import MarkdownViewer from './MarkdownViewer.svelte';
import MediaViewer from './MediaViewer.svelte';
import ModelViewer from './ModelViewer.svelte';
import PdfViewer from './PdfViewer.svelte';
import PmtilesViewer from './PmtilesViewer.svelte';
import RawViewer from './RawViewer.svelte';
import TableViewer from './TableViewer.svelte';
import ZarrViewer from './ZarrViewer.svelte';

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
	<MarkdownViewer {tab} />
{:else if viewerKind === 'code'}
	<CodeViewer {tab} />
{:else if viewerKind === 'cog'}
	<CogViewer {tab} />
{:else if viewerKind === 'pmtiles'}
	<PmtilesViewer {tab} />
{:else if viewerKind === 'flatgeobuf'}
	<FlatGeobufViewer {tab} />
{:else if viewerKind === 'pdf'}
	<PdfViewer {tab} />
{:else if viewerKind === '3d'}
	<ModelViewer {tab} />
{:else if viewerKind === 'archive'}
	<ArchiveViewer {tab} />
{:else if viewerKind === 'database'}
	<DatabaseViewer {tab} />
{:else if viewerKind === 'zarr'}
	<ZarrViewer {tab} />
{:else}
	<RawViewer {tab} />
{/if}
