/**
 * PostHog analytics — cookieless by default (memory persistence).
 *
 * Env vars (PUBLIC_ prefix = available client-side in SvelteKit):
 *   PUBLIC_POSTHOG_KEY  — project API key
 *   PUBLIC_POSTHOG_HOST — ingestion endpoint (default: EU cloud)
 */

import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

let initialized = false;

export function initAnalytics() {
	if (!browser || initialized) return;

	const key = env.PUBLIC_POSTHOG_KEY;
	if (!key) return; // silently skip if no key configured

	const host = env.PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

	posthog.init(key, {
		api_host: host,
		person_profiles: 'identified_only',
		capture_pageview: false, // we track manually via afterNavigate
		capture_pageleave: true,
		persistence: 'memory', // cookieless — no consent banner needed
		autocapture: true
	});

	initialized = true;
}

export function capturePageview(url: string) {
	if (!initialized) return;
	posthog.capture('$pageview', { $current_url: url });
}

export function capturePageleave() {
	if (!initialized) return;
	posthog.capture('$pageleave');
}
