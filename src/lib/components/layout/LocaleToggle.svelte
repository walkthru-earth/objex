<script lang="ts">
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
		<button
			class="flex size-8 items-center justify-center rounded-lg text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
			onclick={toggle}
			aria-label={t('locale.toggle')}
		>
			{label}
		</button>
	</TooltipTrigger>
	<TooltipContent side="right">
		{t('locale.toggle')}
	</TooltipContent>
</Tooltip>
