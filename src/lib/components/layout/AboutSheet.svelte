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
import GithubIcon from '@lucide/svelte/icons/github';
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
				<GithubIcon class="size-4" />
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
