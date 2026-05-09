/**
 * Bugsnag plugin for Mushi Mushi.
 *
 * Bridges Mushi events into the Bugsnag Data API v2 so that user-reported
 * bugs surface alongside automatic error telemetry.
 *
 * Events handled:
 *   - `report.classified` → POST /v2/projects/{projectSlug}/errors
 *       Creates a Bugsnag error with a deterministic groupingHash so that
 *       user-reported issues appear grouped in the Bugsnag dashboard.
 *       The returned error ID is cached (keyed by Mushi report ID) so the
 *       resolve step can look it up.  In production, persist this mapping in
 *       `report_external_issues` rather than relying on the in-memory default.
 *   - `fix.applied` → PATCH /v2/projects/{projectSlug}/errors/{errorId}
 *       Marks the Bugsnag error as fixed.
 *
 * Auth: `Authorization: token {apiKey}` (Bugsnag Data API token).
 */

import {
  createPluginHandler,
  type MushiEventEnvelope,
  type MushiFixEvent,
  type MushiReportClassifiedEvent,
} from '@mushi-mushi/plugin-sdk'

const BUGSNAG_API = 'https://api.bugsnag.com'

export interface BugsnagPluginConfig {
  /** Bugsnag Data API key. */
  apiKey: string
  /** Bugsnag project slug (visible in the project URL). */
  projectSlug: string
  /** Mushi admin base URL used to build deep-link report URLs. */
  adminBaseUrl: string
  /** Mushi plugin signing secret. */
  mushiSecret: string
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Pluggable cache that maps Mushi report IDs to Bugsnag error IDs.
 * The default implementation is an in-memory Map; swap in a database-backed
 * implementation for multi-process / serverless deployments.
 */
export interface BugsnagErrorCache {
  get(reportId: string): string | null | Promise<string | null>
  set(reportId: string, errorId: string): void | Promise<void>
}

export function createBugsnagPlugin(cfg: BugsnagPluginConfig, cache: BugsnagErrorCache = createInMemoryCache()) {
  const f = cfg.fetchImpl ?? fetch
  const adminBase = cfg.adminBaseUrl.replace(/\/$/, '')

  async function createError(envelope: MushiEventEnvelope): Promise<void> {
    const data = envelope.data as MushiReportClassifiedEvent
    const { report, classification } = data

    const body = {
      groupingHash: `mushi-${envelope.projectId}-${report.id}`,
      message: report.title ?? `Mushi report ${report.id}`,
      severity: mapSeverity(classification.severity),
      context: `Mushi/${classification.category}`,
      metaData: {
        mushi: {
          reportId: report.id,
          projectId: envelope.projectId,
          severity: classification.severity,
          category: classification.category,
          confidence: classification.confidence,
          reportUrl: `${adminBase}/reports/${encodeURIComponent(report.id)}`,
        },
      },
    }

    const res = await f(
      `${BUGSNAG_API}/v2/projects/${encodeURIComponent(cfg.projectSlug)}/errors`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `token ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) throw new Error(`Bugsnag create error ${res.status}: ${await res.text()}`)

    const json = (await res.json()) as { id?: string }
    if (json.id) {
      await cache.set(report.id, json.id)
    }
  }

  async function resolveError(envelope: MushiEventEnvelope): Promise<void> {
    const data = envelope.data as MushiFixEvent
    const errorId = await cache.get(data.report.id)
    if (!errorId) return

    const res = await f(
      `${BUGSNAG_API}/v2/projects/${encodeURIComponent(cfg.projectSlug)}/errors/${encodeURIComponent(errorId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `token ${cfg.apiKey}`,
        },
        body: JSON.stringify({ status: 'fixed' }),
      },
    )
    if (!res.ok && res.status !== 404) {
      throw new Error(`Bugsnag resolve error ${res.status}: ${await res.text()}`)
    }
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.classified': async (e) => {
        await createError(e)
      },
      'fix.applied': async (e) => {
        await resolveError(e)
      },
    },
    logger: {
      info: (msg, meta) => console.log(`[mushi-plugin-bugsnag] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-bugsnag] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-bugsnag] ${msg}`, meta ?? ''),
    },
  })
}

function mapSeverity(severity: string): 'error' | 'warning' | 'info' {
  if (severity === 'critical' || severity === 'high') return 'error'
  if (severity === 'medium') return 'warning'
  return 'info'
}

function createInMemoryCache(): BugsnagErrorCache {
  const map = new Map<string, string>()
  return {
    get: (id) => map.get(id) ?? null,
    set: (id, errorId) => {
      map.set(id, errorId)
    },
  }
}
