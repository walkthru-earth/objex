<script lang="ts">
let {
	feature = null,
	visible = false
}: {
	feature: Record<string, any> | null;
	visible?: boolean;
} = $props();

function formatValue(value: any): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}
</script>

{#if visible && feature}
	<div
		class="w-72 shrink-0 overflow-auto border-s border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
	>
		<div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
			<h3 class="text-xs font-medium text-zinc-500 dark:text-zinc-400">Feature Attributes</h3>
		</div>
		<div class="divide-y divide-zinc-100 dark:divide-zinc-800">
			{#each Object.entries(feature) as [key, value]}
				<div class="px-3 py-1.5">
					<div class="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{key}</div>
					<div class="text-xs text-zinc-700 dark:text-zinc-300" title={formatValue(value)}>
						{formatValue(value)}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
