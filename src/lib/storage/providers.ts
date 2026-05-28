/**
 * Provider registry — single source of truth for all cloud storage providers.
 *
 * Centralizes endpoint patterns, regions, auth methods, and UI metadata.
 * Used by ConnectionDialog, browser-cloud adapter, host-detection, url-state, etc.
 */

// ---------------------------------------------------------------------------
// Provider type — the canonical union used by Connection, ConnectionConfig, etc.
// ---------------------------------------------------------------------------

export type ProviderId =
	| 's3'
	| 'gcs'
	| 'r2'
	| 'minio'
	| 'azure'
	| 'storj'
	| 'b2'
	| 'digitalocean'
	| 'wasabi'
	| 'contabo'
	| 'hetzner'
	| 'linode'
	| 'ovhcloud';

// ---------------------------------------------------------------------------
// Region definition
// ---------------------------------------------------------------------------

export interface ProviderRegion {
	code: string;
	label: string;
}

// ---------------------------------------------------------------------------
// Provider definition
// ---------------------------------------------------------------------------

export interface ProviderDef {
	/** Display label in the UI. */
	label: string;
	/** Short description shown as helper text. */
	description: string;
	/** Auth method used by this provider. */
	authMethod: 'sigv4' | 'sas-token';
	/** Whether the region field is relevant for this provider. */
	needsRegion: boolean;
	/** Whether the endpoint field is required. */
	needsEndpoint: boolean;
	/** Default region when creating a new connection. */
	defaultRegion: string;
	/**
	 * Endpoint template with `{region}` placeholder.
	 * If null, the user must provide a custom endpoint (e.g. MinIO).
	 * If a fixed string (no `{region}`), it's always the same (e.g. GCS).
	 */
	endpointTemplate: string | null;
	/** Known regions with labels. Empty = free-form region input. */
	regions: ProviderRegion[];
	/** Bucket label override (e.g. Azure uses "Container"). */
	bucketLabel?: string;
	/** Default endpoint placeholder shown in the input. */
	endpointPlaceholder: string;
	/** URI schemes that map to this provider (lowercase, without "://"). */
	schemes: string[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
	s3: {
		label: 'AWS S3',
		description: 'Amazon S3 or any S3-compatible service',
		authMethod: 'sigv4',
		needsRegion: true,
		needsEndpoint: false,
		defaultRegion: 'us-east-1',
		endpointTemplate: null,
		regions: [
			{ code: 'us-east-1', label: 'US East (N. Virginia)' },
			{ code: 'us-east-2', label: 'US East (Ohio)' },
			{ code: 'us-west-1', label: 'US West (N. California)' },
			{ code: 'us-west-2', label: 'US West (Oregon)' },
			{ code: 'eu-west-1', label: 'EU (Ireland)' },
			{ code: 'eu-west-2', label: 'EU (London)' },
			{ code: 'eu-west-3', label: 'EU (Paris)' },
			{ code: 'eu-central-1', label: 'EU (Frankfurt)' },
			{ code: 'eu-central-2', label: 'EU (Zurich)' },
			{ code: 'eu-north-1', label: 'EU (Stockholm)' },
			{ code: 'eu-south-1', label: 'EU (Milan)' },
			{ code: 'eu-south-2', label: 'EU (Spain)' },
			{ code: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
			{ code: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
			{ code: 'ap-northeast-3', label: 'Asia Pacific (Osaka)' },
			{ code: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
			{ code: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
			{ code: 'ap-southeast-3', label: 'Asia Pacific (Jakarta)' },
			{ code: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
			{ code: 'ap-south-2', label: 'Asia Pacific (Hyderabad)' },
			{ code: 'ap-east-1', label: 'Asia Pacific (Hong Kong)' },
			{ code: 'sa-east-1', label: 'South America (São Paulo)' },
			{ code: 'ca-central-1', label: 'Canada (Central)' },
			{ code: 'ca-west-1', label: 'Canada (Calgary)' },
			{ code: 'me-south-1', label: 'Middle East (Bahrain)' },
			{ code: 'me-central-1', label: 'Middle East (UAE)' },
			{ code: 'af-south-1', label: 'Africa (Cape Town)' },
			{ code: 'il-central-1', label: 'Israel (Tel Aviv)' }
		],
		endpointPlaceholder: 'Leave empty for AWS, or enter custom S3 endpoint',
		schemes: ['s3', 's3a', 's3n', 'aws']
	},

	gcs: {
		label: 'Google Cloud',
		description: 'Google Cloud Storage',
		authMethod: 'sigv4',
		needsRegion: false,
		needsEndpoint: false,
		defaultRegion: 'auto',
		endpointTemplate: 'https://storage.googleapis.com',
		regions: [],
		endpointPlaceholder: 'https://storage.googleapis.com',
		schemes: ['gs', 'gcs']
	},

	r2: {
		label: 'Cloudflare R2',
		description: 'Cloudflare R2 Storage',
		authMethod: 'sigv4',
		needsRegion: false,
		needsEndpoint: true,
		defaultRegion: 'auto',
		endpointTemplate: null,
		regions: [],
		endpointPlaceholder: 'https://<account-id>.r2.cloudflarestorage.com',
		schemes: ['r2']
	},

	azure: {
		label: 'Azure',
		description: 'Azure Blob Storage',
		authMethod: 'sas-token',
		needsRegion: false,
		needsEndpoint: true,
		defaultRegion: '',
		endpointTemplate: null,
		regions: [],
		bucketLabel: 'Container',
		endpointPlaceholder: 'https://<account>.blob.core.windows.net',
		schemes: ['azure', 'az', 'abfs', 'abfss', 'wasbs', 'adl']
	},

	minio: {
		label: 'MinIO / RustFS / Custom',
		description: 'MinIO, RustFS, or any custom S3-compatible endpoint',
		authMethod: 'sigv4',
		needsRegion: false,
		needsEndpoint: true,
		defaultRegion: 'us-east-1',
		endpointTemplate: null,
		regions: [],
		endpointPlaceholder: 'https://s3.example.com or http://localhost:9000',
		schemes: []
	},

	storj: {
		label: 'Storj',
		description: 'Storj Decentralized Cloud',
		authMethod: 'sigv4',
		needsRegion: false,
		needsEndpoint: false,
		defaultRegion: 'us1',
		endpointTemplate: 'https://gateway.storjshare.io',
		regions: [
			{ code: 'us1', label: 'US1' },
			{ code: 'eu1', label: 'EU1' },
			{ code: 'ap1', label: 'AP1' }
		],
		endpointPlaceholder: 'https://gateway.storjshare.io',
		schemes: ['storj', 'sj']
	},

	b2: {
		label: 'Backblaze B2',
		description: 'Backblaze B2 Cloud Storage',
		authMethod: 'sigv4',
		needsRegion: true,
		needsEndpoint: false,
		defaultRegion: 'us-west-004',
		endpointTemplate: 'https://s3.{region}.backblazeb2.com',
		regions: [
			{ code: 'us-west-000', label: 'US West (Sacramento)' },
			{ code: 'us-west-001', label: 'US West (Stockton)' },
			{ code: 'us-west-002', label: 'US West (Phoenix)' },
			{ code: 'us-west-004', label: 'US West' },
			{ code: 'us-east-005', label: 'US East (Reston)' },
			{ code: 'eu-central-003', label: 'EU Central (Amsterdam)' },
			{ code: 'ca-central-001', label: 'Canada (Toronto)' }
		],
		endpointPlaceholder: 'https://s3.us-west-004.backblazeb2.com',
		schemes: []
	},

	digitalocean: {
		label: 'DigitalOcean',
		description: 'DigitalOcean Spaces',
		authMethod: 'sigv4',
		needsRegion: true,
		needsEndpoint: false,
		defaultRegion: 'nyc3',
		endpointTemplate: 'https://{region}.digitaloceanspaces.com',
		regions: [
			{ code: 'nyc3', label: 'New York 3' },
			{ code: 'sfo3', label: 'San Francisco 3' },
			{ code: 'ams3', label: 'Amsterdam 3' },
			{ code: 'sgp1', label: 'Singapore 1' },
			{ code: 'lon1', label: 'London 1' },
			{ code: 'fra1', label: 'Frankfurt 1' },
			{ code: 'tor1', label: 'Toronto 1' },
			{ code: 'blr1', label: 'Bangalore 1' },
			{ code: 'syd1', label: 'Sydney 1' }
		],
		endpointPlaceholder: 'https://nyc3.digitaloceanspaces.com',
		schemes: []
	},

	wasabi: {
		label: 'Wasabi',
		description: 'Wasabi Hot Cloud Storage',
		authMethod: 'sigv4',
		needsRegion: true,
		needsEndpoint: false,
		defaultRegion: 'us-east-1',
		endpointTemplate: 'https://s3.{region}.wasabisys.com',
		regions: [
			{ code: 'us-east-1', label: 'US East 1 (Virginia)' },
			{ code: 'us-east-2', label: 'US East 2 (Virginia)' },
			{ code: 'us-central-1', label: 'US Central 1 (Texas)' },
			{ code: 'us-west-1', label: 'US West 1 (Oregon)' },
			{ code: 'eu-central-1', label: 'EU Central 1 (Amsterdam)' },
			{ code: 'eu-central-2', label: 'EU Central 2 (Frankfurt)' },
			{ code: 'eu-west-1', label: 'EU West 1 (London)' },
			{ code: 'eu-west-2', label: 'EU West 2 (Paris)' },
			{ code: 'ap-northeast-1', label: 'AP Northeast 1 (Tokyo)' },
			{ code: 'ap-northeast-2', label: 'AP Northeast 2 (Osaka)' },
			{ code: 'ap-southeast-1', label: 'AP Southeast 1 (Singapore)' },
			{ code: 'ap-southeast-2', label: 'AP Southeast 2 (Sydney)' },
			{ code: 'ca-central-1', label: 'Canada (Toronto)' }
		],
		endpointPlaceholder: 'https://s3.us-east-1.wasabisys.com',
		schemes: []
	},

	contabo: {
		label: 'Contabo',
		description: 'Contabo Object Storage',
		authMethod: 'sigv4',
		needsRegion: true,
		needsEndpoint: false,
		defaultRegion: 'eu2',
		endpointTemplate: 'https://{region}.contabostorage.com',
		regions: [
			{ code: 'eu2', label: 'European Union' },
			{ code: 'usc1', label: 'US Central' },
			{ code: 'sin1', label: 'Singapore' }
		],
		endpointPlaceholder: 'https://eu2.contabostorage.com',
		schemes: []
	},

	hetzner: {
		label: 'Hetzner',
		description: 'Hetzner Object Storage',
		authMethod: 'sigv4',
		needsRegion: true,
		needsEndpoint: false,
		defaultRegion: 'fsn1',
		endpointTemplate: 'https://{region}.your-objectstorage.com',
		regions: [
			{ code: 'fsn1', label: 'Falkenstein, DE' },
			{ code: 'nbg1', label: 'Nuremberg, DE' },
			{ code: 'hel1', label: 'Helsinki, FI' }
		],
		endpointPlaceholder: 'https://fsn1.your-objectstorage.com',
		schemes: []
	},

	linode: {
		label: 'Linode / Akamai',
		description: 'Akamai / Linode Object Storage',
		authMethod: 'sigv4',
		needsRegion: true,
		needsEndpoint: false,
		defaultRegion: 'us-east-1',
		endpointTemplate: 'https://{region}.linodeobjects.com',
		regions: [
			{ code: 'us-east-1', label: 'Newark, NJ' },
			{ code: 'us-southeast-1', label: 'Atlanta, GA' },
			{ code: 'us-ord-1', label: 'Chicago, IL' },
			{ code: 'us-iad-1', label: 'Washington, DC' },
			{ code: 'us-lax-1', label: 'Los Angeles, CA' },
			{ code: 'us-sea-1', label: 'Seattle, WA' },
			{ code: 'us-mia-1', label: 'Miami, FL' },
			{ code: 'eu-central-1', label: 'Frankfurt, DE' },
			{ code: 'nl-ams-1', label: 'Amsterdam, NL' },
			{ code: 'gb-lon-1', label: 'London, UK' },
			{ code: 'fr-par-1', label: 'Paris, FR' },
			{ code: 'ap-south-1', label: 'Singapore' },
			{ code: 'jp-osa-1', label: 'Osaka, JP' },
			{ code: 'au-mel-1', label: 'Melbourne, AU' },
			{ code: 'br-gru-1', label: 'São Paulo, BR' },
			{ code: 'in-maa-1', label: 'Chennai, IN' },
			{ code: 'id-cgk-1', label: 'Jakarta, ID' },
			{ code: 'it-mil-1', label: 'Milan, IT' },
			{ code: 'se-sto-1', label: 'Stockholm, SE' }
		],
		endpointPlaceholder: 'https://us-east-1.linodeobjects.com',
		schemes: []
	},

	ovhcloud: {
		label: 'OVHcloud',
		description: 'OVHcloud Object Storage',
		authMethod: 'sigv4',
		needsRegion: true,
		needsEndpoint: false,
		defaultRegion: 'gra',
		endpointTemplate: 'https://s3.{region}.io.cloud.ovh.net',
		regions: [
			{ code: 'gra', label: 'Gravelines, FR' },
			{ code: 'sbg', label: 'Strasbourg, FR' },
			{ code: 'bhs', label: 'Beauharnois, CA' },
			{ code: 'de', label: 'Frankfurt, DE' },
			{ code: 'uk', label: 'London, UK' },
			{ code: 'waw', label: 'Warsaw, PL' }
		],
		endpointPlaceholder: 'https://s3.gra.io.cloud.ovh.net',
		schemes: []
	}
};

// ---------------------------------------------------------------------------
// CORS help — provider-specific browser access guidance
// ---------------------------------------------------------------------------

export interface CorsHelp {
	/** True if the provider returns CORS headers by default. */
	defaultEnabled: boolean;
	/** Official CORS configuration docs URL. */
	docsUrl?: string;
	/** Brief note shown in the UI. */
	note?: string;
	/** CLI steps when no console UI or docs are insufficient. */
	cliSteps?: string[];
}

export const CORS_HELP: Record<ProviderId, CorsHelp> = {
	s3: {
		defaultEnabled: false,
		docsUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/enabling-cors-examples.html',
		note: 'Enable via S3 Console: Bucket > Permissions > CORS, or use the AWS CLI.'
	},
	gcs: {
		defaultEnabled: false,
		docsUrl: 'https://cloud.google.com/storage/docs/using-cors',
		note: 'Use the gcloud CLI. GCS `responseHeader` is dual-purpose (Access-Control-Expose-Headers AND Access-Control-Allow-Headers), so every request header the browser sends must be listed or the preflight fails silently. For private buckets signed with HMAC, include the AWS SigV4 headers (Authorization, x-amz-date, x-amz-content-sha256). For DuckDB httpfs partial reads, also include Range and the conditional If-* headers.',
		cliSteps: [
			'Create a cors.json file:\n[\n  {\n    "origin": ["*"],\n    "method": ["GET", "HEAD"],\n    "responseHeader": [\n      "Content-Type",\n      "Content-Length",\n      "Content-Range",\n      "Accept-Ranges",\n      "Range",\n      "If-Match",\n      "If-Modified-Since",\n      "If-None-Match",\n      "If-Unmodified-Since",\n      "ETag",\n      "Authorization",\n      "x-amz-content-sha256",\n      "x-amz-date",\n      "x-amz-*",\n      "x-goog-*"\n    ],\n    "maxAgeSeconds": 3600\n  }\n]',
			'gcloud storage buckets update gs://BUCKET --cors-file=cors.json'
		]
	},
	r2: {
		defaultEnabled: false,
		docsUrl: 'https://developers.cloudflare.com/r2/buckets/cors/',
		note: 'Enable via R2 Dashboard: Bucket > Settings > CORS Policy.'
	},
	azure: {
		defaultEnabled: false,
		docsUrl:
			'https://learn.microsoft.com/en-us/rest/api/storageservices/cross-origin-resource-sharing--cors--support-for-the-azure-storage-services',
		note: 'Enable via Azure Portal: Storage Account > Blob Service > CORS, or use the Azure CLI.',
		cliSteps: [
			'az storage cors add --services b --methods GET HEAD \\\n  --origins "*" --allowed-headers "*" \\\n  --exposed-headers "*" --max-age 3600 \\\n  --account-name ACCOUNT'
		]
	},
	minio: {
		defaultEnabled: true,
		docsUrl: 'https://docs.min.io/enterprise/aistor-object-store/reference/cli/mc-cors/',
		note: 'MinIO allows all origins by default (for custom rules use mc cors set). For RustFS or any other custom S3 service, set a CORS policy on the server that allows this origin.'
	},
	storj: {
		defaultEnabled: true,
		note: 'Storj S3 gateway returns CORS headers by default.'
	},
	b2: {
		defaultEnabled: false,
		docsUrl: 'https://www.backblaze.com/docs/cloud-storage-cross-origin-resource-sharing-rules',
		note: 'Enable via B2 Console: Bucket Settings > CORS Rules, or use the B2 CLI.',
		cliSteps: [
			'b2 bucket update --cors-rules \'[{\n  "corsRuleName": "allow-all",\n  "allowedOrigins": ["*"],\n  "allowedOperations": ["s3_head", "s3_get"],\n  "allowedHeaders": ["*"],\n  "maxAgeSeconds": 3600\n}]\' BUCKET allPublic'
		]
	},
	digitalocean: {
		defaultEnabled: false,
		docsUrl: 'https://docs.digitalocean.com/products/spaces/how-to/configure-cors/',
		note: 'Enable via Control Panel: Space > Settings > CORS Configurations.'
	},
	wasabi: {
		defaultEnabled: true,
		docsUrl: 'https://docs.wasabi.com/docs/bucket-policy',
		note: 'Wasabi returns CORS headers by default for all buckets.'
	},
	contabo: {
		defaultEnabled: false,
		note: 'S3-compatible CORS via the AWS CLI.',
		cliSteps: [
			'Create a cors.json file:\n{\n  "CORSRules": [{\n    "AllowedOrigins": ["*"],\n    "AllowedMethods": ["GET", "HEAD"],\n    "AllowedHeaders": ["*"],\n    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Content-Range", "Accept-Ranges"],\n    "MaxAgeSeconds": 3600\n  }]\n}',
			'aws s3api put-bucket-cors --bucket BUCKET \\\n  --cors-configuration file://cors.json \\\n  --endpoint-url https://REGION.contaboobj.com'
		]
	},
	hetzner: {
		defaultEnabled: false,
		docsUrl: 'https://docs.hetzner.com/storage/object-storage/howto-protect-objects/cors/',
		note: 'S3-compatible CORS via the AWS CLI.',
		cliSteps: [
			'Create a cors.json file:\n{\n  "CORSRules": [{\n    "AllowedOrigins": ["*"],\n    "AllowedMethods": ["GET", "HEAD"],\n    "AllowedHeaders": ["*"],\n    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Content-Range", "Accept-Ranges"],\n    "MaxAgeSeconds": 3600\n  }]\n}',
			'aws s3api put-bucket-cors --bucket BUCKET \\\n  --cors-configuration file://cors.json \\\n  --endpoint-url https://REGION.your-objectstorage.com \\\n  --region REGION'
		]
	},
	linode: {
		defaultEnabled: false,
		docsUrl: 'https://www.linode.com/docs/guides/working-with-cors-linode-object-storage/',
		note: 'S3-compatible CORS via the AWS CLI.',
		cliSteps: [
			'Create a cors.json file:\n{\n  "CORSRules": [{\n    "AllowedOrigins": ["*"],\n    "AllowedMethods": ["GET", "HEAD"],\n    "AllowedHeaders": ["*"],\n    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Content-Range", "Accept-Ranges"],\n    "MaxAgeSeconds": 3600\n  }]\n}',
			'aws s3api put-bucket-cors --bucket BUCKET \\\n  --cors-configuration file://cors.json \\\n  --endpoint-url https://REGION.linodeobjects.com'
		]
	},
	ovhcloud: {
		defaultEnabled: false,
		docsUrl:
			'https://help.ovhcloud.com/csm/en-public-cloud-storage-s3-cors?id=kb_article_view&sysparm_article=KB0058291',
		note: 'S3-compatible CORS via the AWS CLI.',
		cliSteps: [
			'Create a cors.json file:\n{\n  "CORSRules": [{\n    "AllowedOrigins": ["*"],\n    "AllowedMethods": ["GET", "HEAD"],\n    "AllowedHeaders": ["*"],\n    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type", "Content-Range", "Accept-Ranges"],\n    "MaxAgeSeconds": 3600\n  }]\n}',
			'aws s3api put-bucket-cors --bucket BUCKET \\\n  --cors-configuration file://cors.json \\\n  --endpoint-url https://s3.REGION.io.cloud.ovh.net'
		]
	}
};

// ---------------------------------------------------------------------------
// Read-only access help — provider-specific bucket policy guidance
// ---------------------------------------------------------------------------

export interface ReadOnlyHelp {
	/** Brief note shown in the UI. */
	note: string;
	/** Official docs URL. */
	docsUrl?: string;
	/** CLI steps to apply a read-only bucket policy. */
	cliSteps?: string[];
}

export const READ_ONLY_HELP: Partial<Record<ProviderId, ReadOnlyHelp>> = {
	s3: {
		note: 'Use IAM policies to create a read-only user, or apply a bucket policy that allows only s3:GetObject and s3:ListBucket.',
		docsUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-policies-s3.html'
	},
	gcs: {
		note: 'Assign the Storage Object Viewer role (roles/storage.objectViewer) to the service account.',
		docsUrl: 'https://cloud.google.com/storage/docs/access-control/iam-roles'
	},
	r2: {
		note: 'Create an API token with Object Read permissions in the R2 dashboard.',
		docsUrl: 'https://developers.cloudflare.com/r2/api/tokens/'
	},
	azure: {
		note: 'Generate a SAS token with Read and List permissions only. Avoid granting Write or Delete.',
		docsUrl: 'https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview'
	},
	b2: {
		note: 'Create an application key with readFiles and listBuckets capabilities only.',
		docsUrl: 'https://www.backblaze.com/docs/cloud-storage-application-keys'
	},
	hetzner: {
		note: 'Keys have full read/write by default. Use a bucket policy with the correct ARN format to deny write and policy actions. To undo, generate a new admin key from the Hetzner Console.',
		docsUrl:
			'https://docs.hetzner.com/storage/object-storage/faq/s3-credentials/#how-do-i-restrict-access-per-key',
		cliSteps: [
			'Find your project ID from the Hetzner Console URL:\nhttps://console.hetzner.com/projects/<PROJECT_ID>/servers',
			'Create a policy.json file:\n{\n  "Version": "2012-10-17",\n  "Statement": [\n    {\n      "Sid": "DenyWrites",\n      "Effect": "Deny",\n      "Principal": {\n        "AWS": "arn:aws:iam:::user/p<PROJECT_ID>:<ACCESS_KEY>"\n      },\n      "Action": [\n        "s3:PutObject",\n        "s3:DeleteObject",\n        "s3:AbortMultipartUpload",\n        "s3:PutBucketPolicy",\n        "s3:DeleteBucketPolicy"\n      ],\n      "Resource": [\n        "arn:aws:s3:::BUCKET",\n        "arn:aws:s3:::BUCKET/*"\n      ]\n    }\n  ]\n}',
			'aws s3api put-bucket-policy --bucket BUCKET \\\n  --policy file://policy.json \\\n  --endpoint-url https://REGION.your-objectstorage.com \\\n  --region REGION',
			'Note: This key can no longer modify the policy.\nTo restore write access, generate a new key in the\nHetzner Console and use it to delete the policy.'
		]
	},
	minio: {
		note: 'For MinIO, create a read-only policy with mc admin policy or use the built-in readonly canned policy. For RustFS or any other custom S3 service, attach a read-only bucket policy on the server.',
		docsUrl: 'https://docs.min.io/enterprise/aistor-object-store/administration/iam/access/'
	},
	digitalocean: {
		note: 'Spaces keys are project-wide. Use a bucket policy to restrict write actions for a specific key.',
		docsUrl: 'https://docs.digitalocean.com/products/spaces/how-to/manage-access/'
	},
	wasabi: {
		note: 'Create a sub-user with a read-only policy in the Wasabi Console.',
		docsUrl: 'https://docs.wasabi.com/docs/creating-a-user-account-and-access-key'
	},
	contabo: {
		note: 'S3-compatible bucket policies. Use a Deny policy for write actions with the key ARN.',
		cliSteps: [
			'Create a policy.json with a Deny statement for s3:PutObject and s3:DeleteObject.',
			'aws s3api put-bucket-policy --bucket BUCKET \\\n  --policy file://policy.json \\\n  --endpoint-url https://REGION.contaboobj.com'
		]
	}
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All provider IDs, ordered for the UI. */
export const PROVIDER_IDS: ProviderId[] = [
	's3',
	'gcs',
	'r2',
	'azure',
	'b2',
	'digitalocean',
	'wasabi',
	'storj',
	'hetzner',
	'contabo',
	'linode',
	'ovhcloud',
	'minio'
];

/** Get provider def, falling back to S3 for unknown. */
export function getProvider(id: string): ProviderDef {
	return PROVIDERS[id as ProviderId] ?? PROVIDERS.s3;
}

/** Build endpoint URL from template + region. */
export function buildEndpointFromTemplate(id: ProviderId, region: string): string {
	const def = PROVIDERS[id];
	if (!def?.endpointTemplate) return '';
	return def.endpointTemplate.replace('{region}', region);
}

/**
 * Resolve an endpoint URL for a provider using its registered template,
 * falling back to the provider's default region when none is supplied.
 * Returns '' when the provider has no template (e.g. plain S3 or MinIO).
 */
export function resolveProviderEndpoint(provider: string, region?: string): string {
	const def = PROVIDERS[provider as ProviderId];
	if (!def?.endpointTemplate) return '';
	return buildEndpointFromTemplate(provider as ProviderId, region || def.defaultRegion);
}

/**
 * Build the base URL for API requests (endpoint + bucket).
 * Used by browser-cloud adapter and url-state.
 */
export function buildProviderBaseUrl(
	provider: ProviderId,
	endpoint: string,
	bucket: string,
	region: string
): string {
	if (endpoint) {
		return `${endpoint.replace(/\/$/, '')}/${bucket}`;
	}
	const def = PROVIDERS[provider];
	if (def?.endpointTemplate) {
		const resolved = def.endpointTemplate.replace('{region}', region || def.defaultRegion);
		return `${resolved}/${bucket}`;
	}
	// Fallback: AWS S3 path-style
	return `https://s3.${region || 'us-east-1'}.amazonaws.com/${bucket}`;
}

/** Check if a provider uses the GCS JSON API (not S3 XML). */
export function isGcsProvider(provider: string, endpoint: string): boolean {
	return provider === 'gcs' || (!!endpoint && /storage\.googleapis\.com/i.test(endpoint));
}

// ---------------------------------------------------------------------------
// Access mode — single source of truth for how any HTTP client (DuckDB httpfs,
// COG/Zarr/PMTiles libraries, fetch, img, video) can read files for a given
// connection. Used by url.ts (URL construction), query/wasm.ts (S3 config
// short-circuit), canStreamDirectly (viewer routing).
// ---------------------------------------------------------------------------

/**
 * Minimal connection shape needed to decide access mode.
 * Kept loose so callers don't need to import the full Connection type.
 */
export interface AccessModeInput {
	provider: string;
	anonymous?: boolean;
	endpoint?: string;
}

/**
 * How a connection's files can be read by the browser:
 *
 * - `public-https`: plain HTTPS via any HTTP client. No auth, no signing.
 *   Covers anonymous AWS/GCS/R2/Storj/Wasabi/etc.
 * - `sas-https`: HTTPS with SAS token embedded in the URL. Still works with
 *   any HTTP client. Azure only.
 * - `signed-s3`: requires SigV4 signing. DuckDB uses the `s3://` URI and
 *   signs it via its S3 config; other viewers must go through the storage
 *   adapter (which returns a blob) instead of streaming the HTTPS URL.
 */
export type AccessMode = 'public-https' | 'sas-https' | 'signed-s3';

export function getAccessMode(conn: AccessModeInput): AccessMode {
	if (conn.provider === 'azure') return 'sas-https';
	// Anonymous buckets: every provider serves files over plain HTTPS without
	// signing (AWS path/vhost, GCS, R2 public, Storj, Wasabi, DO, etc.).
	if (conn.anonymous) return 'public-https';
	// Authenticated: needs SigV4 signing.
	return 'signed-s3';
}

/**
 * True when the connection's files can be fetched by any HTTP client
 * (fetch/img/video/DuckDB httpfs/COG/Zarr/etc.) without the storage adapter.
 */
export function isPubliclyStreamable(conn: AccessModeInput): boolean {
	const mode = getAccessMode(conn);
	return mode === 'public-https' || mode === 'sas-https';
}
