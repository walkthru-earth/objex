<script lang="ts">
import CheckIcon from '@lucide/svelte/icons/check';
import CopyIcon from '@lucide/svelte/icons/copy';
import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle
} from '$lib/components/ui/sheet/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { appConfig } from '$lib/stores/config.svelte.js';
import { settings } from '$lib/stores/settings.svelte.js';
import type { Theme } from '$lib/types.js';

interface Props {
	open: boolean;
}

let { open = $bindable(false) }: Props = $props();

const themes: Theme[] = ['light', 'dark', 'system'];

let copied = $state(false);

function buildExportConfig(): string {
	const cfg = appConfig.value;
	const exported = {
		defaults: {
			theme: settings.theme,
			locale: settings.locale,
			featureLimit: settings.featureLimit,
			mosaicItemLimit: settings.mosaicItemLimit
		},
		ui: {
			showConnectionRail: settings.showConnectionRail,
			showFileTree: settings.showFileTree,
			showSettings: cfg.ui.showSettings
		},
		basemaps: cfg.basemaps,
		defaultBasemap: cfg.defaultBasemap,
		connections: cfg.connections
	};
	return JSON.stringify(exported, null, 2);
}

async function copyConfig() {
	await navigator.clipboard.writeText(buildExportConfig());
	copied = true;
	setTimeout(() => (copied = false), 1500);
}
</script>

<Sheet bind:open>
	<SheetContent side="bottom" class="max-h-[85vh] sm:mx-auto sm:max-w-lg sm:rounded-t-lg">
		<SheetHeader>
			<SheetTitle>{t('settings.title')}</SheetTitle>
			<SheetDescription class="sr-only">{t('settings.title')}</SheetDescription>
		</SheetHeader>

		<div class="flex flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6">
			{#if appConfig.status === 'custom'}
				<div class="rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary">
					{t('settings.customConfig')}
				</div>
			{/if}

			<!-- Appearance -->
			<section class="flex flex-col gap-2">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('settings.appearance')}
				</h3>
				<div class="flex gap-2">
					{#each themes as th}
						<button
							class="flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors {settings.theme ===
							th
								? 'border-primary bg-primary/10 text-primary'
								: 'border-border text-muted-foreground hover:text-foreground'}"
							onclick={() => settings.setTheme(th)}
						>
							{t(`theme.${th}`)}
						</button>
					{/each}
				</div>
			</section>

			<!-- Language -->
			<section class="flex flex-col gap-2">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('settings.language')}
				</h3>
				<div class="flex gap-2">
					<button
						class="flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors {settings.locale ===
						'en'
							? 'border-primary bg-primary/10 text-primary'
							: 'border-border text-muted-foreground hover:text-foreground'}"
						onclick={() => settings.setLocale('en')}
					>
						English
					</button>
					<button
						class="flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors {settings.locale ===
						'ar'
							? 'border-primary bg-primary/10 text-primary'
							: 'border-border text-muted-foreground hover:text-foreground'}"
						onclick={() => settings.setLocale('ar')}
					>
						العربية
					</button>
				</div>
			</section>

			<!-- Map -->
			{#if appConfig.value.basemaps.length > 0}
				<section class="flex flex-col gap-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{t('settings.map')}
					</h3>
					<div class="flex flex-wrap gap-2">
						<button
							class="rounded-md border px-3 py-1.5 text-sm transition-colors {settings.basemapId ===
							undefined
								? 'border-primary bg-primary/10 text-primary'
								: 'border-border text-muted-foreground hover:text-foreground'}"
							onclick={() => settings.setBasemap(undefined)}
						>
							{t('settings.basemapAuto')}
						</button>
						{#each appConfig.value.basemaps as bm (bm.id)}
							<button
								class="rounded-md border px-3 py-1.5 text-sm transition-colors {settings.basemapId ===
								bm.id
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border text-muted-foreground hover:text-foreground'}"
								onclick={() => settings.setBasemap(bm.id)}
							>
								{bm.label}
							</button>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Data -->
			<section class="flex flex-col gap-3">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('settings.data')}
				</h3>
				<label class="flex flex-col gap-1 text-sm">
					<span>{t('settings.rowLimit')}</span>
					<input
						type="number"
						min="1"
						class="rounded-md border border-border bg-background px-2 py-1 text-sm"
						value={settings.featureLimit}
						onchange={(e) => settings.setFeatureLimit(Number(e.currentTarget.value))}
					/>
					<span class="text-xs text-muted-foreground">{t('settings.rowLimitHelp')}</span>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span>{t('settings.mosaicLimit')}</span>
					<input
						type="number"
						min="1"
						class="rounded-md border border-border bg-background px-2 py-1 text-sm"
						value={settings.mosaicItemLimit}
						onchange={(e) => settings.setMosaicItemLimit(Number(e.currentTarget.value))}
					/>
					<span class="text-xs text-muted-foreground">{t('settings.mosaicLimitHelp')}</span>
				</label>
			</section>

			<!-- Interface -->
			<section class="flex flex-col gap-3">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('settings.interface')}
				</h3>
				<label class="flex items-center justify-between gap-2 text-sm">
					<span class="flex flex-col">
						<span>{t('settings.showConnectionRail')}</span>
						{#if settings.railLockedByParam}
							<span class="text-xs text-muted-foreground">{t('settings.lockedByLink')}</span>
						{/if}
					</span>
					<input
						type="checkbox"
						class="size-4"
						disabled={settings.railLockedByParam}
						checked={settings.showConnectionRail}
						onchange={(e) => settings.setShowConnectionRail(e.currentTarget.checked)}
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-sm">
					<span class="flex flex-col">
						<span>{t('settings.showFileTree')}</span>
						{#if settings.treeLockedByParam}
							<span class="text-xs text-muted-foreground">{t('settings.lockedByLink')}</span>
						{/if}
					</span>
					<input
						type="checkbox"
						class="size-4"
						disabled={settings.treeLockedByParam}
						checked={settings.showFileTree}
						onchange={(e) => settings.setShowFileTree(e.currentTarget.checked)}
					/>
				</label>
			</section>

			<!-- Footer actions -->
			<div class="flex items-center justify-between gap-2 border-t pt-4">
				<button
					class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
					onclick={() => settings.reset()}
				>
					<RotateCcwIcon class="size-3.5" />
					{t('settings.reset')}
				</button>
				<button
					class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					onclick={copyConfig}
				>
					{#if copied}
						<CheckIcon class="size-3.5" />
						{t('settings.copied')}
					{:else}
						<CopyIcon class="size-3.5" />
						{t('settings.copyConfig')}
					{/if}
				</button>
			</div>
		</div>
	</SheetContent>
</Sheet>
