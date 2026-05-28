<script lang="ts">
import { Loader } from '@lucide/svelte';
import { t } from '../../i18n/index.svelte.js';

let { kind, message }: { kind: 'loading' | 'error' | 'empty'; message?: string } = $props();
</script>

<div class="flex h-full items-center justify-center p-4">
	{#if kind === 'loading'}
		<div class="text-muted-foreground flex items-center gap-2 text-sm">
			<Loader class="size-4 animate-spin" />
			<span>{message ?? t('common.loading')}</span>
		</div>
	{:else if kind === 'error'}
		<p class="text-destructive text-sm">{message ?? t('common.error')}</p>
	{:else}
		<p class="text-muted-foreground text-sm">{message}</p>
	{/if}
</div>
