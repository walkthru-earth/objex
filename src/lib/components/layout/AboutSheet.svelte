<script module lang="ts">
declare const __APP_VERSION__: string;
declare const __THIRD_PARTY_LICENSES__: {
	license: string;
	packages: { name: string; url: string }[];
}[];
</script>

<script lang="ts">
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle
} from '$lib/components/ui/sheet/index.js';
import { t } from '$lib/i18n/index.svelte.js';

interface Props {
	open: boolean;
}

let { open = $bindable(false) }: Props = $props();

let licensesOpen = $state(false);

const version = __APP_VERSION__;

const thirdPartyLicenses = __THIRD_PARTY_LICENSES__;

$effect(() => {
	if (!open) licensesOpen = false;
});
</script>

<Sheet bind:open>
	<SheetContent side="bottom" class="max-h-[85vh] sm:mx-auto sm:max-w-lg sm:rounded-t-lg">
		<SheetHeader>
			<SheetTitle>{t('about.title')}</SheetTitle>
			<SheetDescription class="sr-only">
				{t('about.version', { version })}
			</SheetDescription>
		</SheetHeader>

		<div class="flex flex-col items-center gap-4 overflow-y-auto px-4 py-6 sm:px-6">
			<!-- walkthru.earth logo/link -->
			<a
				href="https://walkthru.earth/links"
				target="_blank"
				rel="noopener noreferrer"
				class="group flex flex-col items-center gap-2 transition-opacity hover:opacity-80"
			>
				<img src="https://walkthru.earth/icon.svg" alt="walkthru.earth" class="size-12" />
				<span class="flex items-center gap-1 text-lg font-semibold text-foreground">
					walkthru.earth
					<ExternalLinkIcon
						class="size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
					/>
				</span>
			</a>

			<!-- Version + License -->
			<div class="flex flex-col items-center gap-1 text-sm text-muted-foreground">
				<span>{t('about.version', { version })}</span>
				<span>{t('about.license')}</span>
			</div>

			<!-- GitHub link -->
			<a
				href="https://github.com/walkthru-earth/objex"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path
						d="M12 .5C5.37.5 0 5.78 0 12.292c0 5.211 3.438 9.63 8.205 11.188.6.111.82-.254.82-.567 0-.279-.01-1.02-.015-2.002-3.338.711-4.042-1.582-4.042-1.582-.546-1.361-1.333-1.724-1.333-1.724-1.089-.731.083-.716.083-.716 1.205.082 1.84 1.215 1.84 1.215 1.07 1.797 2.807 1.278 3.492.977.108-.76.42-1.279.762-1.573-2.665-.295-5.466-1.309-5.466-5.827 0-1.287.465-2.339 1.235-3.164-.135-.295-.54-1.494.105-3.116 0 0 1.005-.31 3.3 1.209.957-.262 1.98-.392 3-.397 1.02.005 2.04.135 3 .397 2.28-1.519 3.285-1.209 3.285-1.209.645 1.622.24 2.821.12 3.116.765.825 1.23 1.877 1.23 3.164 0 4.53-2.805 5.527-5.475 5.817.42.354.81 1.077.81 2.182 0 1.578-.015 2.846-.015 3.229 0 .309.21.678.825.561C20.565 21.917 24 17.495 24 12.292 24 5.78 18.63.5 12 .5z"
					/>
				</svg>
				{t('about.sourceCode')}
			</a>

			<!-- Third-party licenses -->
			<div class="w-full border-t pt-3">
				<button
					class="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onclick={() => {
						licensesOpen = !licensesOpen;
					}}
				>
					<span>{t('about.openSourceLicenses')}</span>
					<ChevronDownIcon
						class="size-3.5 transition-transform {licensesOpen ? 'rotate-180' : ''}"
					/>
				</button>

				{#if licensesOpen}
					<div
						class="mt-2 flex max-h-48 flex-col gap-3 overflow-y-auto rounded-lg bg-muted/40 p-3 sm:max-h-60"
					>
						{#each thirdPartyLicenses as group}
							<div>
								<span
									class="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
								>
									{group.license}
								</span>
								<div class="mt-1.5 flex flex-wrap gap-1">
									{#each group.packages as pkg}
										<a
											href={pkg.url}
											target="_blank"
											rel="noopener noreferrer"
											class="rounded-md border border-border/50 bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
										>
											{pkg.name}
										</a>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</SheetContent>
</Sheet>
