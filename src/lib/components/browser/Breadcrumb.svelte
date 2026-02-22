<script lang="ts">
import { ChevronRight, Home } from '@lucide/svelte';

let { path, onNavigate }: { path: string; onNavigate: (path: string) => void } = $props();

const segments = $derived.by(() => {
	if (!path || path === '/') return [];
	// Remove leading/trailing slashes and split
	const clean = path.replace(/^\/+|\/+$/g, '');
	if (!clean) return [];
	return clean.split('/');
});

function navigateToSegment(index: number) {
	if (index < 0) {
		onNavigate('');
		return;
	}
	const targetPath = segments.slice(0, index + 1).join('/');
	onNavigate(targetPath);
}
</script>

<nav class="flex items-center gap-1 overflow-x-auto text-sm" aria-label="Breadcrumb">
	<button
		class="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-accent"
		onclick={() => navigateToSegment(-1)}
		aria-label="Navigate to root"
	>
		<Home class="size-3.5" />
	</button>

	{#each segments as segment, i}
		<ChevronRight class="text-muted-foreground/50 size-3.5 shrink-0" />

		{#if i === segments.length - 1}
			<span class="text-foreground truncate rounded px-1.5 py-0.5 font-medium">
				{segment}
			</span>
		{:else}
			<button
				class="text-muted-foreground hover:text-foreground truncate rounded px-1.5 py-0.5 transition-colors hover:bg-accent"
				onclick={() => navigateToSegment(i)}
			>
				{segment}
			</button>
		{/if}
	{/each}
</nav>
