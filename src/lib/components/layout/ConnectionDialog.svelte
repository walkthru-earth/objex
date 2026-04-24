<script lang="ts">
import CheckIcon from '@lucide/svelte/icons/check';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import CloudIcon from '@lucide/svelte/icons/cloud';
import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
import GlobeIcon from '@lucide/svelte/icons/globe';
import LinkIcon from '@lucide/svelte/icons/link';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import LockIcon from '@lucide/svelte/icons/lock';
import PlugZapIcon from '@lucide/svelte/icons/plug-zap';
import ShieldIcon from '@lucide/svelte/icons/shield';
import XIcon from '@lucide/svelte/icons/x';
import { Button } from '$lib/components/ui/button/index.js';
import { Input } from '$lib/components/ui/input/index.js';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle
} from '$lib/components/ui/sheet/index.js';
import { Switch } from '$lib/components/ui/switch/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import {
	buildEndpointFromTemplate,
	CORS_HELP,
	getProvider,
	PROVIDER_IDS,
	PROVIDERS,
	type ProviderId,
	READ_ONLY_HELP
} from '$lib/storage/providers.js';
import { connections, DuplicateConnectionError } from '$lib/stores/connections.svelte.js';
import type { Connection, ConnectionConfig } from '$lib/types.js';
import { describeParseResult, looksLikeUrl, parseStorageUrl } from '$lib/utils/storage-url.js';

interface Props {
	open: boolean;
	editConnection?: Connection | null;
	onSaved?: () => void;
	onClose?: () => void;
}

let {
	open = $bindable(false),
	editConnection = null,
	onSaved = () => {},
	onClose = () => {}
}: Props = $props();

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

let name = $state('');
let provider = $state<ProviderId>('s3');
let bucket = $state('');
let region = $state('us-east-1');
let endpoint = $state('');
let anonymous = $state(true);
let accessKey = $state('');
let secretKey = $state('');
let sasToken = $state('');
let saving = $state(false);
let testing = $state(false);
let testResult = $state<'success' | 'error' | null>(null);
let duplicateNotice = $state<{ kind: 'merged' | 'blocked'; name: string } | null>(null);
let parsedHint = $state<string | null>(null);
let endpointAutoFilled = $state(false);

// ---------------------------------------------------------------------------
// Derived state from provider registry
// ---------------------------------------------------------------------------

let providerDef = $derived(getProvider(provider));
let isAzure = $derived(provider === 'azure');
let hasRegions = $derived(providerDef.regions.length > 0);
let needsRegion = $derived(providerDef.needsRegion);
let bucketLabel = $derived(providerDef.bucketLabel ?? t('connection.bucket'));
let corsHelp = $derived(CORS_HELP[provider]);
let readOnlyHelp = $derived(READ_ONLY_HELP[provider]);

let isEditMode = $derived(editConnection !== null && editConnection !== undefined);
let title = $derived(isEditMode ? t('connection.editTitle') : t('connection.newTitle'));
let canSave = $derived(
	name.trim() !== '' &&
		bucket.trim() !== '' &&
		(!needsRegion || region.trim() !== '') &&
		(!providerDef.needsEndpoint || endpoint.trim() !== '')
);

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function resetForm(conn: Connection | null | undefined) {
	const def = conn ? getProvider(conn.provider) : PROVIDERS.s3;
	name = conn?.name ?? '';
	provider = (conn?.provider as ProviderId) ?? 's3';
	bucket = conn?.bucket ?? '';
	region = conn?.region ?? def.defaultRegion;
	endpoint = conn?.endpoint ?? '';
	anonymous = conn?.anonymous ?? true;
	accessKey = '';
	secretKey = '';
	sasToken = '';
	saving = false;
	testing = false;
	testResult = null;
	parsedHint = null;
	endpointAutoFilled = false;
	duplicateNotice = null;
}

function selectProvider(id: ProviderId) {
	const prev = provider;
	if (id === prev) return;

	provider = id;
	const def = getProvider(id);

	// Clear auto-filled endpoint from previous provider
	if (endpointAutoFilled) {
		endpoint = '';
		endpointAutoFilled = false;
	}

	// Set default region
	region = def.defaultRegion;

	// Auto-fill endpoint from template if available and not user-typed
	if (!endpoint && def.endpointTemplate) {
		endpoint = buildEndpointFromTemplate(id, def.defaultRegion);
		endpointAutoFilled = true;
	}
}

function selectRegion(regionCode: string) {
	region = regionCode;
	// Update endpoint if it was auto-filled from template
	if (endpointAutoFilled && providerDef.endpointTemplate) {
		endpoint = buildEndpointFromTemplate(provider, regionCode);
	}
}

