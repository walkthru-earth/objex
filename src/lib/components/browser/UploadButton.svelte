<script lang="ts">
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import UploadIcon from '@lucide/svelte/icons/upload';
import { Button } from '$lib/components/ui/button/index.js';
import { browser } from '$lib/stores/browser.svelte.js';

let fileInput: HTMLInputElement;

let uploading = $derived(browser.uploading);

function handleClick() {
	fileInput?.click();
}

async function handleFileSelect(e: Event) {
	const input = e.target as HTMLInputElement;
	const fileList = input.files;
	if (!fileList || fileList.length === 0) return;

	const files: Array<{ name: string; data: Uint8Array; type?: string }> = [];

	for (const file of fileList) {
		const buffer = await file.arrayBuffer();
		files.push({
			name: file.name,
			data: new Uint8Array(buffer),
			type: file.type || undefined
		});
	}

	try {
		await browser.uploadFiles(files);
	} catch (err) {
		console.error('Upload failed:', err);
	}

	// Reset input so the same file can be re-selected
	input.value = '';
}
</script>

<input
	bind:this={fileInput}
	type="file"
	multiple
	class="hidden"
	onchange={handleFileSelect}
/>

<Button
	variant="outline"
	size="sm"
	class="h-7 gap-1.5 px-2 text-xs"
	disabled={uploading}
	onclick={handleClick}
>
	{#if uploading}
		<Loader2Icon class="size-3.5 animate-spin" />
		Uploading
	{:else}
		<UploadIcon class="size-3.5" />
		Upload
	{/if}
</Button>
