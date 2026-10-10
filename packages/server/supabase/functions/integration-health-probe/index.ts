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
//
// Also, per run:
//   - BYOK keys (`byok_keys`) are probed at most once a day each
//     (_shared/byok-health.ts). A 401 marks the key auth_failed and writes
//     a `down` health row for that provider.
//   - The radar pass (radar-pass.ts) writes each project's Mushi setup
//     checks (byok_key_invalid, spend_cap_unset, webhook_never_delivered,
//     index_branch_mismatch, index_stale) once a day as a `radar` gate run.
//   A failure in any of these fails the cron run (cron.fail + Sentry); it
//   never reports success over a check that did not run.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { safeErrorResponse } from '../_shared/safe-error.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import {
  historyHttpStatus,
  probeIntegration,
  type IntegrationKind,
} from '../_shared/integration-probes.ts'
import { isOperatorUser } from '../_shared/operator-gate.ts'
import { reportError } from '../_shared/sentry.ts'
import {
  healthRowsFromOutcomes,
  probeByokRow,
  selectDueByokKeys,
  type ByokKeyRow,
  type ByokProbeOutcome,
} from '../_shared/byok-health.ts'
import { lookupGithubRepoFacts } from '../_shared/github-branch.ts'
import { resolveProjectGithubToken } from '../_shared/github.ts'
import { runRadarPass } from './radar-pass.ts'

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
  claude_api_key_ref: string | null
  cursor_api_key_ref: string | null
  // Linear — vault-backed (added in migration 20260718000001_linear_integration)
  linear_api_key_ref: string | null
  linear_access_token_ref: string | null
  // Slack: a vaulted per-project bot, or a channel posted to by the operator bot.
  slack_bot_token_ref: string | null
  slack_channel_id: string | null
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

function hasClaudeCodeAgent(s: PlatformSettingsRow): boolean {
  return !!s.claude_api_key_ref
}

function hasCursorCloud(s: PlatformSettingsRow): boolean {
  return !!s.cursor_api_key_ref
}

/** Returns true when the project has vault-backed Linear platform credentials. */
function hasLinearPlatform(s: PlatformSettingsRow): boolean {
  return !!(s.linear_access_token_ref || s.linear_api_key_ref)
}

/** Slack is set up when a bot token is vaulted or a channel is picked (operator bot). */
function hasSlack(s: PlatformSettingsRow): boolean {
  return !!(s.slack_bot_token_ref || s.slack_channel_id)
}

