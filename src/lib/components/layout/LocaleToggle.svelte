<script lang="ts">
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
	<TooltipTrigger>
		{#snippet child({ props })}
			<Button
				variant="ghost"
				size="icon-sm"
				class="rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground"
				onclick={toggle}
				aria-label={t('locale.toggle')}
				{...props}
			>
				{label}
			</Button>
		{/snippet}
	</TooltipTrigger>
	<TooltipContent side="right">
		{t('locale.toggle')}
	</TooltipContent>
</Tooltip>
