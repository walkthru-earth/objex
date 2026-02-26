<script lang="ts">
import LanguagesIcon from '@lucide/svelte/icons/languages';
import { Button } from '$lib/components/ui/button/index.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { settings } from '$lib/stores/settings.svelte.js';

function toggle() {
	settings.setLocale(settings.locale === 'en' ? 'ar' : 'en');
}

const label = $derived(settings.locale === 'en' ? 'EN' : 'AR');
</script>

<Tooltip>
	<TooltipTrigger onclick={toggle}>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-sm"
				class="rounded-lg text-muted-foreground hover:text-foreground"
				aria-label={t('locale.toggle')}
			>
				<LanguagesIcon class="size-4" />
			</Button>
		{/snippet}
	</TooltipTrigger>
	<TooltipContent side="right">
		{label} — {t('locale.toggle')}
	</TooltipContent>
</Tooltip>
