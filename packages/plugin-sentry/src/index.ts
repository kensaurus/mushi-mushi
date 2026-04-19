/**
 * Sentry plugin for Mushi Mushi.
 *
 * Mushi already *consumes* Sentry data via the Seer poller / webhook
 * (`packages/server/.../sentry-seer-poll` and `_shared/seer.ts`); this plugin
 * is the complementary outbound bridge:
 *
 *   - On `report.classified` with severity ≥ threshold (default `high`):
 *       capture an event in Sentry with a deterministic
 *       `fingerprint = ['mushi', projectId, reportId]` so user-reported
 *       criticals show up next to telemetry-only errors.
 *
 *   - On `fix.applied` (and `fix.proposed` if `markInProgress` is set):
 *       emit an `info` event with the same fingerprint to flag the issue
 *       as fixed, tag the linked PR, and — when an org auth token is
 *       supplied — call the Sentry Issues API to actually mark the
 *       matching issue `resolved`.
 *
 * Auth model:
 *   - The store endpoint uses the project DSN (no token required).
 *   - The optional resolve step uses an org-scoped auth token with
 *     `event:admin` and `project:read` scopes. If the token is omitted
 *     we still record the fix event but don't try to resolve.
 */

import {
  createPluginHandler,
  type MushiEventEnvelope,
  type MushiFixEvent,
  type MushiReportClassifiedEvent,
} from '@mushi-mushi/plugin-sdk'

const SEVERITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

const SEVERITY_TO_SENTRY_LEVEL: Record<string, SentryLevel> = {
  critical: 'fatal',
  high: 'error',
  medium: 'warning',
  low: 'info',
}

type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

