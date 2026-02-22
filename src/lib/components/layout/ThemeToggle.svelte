<script lang="ts">
import MonitorIcon from '@lucide/svelte/icons/monitor';
import MoonIcon from '@lucide/svelte/icons/moon';
import SunIcon from '@lucide/svelte/icons/sun';
import { Button } from '$lib/components/ui/button/index.js';
import * as Tooltip from '$lib/components/ui/tooltip/index.js';
import { settings } from '$lib/stores/settings.svelte.js';

const icons = {
	light: SunIcon,
	dark: MoonIcon,
	system: MonitorIcon
} as const;

const labels = {
	light: 'Light',
	dark: 'Dark',
	system: 'System'
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
let label = $derived(labels[settings.theme]);
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={toggle}
					aria-label="Toggle theme"
					{...props}
				>
					<CurrentIcon class="size-4" />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom">
			<p>{label} mode</p>
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
