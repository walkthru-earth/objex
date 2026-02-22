<script lang="ts">
import MonitorIcon from '@lucide/svelte/icons/monitor';
import MoonIcon from '@lucide/svelte/icons/moon';
import SunIcon from '@lucide/svelte/icons/sun';
import { Button } from '$lib/components/ui/button/index.js';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger
} from '$lib/components/ui/tooltip/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { settings } from '$lib/stores/settings.svelte.js';

const icons = {
	light: SunIcon,
	dark: MoonIcon,
	system: MonitorIcon
} as const;

const cycle: Record<string, 'light' | 'dark' | 'system'> = {
	light: 'dark',
	dark: 'system',
	system: 'light'
};

function toggle() {
	settings.setTheme(cycle[settings.theme]);
}

let CurrentIcon = $derived(icons[settings.theme]);
let label = $derived(t(`theme.${settings.theme}`));
</script>

<Tooltip>
	<TooltipTrigger>
		<button
			class="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
			onclick={toggle}
			aria-label={t('theme.tooltip', { mode: label })}
		>
			<CurrentIcon class="size-4" />
		</button>
	</TooltipTrigger>
	<TooltipContent side="right">
		{t('theme.tooltip', { mode: label })}
	</TooltipContent>
</Tooltip>
