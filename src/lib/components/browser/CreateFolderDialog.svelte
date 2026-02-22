<script lang="ts">
import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle
} from '$lib/components/ui/sheet/index.js';
import { browser } from '$lib/stores/browser.svelte.js';

interface Props {
	open: boolean;
}

let { open = $bindable(false) }: Props = $props();

let folderName = $state('');
let creating = $state(false);
let error = $state<string | null>(null);

const invalidChars = /[/\\*?"<>|]/;
let canCreate = $derived(folderName.trim() !== '' && !invalidChars.test(folderName));

$effect(() => {
	if (open) {
		folderName = '';
		creating = false;
		error = null;
	}
});

async function handleCreate() {
	if (!canCreate) return;
	creating = true;
	error = null;

	try {
		await browser.createFolder(folderName.trim());
		open = false;
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	} finally {
		creating = false;
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Enter' && canCreate) {
		handleCreate();
	}
}
</script>

<Sheet bind:open>
	<SheetContent side="bottom" class="sm:max-w-lg sm:mx-auto sm:rounded-t-lg">
		<SheetHeader>
			<div class="flex items-center gap-2">
				<FolderPlusIcon class="size-5 text-primary" />
				<SheetTitle>New Folder</SheetTitle>
			</div>
			<SheetDescription>
				Create a new folder in the current directory.
			</SheetDescription>
		</SheetHeader>

		<div class="py-4">
			<Input
				placeholder="Folder name"
				bind:value={folderName}
				onkeydown={handleKeydown}
			/>
			{#if error}
				<p class="mt-2 text-sm text-destructive">{error}</p>
			{/if}
		</div>

		<SheetFooter class="flex-row gap-2">
			<div class="flex-1"></div>
			<Button variant="ghost" size="sm" onclick={() => { open = false; }} disabled={creating}>
				Cancel
			</Button>
			<Button size="sm" disabled={!canCreate || creating} onclick={handleCreate}>
				{#if creating}
					<Loader2Icon class="mr-1.5 size-4 animate-spin" />
					Creating...
				{:else}
					Create
				{/if}
			</Button>
		</SheetFooter>
	</SheetContent>
</Sheet>
