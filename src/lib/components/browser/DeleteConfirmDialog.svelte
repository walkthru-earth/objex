<script lang="ts">
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
import { Button } from '$lib/components/ui/button/index.js';
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

let deleting = $state(false);
let error = $state<string | null>(null);

$effect(() => {
	if (open) {
		deleting = false;
		error = null;
	}
});

async function handleDelete() {
	if (!entry) return;
	deleting = true;
	error = null;

	try {
		await browser.deleteEntry(entry);
		open = false;
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	} finally {
		deleting = false;
	}
}
</script>

<Sheet bind:open>
	<SheetContent side="bottom" class="sm:max-w-lg sm:mx-auto sm:rounded-t-lg">
		<SheetHeader>
			<div class="flex items-center gap-2">
				<TriangleAlertIcon class="size-5 text-destructive" />
				<SheetTitle>Confirm Delete</SheetTitle>
			</div>
			<SheetDescription>
				This action cannot be undone.
			</SheetDescription>
		</SheetHeader>

		<div class="py-4">
			{#if entry}
				<p class="text-sm">
					Are you sure you want to delete
					<span class="font-medium">{entry.name}</span>{entry.is_dir ? ' and all its contents' : ''}?
				</p>
			{/if}

			{#if error}
				<p class="mt-2 text-sm text-destructive">{error}</p>
			{/if}
		</div>

		<SheetFooter class="flex-row gap-2">
			<div class="flex-1"></div>
			<Button variant="ghost" size="sm" onclick={() => { open = false; }} disabled={deleting}>
				Cancel
			</Button>
			<Button variant="destructive" size="sm" disabled={deleting} onclick={handleDelete}>
				{#if deleting}
					<Loader2Icon class="mr-1.5 size-4 animate-spin" />
					Deleting...
				{:else}
					Delete
				{/if}
			</Button>
		</SheetFooter>
	</SheetContent>
</Sheet>
