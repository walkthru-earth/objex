<script lang="ts">
import LockIcon from '@lucide/svelte/icons/lock';
import LockOpenIcon from '@lucide/svelte/icons/lock-open';
import * as Tooltip from '$lib/components/ui/tooltip/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { safeLock } from '$lib/stores/safelock.svelte.js';

safeLock.init();
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					class="inline-flex size-5 items-center justify-center rounded transition-colors hover:bg-accent"
					aria-label={safeLock.locked ? t('safeLock.enabledAria') : t('safeLock.disabledAria')}
					onclick={() => safeLock.toggle()}
				>
					{#if safeLock.locked}
						<LockIcon class="size-3 text-amber-500" />
					{:else}
						<LockOpenIcon class="size-3 text-green-500" />
					{/if}
				</button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>
			{#if safeLock.locked}
				{t('safeLock.enabledTooltip')}
			{:else}
				{t('safeLock.disabledTooltip')}
			{/if}
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
