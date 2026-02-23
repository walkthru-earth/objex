<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';

let {
	feature = null,
	visible = false,
	onClose
}: {
	feature: Record<string, any> | null;
	visible?: boolean;
	onClose?: () => void;
} = $props();

function formatValue(value: any): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}
</script>

{#if visible && feature}
	<div
		class="absolute bottom-2 end-2 top-10 z-10 flex w-64 flex-col overflow-hidden rounded bg-card/95 text-card-foreground shadow-lg backdrop-blur-sm sm:w-72"
	>
		<div
			class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800"
		>
			<h3 class="text-xs font-medium text-zinc-500 dark:text-zinc-400">Feature Attributes</h3>
			{#if onClose}
				<button
					class="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
					onclick={onClose}
				>
					<XIcon class="size-3.5" />
				</button>
			{/if}
		</div>
		<div class="flex-1 divide-y divide-zinc-100 overflow-auto dark:divide-zinc-800">
			{#each Object.entries(feature) as [key, value]}
				<div class="px-3 py-1.5">
					<div class="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{key}</div>
					<div
						class="break-all text-xs text-zinc-700 dark:text-zinc-300"
						title={formatValue(value)}
					>
						{formatValue(value)}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
