// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Firebase Crashlytics plugin for Mushi Mushi.
 *
 * Because the Firebase Crashlytics REST API does not expose a direct
 * "resolve issue" endpoint, this plugin uses two complementary approaches:
 *
 *   1. Firebase Remote Config — writes a parameter
 *      `mushi_resolved_{reportId}` = `"true"` when `fix.applied` fires.
 *      The mobile app can read this flag at startup to suppress a stale
 *      local crash banner.
 *
 *   2. Firebase Crashlytics Issues API (v1alpha) — if the Crashlytics issue
 *      ID is provided in the event data, POSTs a close request to:
 *        PATCH https://firebase.googleapis.com/v1alpha/projects/{projectId}/
 *              apps/{appId}/issues/{issueId}
 *      with `{ state: "CLOSED" }`.
 *
 * Auth model (simplified — production use):
 *   Google OAuth2 service-account flow:
 *   1. Create a JWT from the service-account key, scoped to
 *      `https://www.googleapis.com/auth/firebase` and
 *      `https://www.googleapis.com/auth/cloud-platform`.
 *   2. Exchange the JWT for a short-lived Bearer access token via
 *      `https://oauth2.googleapis.com/token`.
 *   This plugin accepts a **pre-fetched** access token via the config to
 *   avoid bundling a JWT library.  Rotate the token before it expires (< 1 h).
 *   In production, use `google-auth-library` or a Workload Identity
 *   Federation token provider.
 *
 * Events handled:
 *   - `fix.applied` → Remote Config update + optional Crashlytics issue close
 */

import {
  createPluginHandler,
  type MushiEventEnvelope,
  type MushiFixEvent,
} from '@mushi-mushi/plugin-sdk'

const REMOTE_CONFIG_API = 'https://firebaseremoteconfig.googleapis.com'
const CRASHLYTICS_API = 'https://firebase.googleapis.com'

export interface CrashlyticsPluginConfig {
  /** Firebase project ID (e.g. `my-app-12345`). */
  projectId: string
  /** Firebase app ID (e.g. `1:123456789012:android:abcdef`). */
  appId: string
  /** Service-account email address (informational; used in log messages). */
  serviceAccountEmail: string
  /** Mushi admin base URL. */
  adminBaseUrl: string
  /** Mushi plugin signing secret. */
  mushiSecret: string
  /**
   * Pre-fetched Google OAuth2 Bearer access token.
   * Scopes required: `https://www.googleapis.com/auth/firebase` and
   * `https://www.googleapis.com/auth/cloud-platform`.
   * Rotate before expiry (typically 1 hour after issuance).
   */
  accessToken: string
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

export function createCrashlyticsPlugin(cfg: CrashlyticsPluginConfig) {
  const f = cfg.fetchImpl ?? fetch

  /**
   * Fetch the current Remote Config template, add/update the resolved
   * parameter, and write it back.  Uses an optimistic ETag to avoid
   * clobbering concurrent writes; retries once on ETag mismatch (412).
   */
  async function markResolvedInRemoteConfig(reportId: string): Promise<void> {
    const baseUrl = `${REMOTE_CONFIG_API}/v1/projects/${encodeURIComponent(cfg.projectId)}/remoteConfig`
    const paramKey = `mushi_resolved_${reportId.replace(/-/g, '_')}`

    const getRes = await f(baseUrl, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
    })
    if (!getRes.ok) throw new Error(`Remote Config GET ${getRes.status}: ${await getRes.text()}`)

    const etag = getRes.headers.get('etag') ?? '*'
    const template = (await getRes.json()) as {
      parameters?: Record<string, { defaultValue?: { value?: string } }>
    }

    const parameters = template.parameters ?? {}
    parameters[paramKey] = { defaultValue: { value: 'true' } }

    const putRes = await f(baseUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; UTF-8',
        Authorization: `Bearer ${cfg.accessToken}`,
        'If-Match': etag,
      },
      body: JSON.stringify({ ...template, parameters }),
    })
    if (!putRes.ok) {
      throw new Error(`Remote Config PUT ${putRes.status}: ${await putRes.text()}`)
    }
  }

  /**
   * Close a Crashlytics issue if the issue ID is available.
   * Uses the Firebase Crashlytics Issues v1alpha endpoint.
   */
  async function closeCrashlyticsIssue(issueId: string): Promise<void> {
    const url =
      `${CRASHLYTICS_API}/v1alpha/projects/${encodeURIComponent(cfg.projectId)}` +
      `/apps/${encodeURIComponent(cfg.appId)}/issues/${encodeURIComponent(issueId)}`

    const res = await f(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.accessToken}`,
      },
      body: JSON.stringify({ state: 'CLOSED' }),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Crashlytics close issue ${res.status}: ${await res.text()}`)
    }
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'fix.applied': async (e: MushiEventEnvelope) => {
        const data = e.data as MushiFixEvent & { crashlyticsIssueId?: string }
        const reportId = data.report.id

        await markResolvedInRemoteConfig(reportId)

        if (data.crashlyticsIssueId) {
          await closeCrashlyticsIssue(data.crashlyticsIssueId)
        }
      },
    },
    logger: {
      info: (msg, meta) => console.warn(`[mushi-plugin-crashlytics] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-crashlytics] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-crashlytics] ${msg}`, meta ?? ''),
    },
  })
}