function handleBucketInput(value: string) {
	bucket = value;
	if (looksLikeUrl(value)) {
		const parsed = parseStorageUrl(value, {
			region: region || undefined,
			endpoint: endpoint || undefined
		});
		parsedHint = describeParseResult(parsed);
	} else {
		parsedHint = null;
	}
}

function applyParsedUrl() {
	const parsed = parseStorageUrl(bucket, {
		region: region || undefined,
		endpoint: endpoint || undefined
	});
	bucket = parsed.bucket;
	if (parsed.endpoint) endpoint = parsed.endpoint;
	if (parsed.region) region = parsed.region;
	if (parsed.provider && parsed.provider !== 'unknown' && parsed.provider in PROVIDERS) {
		provider = parsed.provider as ProviderId;
	}
	parsedHint = null;
}

function buildConfig(fallbackName?: string): ConnectionConfig {
	let finalBucket = bucket.trim();
	let finalRegion = region.trim();
	let finalEndpoint = endpoint.trim();
	if (looksLikeUrl(finalBucket)) {
		const parsed = parseStorageUrl(finalBucket, {
			region: finalRegion || undefined,
			endpoint: finalEndpoint || undefined
		});
		finalBucket = parsed.bucket;
		if (parsed.endpoint) finalEndpoint = parsed.endpoint;
		if (parsed.region) finalRegion = parsed.region;
	}
	const def = getProvider(provider);
	return {
		name: name.trim() || fallbackName || '',
		provider,
		bucket: finalBucket,
		region: finalRegion,
		endpoint: finalEndpoint,
		anonymous,
		authMethod:
			def.authMethod === 'sas-token' && !anonymous ? 'sas-token' : !anonymous ? 'sigv4' : undefined,
		...(anonymous
			? {}
			: def.authMethod === 'sas-token'
				? { sas_token: sasToken }
				: { access_key: accessKey, secret_key: secretKey })
	};
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

// Reset form when dialog opens
$effect(() => {
	if (open) {
		resetForm(editConnection);
	}
});

// Notify parent when dialog closes
$effect(() => {
	if (!open) {
		onClose();
	}
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleSave() {
	if (!canSave) return;
	saving = true;
	duplicateNotice = null;
	try {
		const config = buildConfig();
		if (isEditMode && editConnection) {
			await connections.update(editConnection.id, config);
		} else {
			const result = await connections.save(config);
			if (result.existed) {
				const existing = connections.getById(result.id);
				duplicateNotice = { kind: 'merged', name: existing?.name ?? config.name };
				// Keep the dialog open briefly so the user sees the notice, then close.
				saving = false;
				setTimeout(() => {
					onSaved();
					open = false;
				}, 1200);
				return;
			}
		}
		onSaved();
		open = false;
	} catch (err) {
		if (err instanceof DuplicateConnectionError) {
			duplicateNotice = { kind: 'blocked', name: err.existingName };
		} else {
			console.error('Failed to save connection:', err);
		}
	} finally {
		saving = false;
	}
}

async function handleTestConnection() {
	testing = true;
	testResult = null;
	try {
		const config = buildConfig('test');
		const ok = await connections.testWithConfig(config, editConnection?.id);
		testResult = ok ? 'success' : 'error';
	} catch {
		testResult = 'error';
	} finally {
		testing = false;
	}
}
</script>

<Sheet bind:open>
	<SheetContent side="right" class="flex flex-col sm:max-w-md">
		<SheetHeader>
			<div class="flex items-center gap-2">
				<CloudIcon class="size-5 text-primary" />
				<SheetTitle>{title}</SheetTitle>
			</div>
			<SheetDescription>
				{#if isEditMode}
					{t('connection.editDescription')}
				{:else}
					{t('connection.newDescription')}
				{/if}
			</SheetDescription>
		</SheetHeader>

		<div class="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
			<!-- Name -->
			<div class="flex flex-col gap-1.5">
				<label for="conn-name" class="text-sm font-medium">
					{t('connection.name')} <span class="text-destructive">*</span>
				</label>
				<Input
					id="conn-name"
					placeholder="e.g. Source Cooperative, My MinIO"
					bind:value={name}
				/>
			</div>

			<!-- Provider -->
			<fieldset class="flex flex-col gap-1.5">
				<legend class="text-sm font-medium">{t('connection.provider')}</legend>
				<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cloud storage provider">
					{#each PROVIDER_IDS as id (id)}
						<Button
							variant={provider === id ? 'default' : 'outline'}
							size="sm"
							class="h-7 px-2.5 text-xs"
							aria-pressed={provider === id}
							onclick={() => selectProvider(id)}
						>
							{PROVIDERS[id].label}
						</Button>
					{/each}
				</div>
				<p class="text-xs text-muted-foreground">{providerDef.description}</p>
			</fieldset>

			<!-- Bucket / Container -->
			<div class="flex flex-col gap-1.5">
				<label for="conn-bucket" class="text-sm font-medium">
					{bucketLabel} <span class="text-destructive">*</span>
				</label>
				<Input
					id="conn-bucket"
					placeholder={isAzure ? t('connection.containerPlaceholder') : t('connection.bucketPlaceholder')}
					value={bucket}
					oninput={(e: Event) => handleBucketInput((e.target as HTMLInputElement).value)}
				/>
				{#if parsedHint}
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-start text-xs text-blue-700 hover:bg-blue-500/20 dark:text-blue-400"
						onclick={applyParsedUrl}
					>
						<LinkIcon class="size-3 shrink-0" />
						<span>{parsedHint} <strong>{t('connection.clickToApply')}</strong></span>
					</button>
				{/if}
				<p class="text-xs text-muted-foreground">
					{isAzure ? t('connection.azureBucketHelper') : t('connection.s3BucketHelper')}
				</p>
			</div>

			<!-- Region -->
			{#if needsRegion}
				<div class="flex flex-col gap-1.5">
					<label for="conn-region" class="text-sm font-medium">
						{t('connection.region')} <span class="text-destructive">*</span>
					</label>
					{#if hasRegions}
						<!-- Dropdown for providers with known regions -->
						<select
							id="conn-region"
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={region}
							onchange={(e) => selectRegion((e.target as HTMLSelectElement).value)}
						>
							{#each providerDef.regions as r (r.code)}
								<option value={r.code}>{r.label} ({r.code})</option>
							{/each}
						</select>
					{:else}
						<Input
							id="conn-region"
							placeholder={providerDef.defaultRegion}
							bind:value={region}
						/>
					{/if}
				</div>
			{/if}

			<!-- Endpoint -->
			<div class="flex flex-col gap-1.5">
				<label for="conn-endpoint" class="text-sm font-medium">
					{t('connection.endpoint')}{providerDef.needsEndpoint ? ' *' : ''}
				</label>
				<Input
					id="conn-endpoint"
					placeholder={providerDef.endpointPlaceholder}
					bind:value={endpoint}
					oninput={() => {
						endpointAutoFilled = false;
					}}
				/>
				{#if providerDef.endpointTemplate && !providerDef.needsEndpoint}
					<p class="text-xs text-muted-foreground">
						{t('connection.endpointHelper')}
					</p>
				{:else if isAzure}
					<p class="text-xs text-muted-foreground">
						{t('connection.azureEndpointHelper')}
					</p>
				{:else}
					<p class="text-xs text-muted-foreground">
						{t('connection.endpointHelper')}
					</p>
				{/if}
			</div>

			<!-- Anonymous Access -->
			<div class="flex items-center gap-3">
				<Switch bind:checked={anonymous} aria-label={t('connection.anonymous')} />
				<span class="text-sm font-medium">{t('connection.anonymous')}</span>
			</div>

			<!-- Credentials (shown only when not anonymous) -->
			{#if !anonymous}
				<form onsubmit={(e: Event) => e.preventDefault()} class="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-3">
					{#if isAzure}
						<div class="flex flex-col gap-1.5">
							<label for="conn-sas-token" class="text-sm font-medium">{t('connection.sasToken')}</label>
							<Input
								id="conn-sas-token"
								name="password"
								autocomplete="current-password"
								type="password"
								placeholder="sv=2021-06-08&ss=b&srt=sco&sp=rl&se=..."
								bind:value={sasToken}
							/>
							<p class="text-xs text-muted-foreground">
								{t('connection.sasTokenHelper')}
							</p>
						</div>
					{:else}
						<div class="flex flex-col gap-1.5">
							<label for="conn-access-key" class="text-sm font-medium">{t('connection.accessKey')}</label>
							<Input
								id="conn-access-key"
								name="username"
								autocomplete="username"
								placeholder="AKIAIOSFODNN7EXAMPLE"
								bind:value={accessKey}
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<label for="conn-secret-key" class="text-sm font-medium">{t('connection.secretKey')}</label>
							<Input
								id="conn-secret-key"
								name="password"
								autocomplete="current-password"
								type="password"
								placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
								bind:value={secretKey}
							/>
						</div>
					{/if}

					<div class="flex items-start gap-1.5 text-xs text-muted-foreground">
						<LockIcon class="mt-0.5 size-3 shrink-0" />
						<p>{t('connection.credentialNotice')}</p>
					</div>
				</form>
			{/if}

			<!-- CORS Help -->
			{#if corsHelp}
				<details class="group rounded-md border border-border">
					<summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<ChevronRightIcon class="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
						<GlobeIcon class="size-3.5 shrink-0" />
						{t('connection.corsTitle')}
					</summary>
					<div class="flex flex-col gap-2.5 border-t border-border px-3 py-2.5">
						{#if corsHelp.defaultEnabled}
							<div class="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
								<CheckIcon class="size-3 shrink-0" />
								<span>{t('connection.corsDefault')}</span>
							</div>
						{:else}
							<p class="text-xs text-muted-foreground">{t('connection.corsRequired')}</p>
						{/if}

						{#if corsHelp.note}
							<p class="text-xs text-muted-foreground">{corsHelp.note}</p>
						{/if}

						{#if corsHelp.docsUrl}
							<a
								href={corsHelp.docsUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
							>
								<ExternalLinkIcon class="size-3 shrink-0" />
								{t('connection.corsDocs')}
							</a>
						{/if}

						{#if corsHelp.cliSteps && corsHelp.cliSteps.length > 0}
							<details class="group/cli">
								<summary class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
									<ChevronRightIcon class="size-3 shrink-0 transition-transform group-open/cli:rotate-90" />
									{t('connection.corsCliTitle')}
								</summary>
								<div class="mt-1.5 flex flex-col gap-1.5">
									{#each corsHelp.cliSteps as step, i}
										<pre class="overflow-x-auto rounded bg-muted px-2.5 py-2 text-[11px] leading-relaxed">{step}</pre>
									{/each}
								</div>
							</details>
						{/if}
					</div>
				</details>
			{/if}

			<!-- Read-Only Access Help -->
			{#if readOnlyHelp}
				<details class="group rounded-md border border-border">
					<summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<ChevronRightIcon class="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
						<ShieldIcon class="size-3.5 shrink-0" />
						{t('connection.readOnlyTitle')}
					</summary>
					<div class="flex flex-col gap-2.5 border-t border-border px-3 py-2.5">
						<p class="text-xs text-muted-foreground">{readOnlyHelp.note}</p>

						{#if readOnlyHelp.docsUrl}
							<a
								href={readOnlyHelp.docsUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
							>
								<ExternalLinkIcon class="size-3 shrink-0" />
								{t('connection.readOnlyDocs')}
							</a>
						{/if}

						{#if readOnlyHelp.cliSteps && readOnlyHelp.cliSteps.length > 0}
							<details class="group/ro">
								<summary class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
									<ChevronRightIcon class="size-3 shrink-0 transition-transform group-open/ro:rotate-90" />
									{t('connection.readOnlyCliTitle')}
								</summary>
								<div class="mt-1.5 flex flex-col gap-1.5">
									{#each readOnlyHelp.cliSteps as step, i}
										<pre class="overflow-x-auto rounded bg-muted px-2.5 py-2 text-[11px] leading-relaxed">{step}</pre>
									{/each}
								</div>
							</details>
						{/if}
					</div>
				</details>
			{/if}

			<!-- Duplicate-connection notice -->
			{#if duplicateNotice}
				<div
					class="flex items-start gap-2 rounded-md border px-3 py-2 text-sm {duplicateNotice.kind === 'merged' ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'border-destructive/30 bg-destructive/10 text-destructive'}"
				>
					<CloudIcon class="mt-0.5 size-4 shrink-0" />
					<span>
						{duplicateNotice.kind === 'merged'
							? t('connection.duplicateMerged', { name: duplicateNotice.name })
							: t('connection.duplicateBlocked', { name: duplicateNotice.name })}
					</span>
				</div>
			{/if}

			<!-- Test Connection Result -->
			{#if testResult === 'success'}
				<div class="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
					<CheckIcon class="size-4 shrink-0" />
					{t('connection.testSuccess')}
				</div>
			{:else if testResult === 'error'}
				<div class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					<XIcon class="size-4 shrink-0" />
					{t('connection.testFail')}
				</div>
			{/if}
		</div>

		<SheetFooter class="flex-row flex-wrap gap-2 border-t pt-4">
			<Button
				variant="outline"
				size="icon-sm"
				class="sm:h-8 sm:w-auto sm:px-3"
				disabled={testing || saving || !bucket.trim()}
				onclick={handleTestConnection}
				title={t('connection.testButton')}
			>
				{#if testing}
					<Loader2Icon class="size-4 animate-spin" />
				{:else}
					<PlugZapIcon class="size-4" />
				{/if}
				<span class="hidden sm:inline">{testing ? t('connection.testing') : t('connection.testButton')}</span>
			</Button>

			<div class="flex min-w-0 flex-1 justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving}>
					{t('connection.cancel')}
				</Button>

				<Button
					size="sm"
					disabled={!canSave || saving}
					onclick={handleSave}
				>
					{#if saving}
						<Loader2Icon class="me-1.5 size-4 animate-spin" />
						{t('connection.saving')}
					{:else}
						{isEditMode ? t('connection.update') : t('connection.create')}
					{/if}
				</Button>
			</div>
		</SheetFooter>
	</SheetContent>
</Sheet>
