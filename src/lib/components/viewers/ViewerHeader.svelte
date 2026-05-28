<script lang="ts">
import type { Snippet } from 'svelte';
import type { Tab } from '../../types.js';

let { tab, badge, actions }: { tab: Tab; badge?: Snippet; actions?: Snippet } = $props();
</script>

<div
	class="flex items-center gap-1 border-b border-border px-2 py-1.5 sm:gap-2 sm:px-4"
>
	<span class="max-w-[120px] truncate text-sm font-medium text-foreground sm:max-w-none">
		{tab.name}
	</span>
	{#if badge}{@render badge()}{/if}
	{#if actions}
		<div class="ms-auto flex items-center gap-1">{@render actions()}</div>
	{/if}
</div>
