<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';
import { t } from '$lib/i18n/index.svelte.js';
import type { SchemaField } from '$lib/query/engine';
import { classifyType, typeBadgeClass, typeLabel } from '$lib/utils/column-types.js';

let {
	fields,
	visible = true,
	onClose
}: { fields: SchemaField[]; visible?: boolean; onClose?: () => void } = $props();
</script>

{#if visible}
	<!-- Mobile: absolute overlay; Desktop: flex sidebar -->
	<div
		class="absolute inset-y-0 end-0 z-10 w-64 overflow-auto border-s border-zinc-200 bg-zinc-50 sm:relative sm:z-auto sm:shrink-0 dark:border-zinc-800 dark:bg-zinc-900"
	>
		<div
			class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800"
		>
			<h3 class="text-xs font-medium text-zinc-500 dark:text-zinc-400">
				{t('schema.title', { count: fields.length })}
			</h3>
			{#if onClose}
				<button
					class="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 sm:hidden dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
					onclick={onClose}
				>
					<XIcon class="size-3.5" />
				</button>
			{/if}
		</div>
		<div class="divide-y divide-zinc-100 dark:divide-zinc-800">
			{#each fields as field}
				{@const category = classifyType(field.type)}
				<div class="px-3 py-1.5">
					<div class="flex items-center gap-1.5">
						<span
							class="inline-flex h-4 items-center rounded border px-1 text-[9px] font-semibold leading-none {typeBadgeClass(category)}"
							title={field.type}
						>
							{typeLabel(category)}
						</span>
						<span class="text-xs font-medium text-zinc-700 dark:text-zinc-300">
							{field.name}
						</span>
						{#if field.nullable}
							<span class="text-[10px] text-zinc-400">?</span>
						{/if}
					</div>
					<span class="ms-7 text-[10px] text-zinc-400 dark:text-zinc-500">
						{field.type}
					</span>
				</div>
			{/each}
		</div>
	</div>
{/if}
