<script lang="ts">
import { Search, X } from '@lucide/svelte';
import { Input } from '$lib/components/ui/input/index.js';
import { t } from '$lib/i18n/index.svelte.js';

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
	<label for="file-filter" class="sr-only">{t('searchBar.label')}</label>
	<Search class="text-muted-foreground pointer-events-none absolute start-2.5 size-4" />
	<Input
		id="file-filter"
		type="text"
		placeholder={t('searchBar.placeholder')}
		class="h-8 ps-8 pe-8 text-sm"
		bind:value={query}
		oninput={handleInput}
	/>
	{#if query.length > 0}
		<button
			class="text-muted-foreground hover:text-foreground absolute end-2.5 flex items-center justify-center"
			onclick={clearSearch}
			aria-label={t('searchBar.clear')}
		>
			<X class="size-3.5" />
		</button>
	{/if}
</div>
