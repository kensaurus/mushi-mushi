// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Rollbar plugin for Mushi Mushi.
 *
 * Bridges Mushi events into Rollbar so that user-reported bugs appear
 * alongside automatic error telemetry in the Rollbar dashboard.
 *
 * Events handled:
 *   - `report.classified` → POST https://api.rollbar.com/api/1/item/
 *       Creates a Rollbar item (occurrence) for the classified report.
 *       The returned item ID is cached by Mushi report ID so the resolve
 *       step can close it.  In production, swap the default in-memory cache
 *       for a durable store.
 *   - `fix.applied` → PATCH https://api.rollbar.com/api/1/item/{id}
 *       Sets the Rollbar item status to `resolved`.
 *
 * Auth: `X-Rollbar-Access-Token: {accessToken}` header (write-level project
 * token).
 */

import {
  createPluginHandler,
  type MushiEventEnvelope,
  type MushiFixEvent,
  type MushiReportClassifiedEvent,
} from '@mushi-mushi/plugin-sdk'

const ROLLBAR_API = 'https://api.rollbar.com'

export interface RollbarPluginConfig {
  /** Rollbar write-level project access token. */
  accessToken: string
  /** Rollbar project ID (visible in Project Settings). */
  projectId: string
  /** Mushi admin base URL used to build deep-link report URLs. */
  adminBaseUrl: string
  /** Mushi plugin signing secret. */
  mushiSecret: string
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch
}

/**
 * Pluggable cache mapping Mushi report IDs to Rollbar item IDs.
 * Default is an in-memory Map; replace with a database-backed store for
 * multi-process / serverless deployments.
 */
export interface RollbarItemCache {
  get(reportId: string): string | null | Promise<string | null>
  set(reportId: string, itemId: string): void | Promise<void>
}

const SEVERITY_TO_ROLLBAR: Record<string, string> = {
  critical: 'critical',
  high: 'error',
  medium: 'warning',
  low: 'info',
}

export function createRollbarPlugin(cfg: RollbarPluginConfig, cache: RollbarItemCache = createInMemoryCache()) {
  const f = cfg.fetchImpl ?? fetch
  const adminBase = cfg.adminBaseUrl.replace(/\/$/, '')

  async function createItem(envelope: MushiEventEnvelope): Promise<void> {
    const data = envelope.data as MushiReportClassifiedEvent
    const { report, classification } = data
    const level = SEVERITY_TO_ROLLBAR[classification.severity] ?? 'error'

    const body = {
      data: {
        environment: 'production',
        level,
        timestamp: Math.floor(new Date(envelope.occurredAt).getTime() / 1000),
        body: {
          message: {
            body: report.title ?? `Mushi report ${report.id}`,
          },
        },
        fingerprint: `mushi-${envelope.projectId}-${report.id}`,
        title: report.title ?? `Mushi report ${report.id}`,
        custom: {
          mushi_report_id: report.id,
          mushi_project_id: envelope.projectId,
          mushi_severity: classification.severity,
          mushi_category: classification.category,
          mushi_confidence: classification.confidence,
          mushi_report_url: `${adminBase}/reports/${encodeURIComponent(report.id)}`,
        },
      },
    }

    const res = await f(`${ROLLBAR_API}/api/1/item/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Rollbar-Access-Token': cfg.accessToken,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Rollbar create item ${res.status}: ${await res.text()}`)

    const json = (await res.json()) as { result?: { id?: number | string } }
    const itemId = String(json.result?.id ?? '')
    if (itemId) {
      await cache.set(report.id, itemId)
    }
  }

  async function resolveItem(envelope: MushiEventEnvelope): Promise<void> {
    const data = envelope.data as MushiFixEvent
    const itemId = await cache.get(data.report.id)
    if (!itemId) return

    const res = await f(`${ROLLBAR_API}/api/1/item/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Rollbar-Access-Token': cfg.accessToken,
      },
      body: JSON.stringify({ status: 'resolved' }),
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Rollbar resolve item ${res.status}: ${await res.text()}`)
    }
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.classified': async (e) => {
        await createItem(e)
      },
      'fix.applied': async (e) => {
        await resolveItem(e)
      },
    },
    logger: {
      info: (msg, meta) => console.warn(`[mushi-plugin-rollbar] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-rollbar] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-rollbar] ${msg}`, meta ?? ''),
    },
  })
}

function createInMemoryCache(): RollbarItemCache {
  const map = new Map<string, string>()
  return {
    get: (id) => map.get(id) ?? null,
    set: (id, itemId) => {
      map.set(id, itemId)
    },
  }
}
