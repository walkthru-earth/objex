<script lang="ts">
import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
import { settings } from '$lib/stores/settings.svelte.js';
import { cn, type WithoutChild } from '$lib/utils.js';
import { Scrollbar } from './index.js';

let {
	ref = $bindable(null),
	viewportRef = $bindable(null),
	class: className,
	orientation = 'vertical',
	scrollbarXClasses = '',
	scrollbarYClasses = '',
	children,
	...restProps
}: WithoutChild<ScrollAreaPrimitive.RootProps> & {
	orientation?: 'vertical' | 'horizontal' | 'both' | undefined;
	scrollbarXClasses?: string | undefined;
	scrollbarYClasses?: string | undefined;
	viewportRef?: HTMLElement | null;
} = $props();

const dir = $derived<'ltr' | 'rtl'>(settings.locale === 'ar' ? 'rtl' : 'ltr');
</script>

<ScrollAreaPrimitive.Root
	bind:ref
	{dir}
	data-slot="scroll-area"
	class={cn("relative", className)}
	{...restProps}
>
	<ScrollAreaPrimitive.Viewport
		bind:ref={viewportRef}
		data-slot="scroll-area-viewport"
		class="ring-ring/10 dark:ring-ring/20 dark:outline-ring/40 outline-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] focus-visible:ring-4 focus-visible:outline-1"
	>
		{@render children?.()}
	</ScrollAreaPrimitive.Viewport>
	{#if orientation === "vertical" || orientation === "both"}
		<Scrollbar orientation="vertical" class={scrollbarYClasses} />
	{/if}
	{#if orientation === "horizontal" || orientation === "both"}
		<Scrollbar orientation="horizontal" class={scrollbarXClasses} />
	{/if}
	<ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
