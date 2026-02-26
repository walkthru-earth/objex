<script lang="ts">
import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import XCircleIcon from '@lucide/svelte/icons/x-circle';
import { t } from '$lib/i18n/index.svelte.js';

export type ProgressEntry = {
	label: string;
	value: string;
	detail?: string;
};

let {
	stage = '',
	entries = [],
	onCancel,
	onForceCancel,
	forceCancelVisible = false
}: {
	stage?: string;
	entries?: ProgressEntry[];
	onCancel?: () => void;
	onForceCancel?: () => void;
	forceCancelVisible?: boolean;
} = $props();
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-4 px-4">
	<!-- Active step -->
	<div class="flex items-center gap-2 text-center">
		<Loader2Icon class="size-4 shrink-0 animate-spin text-primary" />
		<p class="text-sm text-zinc-500 dark:text-zinc-400">{stage || t('table.loading')}</p>
	</div>

	<!-- Discovered metadata -->
	{#if entries.length > 0}
		<div
			class="w-full max-w-md rounded-lg border border-zinc-200/60 bg-zinc-50/80 px-3 py-2.5 sm:px-4 sm:py-3 dark:border-zinc-800/60 dark:bg-zinc-900/50"
		>
			<div class="flex flex-col gap-1.5">
				{#each entries as entry}
					<div class="flex items-start gap-1.5 sm:gap-2">
						<CheckCircleIcon class="mt-0.5 size-3 shrink-0 text-green-500/80" />
						<span
							class="w-14 shrink-0 text-[11px] leading-4 text-zinc-400 sm:w-[4.5rem] sm:text-xs dark:text-zinc-500"
						>
							{entry.label}
						</span>
						<div class="min-w-0 flex-1">
							<span class="break-all text-[11px] font-medium leading-4 text-zinc-600 sm:text-xs dark:text-zinc-300">
								{entry.value}
							</span>
							{#if entry.detail}
								<p
									class="mt-0.5 truncate font-mono text-[10px] leading-tight text-zinc-400 dark:text-zinc-500"
								>
									{entry.detail}
								</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Cancel -->
	{#if onCancel}
		<div class="flex flex-col items-center gap-2">
			<button
				class="flex items-center gap-1 rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
				onclick={onCancel}
			>
				<XCircleIcon class="size-3" />
				{t('table.cancel')}
			</button>
			{#if forceCancelVisible && onForceCancel}
				<div class="flex flex-col items-center gap-1">
					<button
						class="flex items-center gap-1 rounded border border-red-400 bg-red-50 px-3 py-1 text-xs text-red-600 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
						onclick={onForceCancel}
					>
						<XCircleIcon class="size-3" />
						{t('table.forceStop')}
					</button>
					<p class="max-w-xs text-center text-[10px] text-zinc-400 dark:text-zinc-500">
						{t('table.forceStopWarning')}
					</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
