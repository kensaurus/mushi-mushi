// ============================================================
// integration-health-probe — every 15 minutes (pg_cron)
//
// Sweeps every project that has at least one configured integration
// and writes one `integration_health_history` row per (project, kind)
// with source='cron'. This keeps the /integrations page status chips
// fresh without requiring the user to manually click "Test".
//
// Cost note:
//   Anthropic/OpenAI probes (1-token each) fire only once per cron
//   run (not once per project) since those keys are server-level env
//   vars shared across all projects. All other probes are per-project
//   and use no-cost or near-zero-cost API calls.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import {
  probeIntegration,
  type IntegrationKind,
} from '../_shared/integration-probes.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const plog = log.child('integration-health-probe')

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

interface PlatformSettingsRow {
  project_id: string
  sentry_org_slug: string | null
  sentry_auth_token_ref: string | null
  langfuse_host: string | null
  langfuse_public_key_ref: string | null
  langfuse_secret_key_ref: string | null
  github_repo_url: string | null
  github_installation_token_ref: string | null
}

interface RoutingRow {
  project_id: string
  integration_type: string
  config: Record<string, unknown>
}

interface ProbeTask {
  projectId: string
  kind: IntegrationKind
  settings: PlatformSettingsRow
  routingConfig: Record<string, unknown>
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function hasSentry(s: PlatformSettingsRow): boolean {
  return !!(s.sentry_auth_token_ref && s.sentry_org_slug)
}

function hasLangfuse(s: PlatformSettingsRow): boolean {
  return !!(
    (s.langfuse_public_key_ref && s.langfuse_secret_key_ref) ||
    (Deno.env.get('LANGFUSE_PUBLIC_KEY') && Deno.env.get('LANGFUSE_SECRET_KEY'))
  )
}

function hasGithub(s: PlatformSettingsRow): boolean {
  return !!(s.github_repo_url && s.github_installation_token_ref)
}

// Map project_integrations.integration_type → probe kind.
// 'github' in routing is stored as 'github' but probed as 'github_issues'
// to distinguish it from the platform GitHub (code-repo) integration.
function routingTypeToKind(type: string): IntegrationKind | null {
  const map: Record<string, IntegrationKind> = {
    jira: 'jira',
    linear: 'linear',
    github: 'github_issues',
    pagerduty: 'pagerduty',
  }
  return map[type] ?? null
}

// ──────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const authResult = requireServiceRoleAuth(req)
  if (authResult) return authResult

  const db = getServiceClient()
  const cron = await startCronRun(db, 'integration-health-probe', 'cron')

  try {
    // ── 1. Load all project_settings rows ──────────────────────────────
    const { data: settingsRows, error: settingsErr } = await db
      .from('project_settings')
      .select(
        'project_id, sentry_org_slug, sentry_auth_token_ref, langfuse_host, langfuse_public_key_ref, langfuse_secret_key_ref, github_repo_url, github_installation_token_ref',
      )
    if (settingsErr) throw new Error(`project_settings load failed: ${settingsErr.message}`)
    const allSettings = (settingsRows ?? []) as PlatformSettingsRow[]

    // ── 2. Load all active routing integrations ─────────────────────────
    const { data: routingRows, error: routingErr } = await db
      .from('project_integrations')
      .select('project_id, integration_type, config')
      .eq('is_active', true)
    if (routingErr) {
      plog.warn('project_integrations load failed', { error: routingErr.message })
    }
    const allRouting = (routingRows ?? []) as RoutingRow[]

    // ── 2b. Load active reward_webhooks (P3 extension) ──────────────────
    const { data: rewardWebhookRows } = await db
      .from('reward_webhooks')
      .select('id, project_id, organization_id, url, secret_hash, enabled')
      .eq('enabled', true)

    // ── 3. Build probe task list ────────────────────────────────────────
    const tasks: ProbeTask[] = []

    for (const s of allSettings) {
      if (hasSentry(s)) tasks.push({ projectId: s.project_id, kind: 'sentry', settings: s, routingConfig: {} })
      if (hasLangfuse(s)) tasks.push({ projectId: s.project_id, kind: 'langfuse', settings: s, routingConfig: {} })
      if (hasGithub(s)) tasks.push({ projectId: s.project_id, kind: 'github', settings: s, routingConfig: {} })
    }

    for (const r of allRouting) {
      const kind = routingTypeToKind(r.integration_type)
      if (!kind) continue
      // Find the matching settings row (or use empty defaults).
      const settings = allSettings.find((s) => s.project_id === r.project_id) ?? ({} as PlatformSettingsRow)
      tasks.push({ projectId: r.project_id, kind, settings, routingConfig: r.config })
    }

    // Add reward_webhook probes (P3)
    for (const wh of (rewardWebhookRows ?? []) as Array<{ id: string; project_id: string | null; organization_id: string; url: string; secret_hash: string | null; enabled: boolean }>) {
      const projectId = wh.project_id ?? allSettings.find((s) => s.project_id)?.project_id
      if (!projectId) continue
      const settings = allSettings.find((s) => s.project_id === projectId) ?? ({} as PlatformSettingsRow)
      tasks.push({
        projectId,
        kind: 'reward_webhook' as const,
        settings,
        routingConfig: { webhook_url: wh.url, secret_hash: wh.secret_hash ?? undefined },
      })
    }

    // ── 4. Server-level probes (anthropic / openai) ─────────────────────
    // These keys are env-level, not per-project. Probe once against the
    // first project that has a settings row so the history row has a valid
    // project_id FK. Skip if no projects exist yet.
    if (allSettings.length > 0) {
      const anchorProjectId = allSettings[0].project_id
      const anchorSettings = allSettings[0]
      if (Deno.env.get('ANTHROPIC_API_KEY')) {
        tasks.push({ projectId: anchorProjectId, kind: 'anthropic', settings: anchorSettings, routingConfig: {} })
      }
      if (Deno.env.get('OPENAI_API_KEY')) {
        tasks.push({ projectId: anchorProjectId, kind: 'openai', settings: anchorSettings, routingConfig: {} })
      }
    }

    plog.info('integration-health-probe.start', { tasks: tasks.length })

    // ── 5. Run probes and insert results ────────────────────────────────
    // Run in parallel with a concurrency cap so we don't hammer providers.
    const CONCURRENCY = 5
    let probed = 0
    const historyRows: Array<{
      project_id: string
      kind: string
      status: string
      latency_ms: number
      message: string | null
      source: string
    }> = []

    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (t) => {
          const probe = await probeIntegration(t.kind, db, t.settings, t.routingConfig)
          return { task: t, probe }
        }),
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { task, probe } = r.value
          historyRows.push({
            project_id: task.projectId,
            kind: task.kind,
            status: probe.status,
            latency_ms: probe.latencyMs,
            message: probe.detail || (probe.httpStatus ? `HTTP ${probe.httpStatus}` : null),
            source: 'cron',
          })
          probed++
        } else {
          plog.warn('probe threw', { error: String(r.reason) })
        }
      }
    }

    // Bulk insert all history rows in one round-trip.
    if (historyRows.length > 0) {
      const { error: insertErr } = await db.from('integration_health_history').insert(historyRows)
      if (insertErr) plog.warn('history insert failed', { error: insertErr.message })
    }

    await cron.finish({ rowsAffected: probed, metadata: { tasks: tasks.length, probed } })
    return new Response(
      JSON.stringify({ ok: true, data: { probed } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    await cron.fail(err)
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'PROBE_FAILED', message: String(err) } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('integration-health-probe', handler))
}
