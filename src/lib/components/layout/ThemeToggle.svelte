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
		{#snippet child({ props })}
			<Button
				variant="ghost"
				size="icon-sm"
				class="rounded-lg text-muted-foreground hover:text-foreground"
				onclick={toggle}
				aria-label={t('theme.tooltip', { mode: label })}
				{...props}
			>
				<CurrentIcon class="size-4" />
			</Button>
		{/snippet}
	</TooltipTrigger>
	<TooltipContent side="right">
		{t('theme.tooltip', { mode: label })}
	</TooltipContent>
</Tooltip>
