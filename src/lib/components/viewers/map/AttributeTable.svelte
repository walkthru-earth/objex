<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';
import { formatValue } from '@walkthru-earth/objex-utils';

let {
	feature = null,
	visible = false,
	onClose
}: {
	feature: Record<string, any> | null;
	visible?: boolean;
	onClose?: () => void;
} = $props();
</script>

{#if visible && feature}
	<div
		class="absolute bottom-2 end-2 top-10 z-10 flex w-64 flex-col overflow-hidden rounded bg-card/95 text-card-foreground shadow-lg backdrop-blur-sm sm:w-72"
	>
		<div
			class="flex items-center justify-between border-b border-border px-3 py-2"
		>
			<h3 class="text-xs font-medium text-muted-foreground">Feature Attributes</h3>
			{#if onClose}
				<button
					class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
					onclick={onClose}
				>
					<XIcon class="size-3.5" />
				</button>
			{/if}
		</div>
		<div class="flex-1 divide-y divide-border overflow-auto">
			{#each Object.entries(feature) as [key, value]}
				<div class="px-3 py-1.5">
					<div class="text-[10px] font-medium text-muted-foreground">{key}</div>
					<div
						class="break-all text-xs text-foreground"
						title={formatValue(value)}
					>
						{formatValue(value)}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
