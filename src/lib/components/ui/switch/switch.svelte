<script lang="ts">
import { Switch as SwitchPrimitive } from 'bits-ui';
import type { ComponentProps } from 'svelte';
import { cn } from '$lib/utils.js';

let {
	ref = $bindable(null),
	class: className,
	checked = $bindable(false),
	...restProps
}: ComponentProps<typeof SwitchPrimitive.Root> & { class?: string } = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	class={cn(
		"peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:ring-ring/50 focus-visible:border-ring inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class="bg-background pointer-events-none block size-4 rounded-full shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 rtl:data-[state=checked]:-translate-x-4"
	/>
</SwitchPrimitive.Root>
