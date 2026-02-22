<script lang="ts">
let { styleUrl, onclose }: { styleUrl: string; onclose: () => void } = $props();

const maputnikUrl = $derived(
	`https://maplibre.org/maputnik/?style=${encodeURIComponent(styleUrl)}`
);
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-zinc-950">
	<div
		class="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2"
	>
		<span class="text-sm font-medium text-zinc-300">Maputnik Style Editor</span>
		<button
			class="rounded px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
			onclick={onclose}
		>
			Close
		</button>
	</div>
	<iframe
		src={maputnikUrl}
		class="flex-1 border-0"
		title="Maputnik Style Editor"
		allow="clipboard-read; clipboard-write"
	></iframe>
</div>
