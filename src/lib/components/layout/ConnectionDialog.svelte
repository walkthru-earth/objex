<script lang="ts">
import CheckIcon from '@lucide/svelte/icons/check';
import CloudIcon from '@lucide/svelte/icons/cloud';
import LinkIcon from '@lucide/svelte/icons/link';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import LockIcon from '@lucide/svelte/icons/lock';
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
import { connections } from '$lib/stores/connections.svelte.js';
import type { Connection, ConnectionConfig } from '$lib/types.js';
import { describeParseResult, looksLikeUrl, parseStorageUrl } from '$lib/utils/storage-url.js';

interface Props {
	open: boolean;
	editConnection?: Connection | null;
	onSaved?: () => void;
}

let { open = $bindable(false), editConnection = null, onSaved = () => {} }: Props = $props();

const providers: Array<{ value: Connection['provider']; label: string }> = [
	{ value: 's3', label: 'S3' },
	{ value: 'gcs', label: 'GCS' },
	{ value: 'r2', label: 'R2' },
	{ value: 'minio', label: 'MinIO' },
	{ value: 'azure', label: 'Azure' },
	{ value: 'storj', label: 'Storj' }
];

// Form state — initialized with defaults, then reset via $effect when editConnection changes
let name = $state('');
let provider = $state<Connection['provider']>('s3');
let bucket = $state('');
let region = $state('us-west-2');
let endpoint = $state('');
let anonymous = $state(true);
let accessKey = $state('');
let secretKey = $state('');
let sasToken = $state('');
let saving = $state(false);
let testing = $state(false);
let testResult = $state<'success' | 'error' | null>(null);
let parsedHint = $state<string | null>(null);

let isAzure = $derived(provider === 'azure');
let isStorj = $derived(provider === 'storj');
let needsRegion = $derived(provider !== 'azure' && provider !== 'r2' && provider !== 'storj');
let bucketLabel = $derived(isAzure ? 'Container' : 'Bucket');

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
	// Auto-detect provider from URL
	const providerMap: Record<string, Connection['provider']> = {
		s3: 's3',
		gcs: 'gcs',
		r2: 'r2',
		minio: 'minio',
		azure: 'azure',
		storj: 'storj'
	};
	if (parsed.provider in providerMap) {
		provider = providerMap[parsed.provider];
	}
	parsedHint = null;
}

let isEditMode = $derived(editConnection !== null && editConnection !== undefined);
let title = $derived(isEditMode ? 'Edit Connection' : 'New Connection');
let canSave = $derived(
	name.trim() !== '' && bucket.trim() !== '' && (!needsRegion || region.trim() !== '')
);

// Reset form fields when editConnection changes
$effect(() => {
	const conn = editConnection;
	name = conn?.name ?? '';
	provider = conn?.provider ?? 's3';
	bucket = conn?.bucket ?? '';
	region = conn?.region ?? 'us-west-2';
	endpoint = conn?.endpoint ?? '';
	anonymous = conn?.anonymous ?? true;
	accessKey = '';
	secretKey = '';
	sasToken = '';
	saving = false;
	testing = false;
	testResult = null;
	parsedHint = null;
});

async function handleSave() {
	if (!canSave) return;
	saving = true;

	// Auto-parse URL in bucket field before saving
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

	try {
		const config: ConnectionConfig = {
			name: name.trim(),
			provider,
			bucket: finalBucket,
			region: finalRegion,
			endpoint: finalEndpoint,
			anonymous,
			authMethod: isAzure && !anonymous ? 'sas-token' : !anonymous ? 'sigv4' : undefined,
			...(anonymous
				? {}
				: isAzure
					? { sas_token: sasToken }
					: { access_key: accessKey, secret_key: secretKey })
		};

		if (isEditMode && editConnection) {
			await connections.update(editConnection.id, config);
		} else {
			await connections.save(config);
		}

		onSaved();
		open = false;
	} catch (err) {
		console.error('Failed to save connection:', err);
	} finally {
		saving = false;
	}
}

async function handleTestConnection() {
	testing = true;
	testResult = null;

	try {
		// Auto-parse URL in bucket field before testing
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

		const config: ConnectionConfig = {
			name: name.trim() || 'test',
			provider,
			bucket: finalBucket,
			region: finalRegion,
			endpoint: finalEndpoint,
			anonymous,
			authMethod: isAzure && !anonymous ? 'sas-token' : !anonymous ? 'sigv4' : undefined,
			...(anonymous
				? {}
				: isAzure
					? { sas_token: sasToken }
					: { access_key: accessKey, secret_key: secretKey })
		};

		const ok = await connections.testWithConfig(config, editConnection?.id);
		testResult = ok ? 'success' : 'error';
	} catch {
		testResult = 'error';
	} finally {
		testing = false;
	}
}

