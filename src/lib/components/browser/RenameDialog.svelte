<script lang="ts">
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import PencilIcon from '@lucide/svelte/icons/pencil';
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
import type { FileEntry } from '$lib/types.js';

interface Props {
	open: boolean;
	entry: FileEntry | null;
}

let { open = $bindable(false), entry }: Props = $props();

let newName = $state('');
let renaming = $state(false);
let error = $state<string | null>(null);

let canRename = $derived(
	newName.trim() !== '' && !newName.includes('/') && newName.trim() !== entry?.name
);

$effect(() => {
	if (open && entry) {
		newName = entry.name;
		renaming = false;
		error = null;
	}
});

async function handleRename() {
	if (!canRename || !entry) return;
	renaming = true;
	error = null;

	try {
		await browser.renameEntry(entry, newName.trim());
		open = false;
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	} finally {
		renaming = false;
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Enter' && canRename) {
		handleRename();
	}
}
</script>

<Sheet bind:open>
	<SheetContent side="bottom" class="sm:max-w-lg sm:mx-auto sm:rounded-t-lg">
		<SheetHeader>
			<div class="flex items-center gap-2">
				<PencilIcon class="size-5 text-primary" />
				<SheetTitle>Rename</SheetTitle>
			</div>
			<SheetDescription>
				Enter a new name for <span class="font-medium">{entry?.name}</span>.
			</SheetDescription>
		</SheetHeader>

		<div class="py-4">
			<Input
				placeholder="New name"
				bind:value={newName}
				onkeydown={handleKeydown}
			/>
			{#if error}
				<p class="mt-2 text-sm text-destructive">{error}</p>
			{/if}
		</div>

		<SheetFooter class="flex-row gap-2">
			<div class="flex-1"></div>
			<Button variant="ghost" size="sm" onclick={() => { open = false; }} disabled={renaming}>
				Cancel
			</Button>
			<Button size="sm" disabled={!canRename || renaming} onclick={handleRename}>
				{#if renaming}
					<Loader2Icon class="mr-1.5 size-4 animate-spin" />
					Renaming...
				{:else}
					Rename
				{/if}
			</Button>
		</SheetFooter>
	</SheetContent>
</Sheet>