export interface SentryPluginConfig {
  /** Project DSN — used for the store endpoint. */
  sentryDsn: string
  /** Mushi plugin signing secret. */
  mushiSecret: string
  /** Lowest classified-severity that mirrors into Sentry. Default `high`. */
  severityThreshold?: 'low' | 'medium' | 'high' | 'critical'
  /**
   * Org-scoped auth token (`event:admin` + `project:read`). When present,
   * `fix.applied` events also call `PUT /api/0/projects/.../issues/?...` to
   * mark the matching Sentry issue resolved. Optional.
   */
  sentryAuthToken?: string
  /** Sentry org slug, required if `sentryAuthToken` is set. */
  sentryOrgSlug?: string
  /** Sentry project slug, required if `sentryAuthToken` is set. */
  sentryProjectSlug?: string
  /** Whether `fix.proposed` should also annotate Sentry. Default `false`. */
  markInProgress?: boolean
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

interface DsnParts {
  storeUrl: string
  authHeader: string
  projectId: string
  hostname: string
}

export function createSentryPlugin(cfg: SentryPluginConfig) {
  const minRank = SEVERITY_RANK[cfg.severityThreshold ?? 'high']!
  const f = cfg.fetchImpl ?? fetch
  const dsn = parseDsn(cfg.sentryDsn)

  async function captureEvent(
    envelope: MushiEventEnvelope,
    level: SentryLevel,
    message: string,
    extraTags: Record<string, string>,
  ): Promise<void> {
    const reportId = (envelope.data as { report?: { id?: string } })?.report?.id ?? envelope.deliveryId
    const event = {
      event_id: envelope.deliveryId.replace(/-/g, ''),
      timestamp: envelope.occurredAt,
      level,
      logger: 'mushi-mushi',
      platform: 'other',
      message: { formatted: message },
      fingerprint: ['mushi', envelope.projectId, reportId],
      tags: {
        'mushi.event': envelope.event,
        'mushi.project_id': envelope.projectId,
        'mushi.report_id': reportId,
        ...extraTags,
      },
      extra: { envelope },
    }

    const res = await f(dsn.storeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': dsn.authHeader,
      },
      body: JSON.stringify(event),
    })
    if (!res.ok) throw new Error(`Sentry store ${res.status}: ${await res.text()}`)
  }

  async function resolveIssue(envelope: MushiEventEnvelope, fix: MushiFixEvent['fix']): Promise<void> {
    if (!cfg.sentryAuthToken || !cfg.sentryOrgSlug || !cfg.sentryProjectSlug) return
    const reportId = (envelope.data as { report?: { id?: string } })?.report?.id ?? envelope.deliveryId
    // Match by the same tag we set on capture so we don't accidentally resolve
    // unrelated Sentry issues that happen to share a message string.
    const query = encodeURIComponent(`mushi.report_id:${reportId}`)
    const url = `https://sentry.io/api/0/projects/${cfg.sentryOrgSlug}/${cfg.sentryProjectSlug}/issues/?query=${query}`
    const res = await f(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.sentryAuthToken}`,
      },
      body: JSON.stringify({
        status: 'resolved',
        statusDetails: fix.pullRequestUrl ? { inCommit: { commit: fix.pullRequestUrl } } : {},
      }),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Sentry resolve ${res.status}: ${await res.text()}`)
    }
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.classified': async (e) => {
        const data = e.data as MushiReportClassifiedEvent
        const rank = SEVERITY_RANK[data.classification.severity ?? ''] ?? 0
        if (rank < minRank) return
        const level = SEVERITY_TO_SENTRY_LEVEL[data.classification.severity] ?? 'error'
        await captureEvent(
          e,
          level,
          data.report.title ?? `Mushi report ${data.report.id}`,
          {
            'mushi.severity': data.classification.severity,
            'mushi.category': data.classification.category,
            'mushi.confidence': String(data.classification.confidence),
          },
        )
      },
      'fix.proposed': async (e) => {
        if (!cfg.markInProgress) return
        const data = e.data as MushiFixEvent
        await captureEvent(e, 'info', `Mushi fix proposed for ${data.report.id}`, {
          'mushi.fix_status': data.fix.status,
          ...(data.fix.pullRequestUrl ? { 'mushi.pr_url': data.fix.pullRequestUrl } : {}),
        })
      },
      'fix.applied': async (e) => {
        const data = e.data as MushiFixEvent
        await captureEvent(e, 'info', `Mushi fix applied for ${data.report.id}`, {
          'mushi.fix_status': data.fix.status,
          'mushi.fixed': 'true',
          ...(data.fix.pullRequestUrl ? { 'mushi.pr_url': data.fix.pullRequestUrl } : {}),
        })
        await resolveIssue(e, data.fix)
      },
    },
    logger: {
      info: (msg, meta) => console.warn(`[mushi-plugin-sentry] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-sentry] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-sentry] ${msg}`, meta ?? ''),
    },
  })
}

/**
 * Parse a Sentry DSN of the form
 *   https://<publicKey>@oORG.ingest.sentry.io/<projectId>
 * into the store endpoint URL + the X-Sentry-Auth header.
 *
 * Sentry hasn't required a `secret` in the DSN since 2017, so we ignore it
 * if present.
 */
function parseDsn(dsnString: string): DsnParts {
  let url: URL
  try {
    url = new URL(dsnString)
  } catch {
    throw new Error(`Invalid Sentry DSN: ${dsnString}`)
  }
  const publicKey = url.username
  if (!publicKey) throw new Error('Sentry DSN missing public key')
  const projectId = url.pathname.replace(/^\//, '').split('/').pop()
  if (!projectId) throw new Error('Sentry DSN missing project id')
  const storeUrl = `${url.protocol}//${url.host}/api/${projectId}/store/`
  const authHeader = [
    'Sentry sentry_version=7',
    'sentry_client=mushi-plugin-sentry/0.2.0',
    `sentry_key=${publicKey}`,
  ].join(', ')
  return { storeUrl, authHeader, projectId, hostname: url.host }
}

export const __testing = { parseDsn }