// Map project_integrations.integration_type → probe kind.
// 'github' in routing is stored as 'github' but probed as 'github_issues'
// to distinguish it from the platform GitHub (code-repo) integration.
// Note: 'linear' is no longer in the routing map — it now lives in project_settings
// (platform settings) and is probed via hasLinearPlatform + the 'linear' kind.
// Legacy project_integrations rows with integration_type='linear' will fall through
// routingTypeToKind as null and be silently skipped.
function routingTypeToKind(type: string): IntegrationKind | null {
  const map: Record<string, IntegrationKind> = {
    jira: 'jira',
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
    // ── 1. Load all project_settings rows + org mappings + org settings ──
    const [
      { data: settingsRows, error: settingsErr },
      { data: projectOrgRows },
      { data: orgSettingsRows },
    ] = await Promise.all([
      db
        .from('project_settings')
        .select(
          'project_id, sentry_org_slug, sentry_auth_token_ref, langfuse_host, langfuse_public_key_ref, langfuse_secret_key_ref, github_repo_url, github_installation_token_ref, claude_api_key_ref, cursor_api_key_ref, linear_api_key_ref, linear_access_token_ref, slack_bot_token_ref, slack_channel_id',
        ),
      db.from('projects').select('id, organization_id, owner_id'),
      db.from('organization_integration_settings').select('organization_id, sentry_org_slug, sentry_auth_token_ref, langfuse_host, langfuse_public_key_ref, langfuse_secret_key_ref, github_repo_url, github_installation_token_ref, claude_api_key_ref, cursor_api_key_ref, linear_api_key_ref, linear_access_token_ref'),
    ])
    if (settingsErr) throw new Error(`project_settings load failed: ${settingsErr.message}`)
    const allSettings = (settingsRows ?? []) as PlatformSettingsRow[]
    // One pass instead of an allSettings.find per routing / webhook row
    // (O(rows × projects) per cron tick). First row wins, as find did.
    const settingsByProject = new Map<string, PlatformSettingsRow>()
    for (const s of allSettings) {
      if (!settingsByProject.has(s.project_id)) settingsByProject.set(s.project_id, s)
    }

    // Build lookup maps for org-level defaults
    const projectOrgMap = new Map<string, string>()
    const projectRows = (projectOrgRows ?? []) as Array<{ id: string; organization_id: string | null; owner_id: string | null }>
    for (const p of projectRows) {
      if (p.organization_id) projectOrgMap.set(p.id, p.organization_id)
    }
    const orgSettingsMap = new Map<string, PlatformSettingsRow>()
    for (const os of (orgSettingsRows ?? []) as Array<PlatformSettingsRow & { organization_id: string }>) {
      orgSettingsMap.set(os.organization_id, os as PlatformSettingsRow)
    }

    /** Merge project settings with org defaults (project wins). */
    function mergeWithOrg(s: PlatformSettingsRow): PlatformSettingsRow {
      const orgId = projectOrgMap.get(s.project_id)
      if (!orgId) return s
      const orgSettings = orgSettingsMap.get(orgId)
      if (!orgSettings) return s
      const merged: PlatformSettingsRow = { ...s }
      const fields: Array<keyof PlatformSettingsRow> = [
        'sentry_org_slug', 'sentry_auth_token_ref',
        'langfuse_host', 'langfuse_public_key_ref', 'langfuse_secret_key_ref',
        'github_repo_url', 'github_installation_token_ref',
        'claude_api_key_ref', 'cursor_api_key_ref',
        'linear_api_key_ref', 'linear_access_token_ref',
      ]
      for (const f of fields) {
        if (merged[f] == null || merged[f] === '') {
          const orgVal = orgSettings[f]
          if (orgVal != null) Object.assign(merged, { [f]: orgVal })
        }
      }
      return merged
    }

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

    for (const rawS of allSettings) {
      const s = mergeWithOrg(rawS)
      if (hasSentry(s)) tasks.push({ projectId: s.project_id, kind: 'sentry', settings: s, routingConfig: {} })
      if (hasLangfuse(s)) tasks.push({ projectId: s.project_id, kind: 'langfuse', settings: s, routingConfig: {} })
      if (hasGithub(s)) tasks.push({ projectId: s.project_id, kind: 'github', settings: s, routingConfig: {} })
      if (hasClaudeCodeAgent(s)) {
        tasks.push({ projectId: s.project_id, kind: 'claude_code_agent', settings: s, routingConfig: {} })
      }
      if (hasCursorCloud(s)) {
        tasks.push({ projectId: s.project_id, kind: 'cursor_cloud', settings: s, routingConfig: {} })
      }
      if (hasLinearPlatform(s)) {
        tasks.push({ projectId: s.project_id, kind: 'linear', settings: s, routingConfig: {} })
      }
      // auth.test only: the probe posts nothing to the channel.
      if (hasSlack(s)) tasks.push({ projectId: s.project_id, kind: 'slack', settings: s, routingConfig: {} })
    }

    for (const r of allRouting) {
      const kind = routingTypeToKind(r.integration_type)
      if (!kind) continue
      // Find the matching settings row (or use empty defaults).
      const settings = settingsByProject.get(r.project_id) ?? ({} as PlatformSettingsRow)
      tasks.push({ projectId: r.project_id, kind, settings, routingConfig: r.config })
    }

    // Add reward_webhook probes (P3)
    for (const wh of (rewardWebhookRows ?? []) as Array<{ id: string; project_id: string | null; organization_id: string; url: string; secret_hash: string | null; enabled: boolean }>) {
      const projectId = wh.project_id ?? allSettings.find((s) => s.project_id)?.project_id
      if (!projectId) continue
      const settings = settingsByProject.get(projectId) ?? ({} as PlatformSettingsRow)
      tasks.push({
        projectId,
        kind: 'reward_webhook' as const,
        settings,
        routingConfig: { webhook_url: wh.url, secret_hash: wh.secret_hash ?? undefined },
      })
    }

    // ── 4. Server-level probes (anthropic / openai) ─────────────────────
    // These keys are env-level, not per-project. The history row needs a
    // project_id, so it goes on the operator's own project, never on an
    // arbitrary tenant: a tenant's anthropic/openai rows now describe its own
    // BYOK keys (step 4b). A single-project install (self-host) uses its one
    // project. Otherwise the env probe is skipped and says so.
    const operatorProject = projectRows.find((p) => isOperatorUser(p.owner_id))
    const anchorProjectId =
      operatorProject?.id ?? (projectRows.length === 1 ? projectRows[0].id : null)
    const anchorSettings = anchorProjectId
      ? settingsByProject.get(anchorProjectId) ?? null
      : null
    if (!anchorSettings && (Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('OPENAI_API_KEY'))) {
      plog.warn('env LLM keys not probed: no operator project (set MUSHI_OPERATOR_USER_IDS)')
    }
    if (anchorProjectId && anchorSettings) {
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
      /** Vendor HTTP status (null = no response); BYOK rows leave it unset. */
      http_status?: number | null
    }> = []

    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (t) => {
          const probe = await probeIntegration(t.kind, db, t.settings, t.routingConfig, t.projectId)
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
            http_status: historyHttpStatus(probe),
          })
          probed++
        } else {
          plog.warn('probe threw', { error: String(r.reason) })
        }
      }
    }

    // ── 4b. Customer BYOK keys ──────────────────────────────────────────
    const nowIso = new Date().toISOString()
    const { data: byokRows, error: byokErr } = await db
      .from('byok_keys')
      .select('id, project_id, provider_slug, vault_secret_id, base_url, label, key_hint, status, test_status, last_tested_at, last_error')
    if (byokErr) throw new Error(`byok_keys load failed: ${byokErr.message}`)
    // Supabase tokens are checked against their project's linked ref.
    const allByokRows = (byokRows ?? []) as ByokKeyRow[]
    const supabaseProjectIds = [...new Set(allByokRows.filter((r) => r.provider_slug === 'supabase').map((r) => r.project_id))]
    if (supabaseProjectIds.length > 0) {
      const { data: refRows, error: refErr } = await db
        .from('project_settings')
        .select('project_id, supabase_project_ref')
        .in('project_id', supabaseProjectIds)
      // Without refs the Supabase tokens are skipped this run; the other
      // providers' probes still matter more than one failed lookup.
      if (refErr) plog.warn('supabase_project_ref load failed; skipping Supabase token probes', { error: refErr.message })
      const refs = new Map(((refRows ?? []) as Array<{ project_id: string; supabase_project_ref: string | null }>).map((r) => [r.project_id, r.supabase_project_ref]))
      for (const r of allByokRows) if (r.provider_slug === 'supabase') r.supabase_project_ref = refs.get(r.project_id) ?? null
    }
    const dueKeys = selectDueByokKeys(allByokRows, Date.now())
    const byokOutcomes: ByokProbeOutcome[] = []
    const byokPatchFailures: string[] = []
    for (let i = 0; i < dueKeys.length; i += CONCURRENCY) {
      const batch = dueKeys.slice(i, i + CONCURRENCY)
      const outcomes = await Promise.all(
        batch.map(async (key) => {
          let secret: string | null = null
          if (key.vault_secret_id) {
            const { data, error } = await db.rpc('vault_get_secret', { secret_id: key.vault_secret_id })
            secret = !error && typeof data === 'string' && data.length > 0 ? data : null
          }
          return probeByokRow(key, secret, nowIso)
        }),
      )
      for (const o of outcomes) {
        byokOutcomes.push(o)
        if (!o.patch) continue
        const { error } = await db.from('byok_keys').update(o.patch).eq('id', o.key.id)
        if (error) byokPatchFailures.push(`${o.key.id}: ${error.message}`)
      }
    }
    historyRows.push(...healthRowsFromOutcomes(byokOutcomes))
    probed += byokOutcomes.length

    // Bulk insert all history rows in one round-trip. A failed insert fails
    // the run: the console's status chips read these rows.
    if (historyRows.length > 0) {
      const { error: insertErr } = await db.from('integration_health_history').insert(historyRows)
      if (insertErr) throw new Error(`integration_health_history insert failed: ${insertErr.message}`)
    }
    if (byokPatchFailures.length > 0) {
      throw new Error(
        `byok_keys status update failed for ${byokPatchFailures.length} key(s): ${byokPatchFailures.join('; ').slice(0, 500)}`,
      )
    }

    // ── 6. Radar: Mushi's own setup checks, once a day per project ─────
    const radar = await runRadarPass(db, {
      nowMs: Date.now(),
      githubFacts: async (projectId, owner, repo) => {
        const token = await resolveProjectGithubToken(db, projectId)
        if (!token) return null
        const facts = await lookupGithubRepoFacts(token, owner, repo)
        return facts.ok ? facts.facts : null
      },
    })
    if (radar.failed.length > 0) {
      const err = new Error(
        `radar failed for ${radar.failed.length} project(s): ` +
          radar.failed.map((f) => `${f.projectId}: ${f.error}`).join('; ').slice(0, 800),
      )
      plog.error('radar pass failed', { failed: radar.failed })
      reportError(err, { tags: { function: 'integration-health-probe', stage: 'radar' } })
      await cron.fail(err)
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'RADAR_FAILED', message: err.message }, data: { probed, radar } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    await cron.finish({
      rowsAffected: probed,
      metadata: { tasks: tasks.length, probed, byok_probed: byokOutcomes.length, radar },
    })
    return new Response(
      JSON.stringify({ ok: true, data: { probed, byokProbed: byokOutcomes.length, radar } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    reportError(err, { tags: { function: 'integration-health-probe' } })
    await cron.fail(err)
    return safeErrorResponse({ code: 'PROBE_FAILED', status: 500 })
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('integration-health-probe', handler))
}