function handleCancel() {
	open = false;
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
					Update the connection settings below.
				{:else}
					Configure a new cloud storage connection.
				{/if}
			</SheetDescription>
		</SheetHeader>

		<div class="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
			<!-- Name -->
			<div class="flex flex-col gap-1.5">
				<label for="conn-name" class="text-sm font-medium">
					Name <span class="text-destructive">*</span>
				</label>
				<Input
					id="conn-name"
					placeholder="e.g. Source Cooperative, My MinIO"
					bind:value={name}
				/>
			</div>

			<!-- Provider -->
			<fieldset class="flex flex-col gap-1.5">
				<legend class="text-sm font-medium">Provider</legend>
				<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Cloud storage provider">
					{#each providers as p (p.value)}
						<Button
							variant={provider === p.value ? 'default' : 'outline'}
							size="sm"
							class="h-8 px-3 text-xs"
							aria-pressed={provider === p.value}
							onclick={() => {
								provider = p.value;
								if (p.value === 'storj' && !endpoint) {
									endpoint = 'https://gateway.storjshare.io';
									region = 'us1';
								}
							}}
						>
							{p.label}
						</Button>
					{/each}
				</div>
			</fieldset>

			<!-- Bucket / Container -->
			<div class="flex flex-col gap-1.5">
				<label for="conn-bucket" class="text-sm font-medium">
					{bucketLabel} <span class="text-destructive">*</span>
				</label>
				<Input
					id="conn-bucket"
					placeholder={isAzure ? 'my-container' : 'my-bucket or s3://bucket or https://endpoint/bucket'}
					value={bucket}
					oninput={(e: Event) => handleBucketInput((e.target as HTMLInputElement).value)}
				/>
				{#if parsedHint}
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-left text-xs text-blue-700 hover:bg-blue-500/20 dark:text-blue-400"
						onclick={applyParsedUrl}
					>
						<LinkIcon class="size-3 shrink-0" />
						<span>{parsedHint} — <strong>click to apply</strong></span>
					</button>
				{/if}
				<p class="text-xs text-muted-foreground">
					{isAzure ? 'Azure Blob container name.' : 'Paste an S3 URL or bucket name. URLs are auto-detected.'}
				</p>
			</div>

			<!-- Region (hidden for Azure and R2) -->
			{#if needsRegion}
				<div class="flex flex-col gap-1.5">
					<label for="conn-region" class="text-sm font-medium">
						Region <span class="text-destructive">*</span>
					</label>
					<Input
						id="conn-region"
						placeholder="us-west-2"
						bind:value={region}
					/>
				</div>
			{/if}

			<!-- Endpoint -->
			<div class="flex flex-col gap-1.5">
				<label for="conn-endpoint" class="text-sm font-medium">Endpoint{isAzure ? ' *' : ''}</label>
				<Input
					id="conn-endpoint"
					placeholder={isAzure
						? 'https://myaccount.blob.core.windows.net'
						: isStorj
							? 'https://gateway.storjshare.io'
							: 'https://custom-endpoint.example.com'}
					bind:value={endpoint}
				/>
				<p class="text-xs text-muted-foreground">
					{isAzure
						? 'Azure Blob Storage endpoint, e.g. https://myaccount.blob.core.windows.net'
						: isStorj
							? 'Storj S3 gateway. Use gateway.us1/eu1/ap1.storjshare.io for a specific region.'
							: 'Leave empty for default AWS endpoint. Required for MinIO, R2, and other S3-compatible services.'}
				</p>
			</div>

			<!-- Anonymous Access -->
			<div class="flex items-center gap-3">
				<button
					type="button"
					role="switch"
					aria-checked={anonymous}
					aria-label="Toggle anonymous access"
					class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background {anonymous ? 'bg-primary' : 'bg-input'}"
					onclick={() => { anonymous = !anonymous; }}
				>
					<span
						class="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform {anonymous ? 'translate-x-4' : 'translate-x-0'}"
					></span>
				</button>
				<span class="text-sm font-medium">Anonymous Access</span>
			</div>

			<!-- Credentials (shown only when not anonymous) -->
			{#if !anonymous}
				<form onsubmit={(e: Event) => e.preventDefault()} class="flex flex-col gap-4 rounded-md border border-border bg-muted/30 p-3">
					{#if isAzure}
						<div class="flex flex-col gap-1.5">
							<label for="conn-sas-token" class="text-sm font-medium">SAS Token</label>
							<Input
								id="conn-sas-token"
								name="password"
								autocomplete="current-password"
								type="password"
								placeholder="sv=2021-06-08&ss=b&srt=sco&sp=rl&se=..."
								bind:value={sasToken}
							/>
							<p class="text-xs text-muted-foreground">
								Shared Access Signature token for Azure Blob Storage.
							</p>
						</div>
					{:else}
						<div class="flex flex-col gap-1.5">
							<label for="conn-access-key" class="text-sm font-medium">Access Key</label>
							<Input
								id="conn-access-key"
								name="username"
								autocomplete="username"
								placeholder="AKIAIOSFODNN7EXAMPLE"
								bind:value={accessKey}
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<label for="conn-secret-key" class="text-sm font-medium">Secret Key</label>
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
						<p>Your credentials are stored only in your browser's password manager if you choose to save them. They are never sent to any external server or stored in local storage.</p>
					</div>
				</form>
			{/if}

			<!-- Test Connection Result -->
			{#if testResult === 'success'}
				<div class="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
					<CheckIcon class="size-4 shrink-0" />
					Connection successful
				</div>
			{:else if testResult === 'error'}
				<div class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					<XIcon class="size-4 shrink-0" />
					Connection failed. Check your settings and try again.
				</div>
			{/if}
		</div>

		<SheetFooter class="flex-row gap-2 border-t pt-4">
			<Button
				variant="outline"
				size="sm"
				disabled={testing || saving || !bucket.trim()}
				onclick={handleTestConnection}
			>
				{#if testing}
					<Loader2Icon class="mr-1.5 size-4 animate-spin" />
					Testing...
				{:else}
					Test Connection
				{/if}
			</Button>

			<div class="flex-1"></div>

			<Button variant="ghost" size="sm" onclick={handleCancel} disabled={saving}>
				Cancel
			</Button>

			<Button
				size="sm"
				disabled={!canSave || saving}
				onclick={handleSave}
			>
				{#if saving}
					<Loader2Icon class="mr-1.5 size-4 animate-spin" />
					Saving...
				{:else}
					{isEditMode ? 'Update' : 'Create'}
				{/if}
			</Button>
		</SheetFooter>
	</SheetContent>
</Sheet>
