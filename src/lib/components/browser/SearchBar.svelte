<script lang="ts">
import { Search, X } from '@lucide/svelte';
import { Input } from '$lib/components/ui/input/index.js';

let { onFilter }: { onFilter: (query: string) => void } = $props();

let query = $state('');

function handleInput() {
	onFilter(query);
}

function clearSearch() {
	query = '';
	onFilter('');
}
</script>

<div class="relative flex items-center">
	<label for="file-filter" class="sr-only">Filter files</label>
	<Search class="text-muted-foreground pointer-events-none absolute left-2.5 size-4" />
	<Input
		id="file-filter"
		type="text"
		placeholder="Filter files..."
		class="h-8 pl-8 pr-8 text-sm"
		bind:value={query}
		oninput={handleInput}
	/>
	{#if query.length > 0}
		<button
			class="text-muted-foreground hover:text-foreground absolute right-2.5 flex items-center justify-center"
			onclick={clearSearch}
			aria-label="Clear search"
		>
			<X class="size-3.5" />
		</button>
	{/if}
</div>
