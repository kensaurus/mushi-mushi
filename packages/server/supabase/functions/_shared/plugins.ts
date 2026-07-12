import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { assertSafeOutboundUrl } from './inventory-guards.ts'

const pluginLog = log.child('plugins')

export interface PluginHooks {
  beforeClassify?(report: Record<string, unknown>): Promise<Record<string, unknown>>
  afterClassify?(report: Record<string, unknown>, classification: Record<string, unknown>): Promise<void>
  onReportCreated?(report: Record<string, unknown>): Promise<void>
  onStatusChanged?(report: Record<string, unknown>, oldStatus: string, newStatus: string): Promise<void>
}

interface PluginRecord {
  plugin_name: string
  plugin_version: string
  config: Record<string, unknown> | null
  execution_order: number
}

const PLUGIN_TIMEOUT = 5000

export async function getActivePlugins(db: SupabaseClient, projectId: string): Promise<PluginRecord[]> {
  const { data } = await db
    .from('project_plugins')
    .select('plugin_name, plugin_version, config, execution_order')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('execution_order', { ascending: true })

  return data ?? []
}

export async function executePluginHook<T>(
  plugins: PluginRecord[],
  hookName: string,
  args: unknown[],
): Promise<T | undefined> {
  let result: unknown

  for (const plugin of plugins) {
    try {
      const hookFn = resolveBuiltinHook(plugin.plugin_name, hookName, plugin.config)
      if (!hookFn) continue

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Plugin ${plugin.plugin_name} timed out`)), PLUGIN_TIMEOUT),
      )

      result = await Promise.race([hookFn(...args), timeoutPromise])
    } catch (err) {
      pluginLog.error('Plugin hook failed', { plugin: plugin.plugin_name, hook: hookName, err: String(err) })
    }
  }

  return result as T | undefined
}

function resolveBuiltinHook(
  pluginName: string,
  hookName: string,
  _config: Record<string, unknown> | null,
): ((...args: unknown[]) => Promise<unknown>) | null {
  // Built-in plugin implementations
  if (pluginName === 'severity-auto-escalation' && hookName === 'afterClassify') {
    return async (report: unknown, _classification: unknown) => {
      void report
    }
  }
  if (pluginName === 'sla-tracker' && hookName === 'onStatusChanged') {
    return async (report: unknown, _oldStatus: unknown, _newStatus: unknown) => {
      void report
    }
  }
  return null
}

// ============================================================
// D1: Webhook plugin dispatcher
//
// Marketplace plugins are stand-alone HTTPS services. We POST a signed
// JSON envelope to each subscribed plugin, then log the delivery
// (status + http code + duration) into `plugin_dispatch_log`. Failures
// are *not* retried inline — the row stays `pending` and a separate
// cron worker (out of scope for D1) can reprocess at leisure. This
// keeps the request path latency-bounded.
// ============================================================

export type MushiEventName =
  | 'report.created'
  | 'report.classified'
  | 'report.status_changed'
  | 'report.commented'
  | 'report.dedup_grouped'
  | 'fix.proposed'
  | 'fix.applied'
  | 'fix.failed'
  | 'judge.score_recorded'
  | 'sla.breached'
  // QA Coverage (story monitoring)
  | 'qa_story.failed'
  | 'qa_story.recovered'
  // Rewards program (P1+)
  | 'reward.points_awarded'
  | 'reward.tier_changed'
  | 'reward.payout_requested'
  | 'reward.payout_paid'
  // Skill pipelines (cloud mode step dispatch)
  | 'skill_pipeline.step.dispatched'

/** Plugins that deliver human notifications (vs automation). Only these are
 *  gated by the console's per-event notification toggles. */
const NOTIFICATION_PLUGIN_SLUGS = new Set(['slack', 'slack-app', 'discord', 'teams', 'msteams'])

/** Bus event → notification_prefs key (NotificationPrefsMatrix). Events with
 *  no entry (report.created, judge.score_recorded, …) have no toggle and
 *  always deliver. `false` suppresses; absent = enabled. */
const NOTIFICATION_EVENT_PREF_KEYS: Record<string, string> = {
  'report.classified': 'report.classified',
  'fix.proposed': 'fix.pr_opened',
  'fix.failed': 'fix.failed',
  'fix.applied': 'fix.merged',
  'qa_story.failed': 'qa_story.failed',
  'qa_story.recovered': 'qa_story.recovered',
}

interface WebhookPlugin {
  plugin_slug: string
  webhook_url: string
  webhook_secret_vault_ref: string | null
  subscribed_events: string[]
}

const DISPATCH_TIMEOUT_MS = 8_000
const RESPONSE_EXCERPT_MAX = 512

export async function dispatchPluginEvent(
  db: SupabaseClient,
  projectId: string,
  event: MushiEventName | string,
  data: unknown,
): Promise<void> {
  const { data: rows, error } = await db
    .from('project_plugins')
    .select('plugin_slug, webhook_url, webhook_secret_vault_ref, subscribed_events, config')
    .eq('project_id', projectId)
    .eq('is_active', true)

  if (error) {
    pluginLog.warn('Failed to read project_plugins for dispatch', { projectId, event, error: error.message })
    return
  }

  const allPlugins = (rows ?? []) as Array<WebhookPlugin & { config?: Record<string, unknown> | null }>
  let subscribedPlugins = allPlugins.filter(
    (p) => p.subscribed_events.length === 0 || p.subscribed_events.includes('*') || p.subscribed_events.includes(event),
  )

  // Honor the console NotificationPrefsMatrix (project_settings.notification_prefs)
  // for NOTIFICATION-type plugins only. Automation plugins (cursor-cloud-agent,
  // jira, linear, github-issues, …) keep firing regardless — a "notifications"
  // toggle must not silently disable issue creation or agent dispatch.
  const prefKey = NOTIFICATION_EVENT_PREF_KEYS[event]
  if (prefKey && subscribedPlugins.some((p) => NOTIFICATION_PLUGIN_SLUGS.has(p.plugin_slug))) {
    const { data: ps } = await db
      .from('project_settings')
      .select('notification_prefs')
      .eq('project_id', projectId)
      .maybeSingle()
    const prefs = ((ps as { notification_prefs?: Record<string, unknown> | null } | null)
      ?.notification_prefs ?? {}) as Record<string, unknown>
    if (prefs[prefKey] === false) {
      subscribedPlugins = subscribedPlugins.filter((p) => !NOTIFICATION_PLUGIN_SLUGS.has(p.plugin_slug))
    }
  }

  const tasks: Promise<unknown>[] = []

  // Skill pipelines: dispatch to Cursor Cloud even without a marketplace plugin
  // row — credentials live in Integrations → Cursor Cloud
  // (project_settings.cursor_api_key_ref). This is in ADDITION to (not instead
  // of) any other subscribed plugins, so a project with a Discord/Teams webhook
  // subscribed to this event still receives the fan-out below.
  if (
    event === 'skill_pipeline.step.dispatched' &&
    !subscribedPlugins.some((p) => p.plugin_slug === CURSOR_AGENT_SLUG)
  ) {
    tasks.push(deliverCursorAgent(db, projectId, event, data, {
      plugin_slug: CURSOR_AGENT_SLUG,
      subscribed_events: [event],
      config: null,
    }))
  }

  for (const p of subscribedPlugins) {
    // Cursor Cloud Agent uses direct REST dispatch — no webhook hop needed.
    if (p.plugin_slug === CURSOR_AGENT_SLUG && CURSOR_EVENTS.has(event)) {
      tasks.push(deliverCursorAgent(db, projectId, event, data, {
        plugin_slug: p.plugin_slug,
        subscribed_events: p.subscribed_events,
        config: p.config ?? null,
      }))
    } else if (p.webhook_url) {
      // All other plugins use the HMAC-signed webhook path.
      tasks.push(deliverOne(db, projectId, event, data, p))
    }
  }

  await Promise.all(tasks)
}

// ──────────────────────────────────────────────────────────────────────────
// Cursor Cloud Agent: direct REST dispatch (no intermediate webhook hop)
// ──────────────────────────────────────────────────────────────────────────

interface CursorPluginRow {
  plugin_slug: string
  subscribed_events: string[]
  config: Record<string, unknown> | null
}

const CURSOR_AGENT_SLUG = 'cursor-cloud-agent'
const CURSOR_EVENTS = new Set([
  'report.classified',
  'qa_story.failed',
  'fix.requested',
  'skill_pipeline.step.dispatched',
])
const CURSOR_SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 }

async function resolveVaultRef(db: SupabaseClient, ref: string): Promise<string> {
  if (!ref) return ''
  if (!ref.startsWith('vault://')) return ref
  const vaultName = ref.slice('vault://'.length)
  const { data: vaultData } = await db.rpc('vault_lookup', { secret_name: vaultName })
  return typeof vaultData === 'string' ? vaultData : ''
}

async function resolveCursorCredentials(
  db: SupabaseClient,
  projectId: string,
  pluginConfig: Record<string, unknown> | null,
): Promise<{ apiKeyRef: string; model: string; autoCreatePR: boolean; maxIterations: number }> {
  const cfg = pluginConfig ?? {}
  let apiKeyRef = typeof cfg.api_key_ref === 'string' ? cfg.api_key_ref : ''
  let model = typeof cfg.model === 'string' ? cfg.model : 'composer-2.5'
  let autoCreatePR = cfg.auto_create_pr !== false
  let maxIterations = typeof cfg.max_iterations === 'number' ? cfg.max_iterations : 1

  if (!apiKeyRef) {
    const { data: settings } = await db
      .from('project_settings')
      .select('cursor_api_key_ref, cursor_default_model, cursor_auto_create_pr, cursor_max_iterations')
      .eq('project_id', projectId)
      .maybeSingle()
    const row = settings as {
      cursor_api_key_ref?: string | null
      cursor_default_model?: string | null
      cursor_auto_create_pr?: boolean | null
      cursor_max_iterations?: number | null
    } | null
    apiKeyRef = row?.cursor_api_key_ref ?? ''
    if (row?.cursor_default_model) model = row.cursor_default_model
    if (row?.cursor_auto_create_pr === false) autoCreatePR = false
    if (typeof row?.cursor_max_iterations === 'number') maxIterations = row.cursor_max_iterations
  }

  return { apiKeyRef, model, autoCreatePR, maxIterations }
}

async function deliverCursorAgent(
  db: SupabaseClient,
  projectId: string,
  event: MushiEventName | string,
  data: unknown,
  plugin: CursorPluginRow,
): Promise<void> {
  const { apiKeyRef, model, autoCreatePR, maxIterations } = await resolveCursorCredentials(
    db,
    projectId,
    plugin.config,
  )
  const workspaceId = typeof plugin.config?.workspace_id === 'string' ? plugin.config.workspace_id : ''

  // Skill pipeline steps use Cursor v0 API (source.repository) — workspace_id optional.
  if (event === 'skill_pipeline.step.dispatched') {
    const resolvedApiKey = await resolveVaultRef(db, apiKeyRef)
    await deliverSkillPipelineStep(db, projectId, data, {
      apiKey: resolvedApiKey,
      model,
      autoCreatePR,
    })
    return
  }

  const apiKey = apiKeyRef

  if (!apiKey || !workspaceId) {
    pluginLog.warn('Cursor plugin skipped: missing api_key_ref or workspace_id', { projectId })
    return
  }

  // Fetch the project's GitHub repo URL so the Cursor REST API knows which
  // codebase to work in (required: cloud.repos[].url).
  const { data: projSettings } = await db
    .from('project_settings')
    .select('github_repo_url')
    .eq('project_id', projectId)
    .single()
  const repoUrl = (projSettings as { github_repo_url?: string | null } | null)?.github_repo_url ?? ''
  if (!repoUrl) {
    pluginLog.warn('Cursor plugin skipped: github_repo_url not configured for project', {
      projectId,
      hint: 'Configure GitHub integration under Admin → Integrations so the agent knows which repo to fix.',
    })
    return
  }

  const cfg = plugin.config ?? {}
  const severityThreshold =
    typeof cfg.severity_threshold === 'string' &&
    cfg.severity_threshold in CURSOR_SEVERITY_RANK
      ? cfg.severity_threshold
      : 'critical'

  // Severity gate for report.classified
  if (event === 'report.classified') {
    const d = data as { classification?: { severity?: string } } | null
    const rank = CURSOR_SEVERITY_RANK[d?.classification?.severity ?? ''] ?? 0
    const minRank = CURSOR_SEVERITY_RANK[severityThreshold]!
    if (rank < minRank) return
  }

  const resolvedApiKey = await resolveVaultRef(db, apiKey)
  if (!resolvedApiKey) {
    pluginLog.warn('Cursor plugin: API key not configured (Integrations → Cursor Cloud)', { projectId })
    return
  }

  // Build a minimal prompt from the event data
  const dataObj = data as Record<string, unknown>
  const reportId = (dataObj?.report as { id?: string })?.id ?? 'unknown'
  const prompt = [
    `Mushi Mushi dispatched a ${event} event for project ${projectId}.`,
    `Report ID: ${reportId}`,
    `Please investigate and open a draft PR with a fix. Do not refactor unrelated code.`,
  ].join('\n')

  const deliveryId = crypto.randomUUID()
  const start = Date.now()
  let dispatchStatus: 'ok' | 'error' = 'error'
  let httpStatus: number | null = null
  let agentId: string | null = null
  let excerpt = ''

  try {
    const res = await fetch('https://api.cursor.com/v0/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`,
      },
      // 30 s timeout: consistent with deliverOne; prevents a slow Cursor API
      // response from blocking the entire plugin fanout Promise.all.
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: { id: model },
        cloud: {
          workspaceId,
          repos: [{ url: repoUrl }],
          autoCreatePR,
          maxIterations,
          envVars: {
            MUSHI_PROJECT_ID: projectId,
            MUSHI_REPORT_ID: reportId,
            MUSHI_EVENT: event,
          },
        },
        prompt,
      }),
    })
    httpStatus = res.status
    const text = await res.text().catch(() => '')
    excerpt = text.slice(0, 512)
    if (res.ok) {
      const body = JSON.parse(text) as { agentId?: string; id?: string }
      agentId = body.agentId ?? body.id ?? null
      dispatchStatus = 'ok'
    }
  } catch (err) {
    excerpt = String(err).slice(0, 512)
  }

  const durationMs = Date.now() - start

  try {
    await db.from('plugin_dispatch_log').insert({
      delivery_id: deliveryId,
      project_id: projectId,
      plugin_slug: CURSOR_AGENT_SLUG,
      event,
      attempt: 1,
      status: dispatchStatus,
      http_status: httpStatus,
      response_excerpt: agentId ? `agentId=${agentId}` : (excerpt || null),
      duration_ms: durationMs,
      next_retry_at: null,
      payload_digest: await sha256Hex(JSON.stringify({ event, projectId, reportId })),
    })
  } catch { /* dispatch log is best-effort */ }

  if (dispatchStatus === 'ok' && agentId) {
    pluginLog.info('Cursor Cloud Agent dispatched', { projectId, event, agentId, durationMs })
  } else {
    pluginLog.warn('Cursor Cloud Agent dispatch failed', { projectId, event, excerpt })
  }
}

interface SkillPipelineStepPayload {
  runId: string
  stepIndex: number
  skillSlug: string
  contextPacket: string
  projectId: string
}

async function deliverSkillPipelineStep(
  db: SupabaseClient,
  projectId: string,
  data: unknown,
  opts: { apiKey: string; model: string; autoCreatePR: boolean },
): Promise<void> {
  const d = data as SkillPipelineStepPayload
  if (!d?.runId || d.stepIndex === undefined || !d.skillSlug) {
    pluginLog.warn('Skill pipeline dispatch skipped: invalid payload', { projectId })
    return
  }

  let resolvedApiKey = opts.apiKey
  if (opts.apiKey.startsWith('vault://')) {
    const vaultName = opts.apiKey.slice('vault://'.length)
    const { data: vaultData } = await db.rpc('vault_lookup', { secret_name: vaultName })
    resolvedApiKey = typeof vaultData === 'string' ? vaultData : ''
  }
  if (!resolvedApiKey) {
    await failSkillPipelineStep(db, d, 'Cursor API key not configured')
    return
  }

  const { data: projSettings } = await db
    .from('project_settings')
    .select('github_repo_url')
    .eq('project_id', projectId)
    .single()
  const repoUrl = (projSettings as { github_repo_url?: string | null } | null)?.github_repo_url ?? ''
  if (!repoUrl) {
    await failSkillPipelineStep(db, d, 'GitHub repo URL not configured — set it under Integrations')
    return
  }

  const prompt = [
    `# Mushi Skill Pipeline — Step ${d.stepIndex + 1}`,
    ``,
    `Skill: \`${d.skillSlug}\``,
    `Pipeline run: ${d.runId}`,
    ``,
    `You are executing step ${d.stepIndex + 1} of a Mushi skill pipeline.`,
    `When done, call the Mushi MCP tool \`checkin_pipeline_step\` with run_id, step_index, and status.`,
    ``,
    `─── Context Packet ────────────────────────────────────────────────────`,
    ``,
    (d.contextPacket ?? '').slice(0, 32_000),
  ].join('\n')

  const deliveryId = crypto.randomUUID()
  const start = Date.now()
  let agentId: string | null = null
  let excerpt = ''

  try {
    const res = await fetch('https://api.cursor.com/v0/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        prompt: { text: prompt },
        model: opts.model || 'default',
        source: { repository: repoUrl, ref: 'main' },
        target: {
          autoCreatePr: opts.autoCreatePR,
          branchName: `mushi/skill-${d.skillSlug.slice(0, 24)}-${Date.now()}`,
          skipReviewerRequest: true,
        },
      }),
    })
    const text = await res.text().catch(() => '')
    excerpt = text.slice(0, 512)
    if (res.ok) {
      const body = JSON.parse(text) as { agentId?: string; id?: string }
      agentId = body.agentId ?? body.id ?? null
    } else {
      await failSkillPipelineStep(db, d, `Cursor API ${res.status}: ${excerpt}`)
      return
    }
  } catch (err) {
    await failSkillPipelineStep(db, d, String(err).slice(0, 500))
    return
  }

  const now = new Date().toISOString()
  if (agentId) {
    await db
      .from('skill_pipeline_step_runs')
      .update({
        status: 'running',
        agent_ref: agentId,
        notes: `Cursor Cloud agent dispatched (model: ${opts.model})`,
        updated_at: now,
      })
      .eq('run_id', d.runId)
      .eq('step_index', d.stepIndex)
  }

  try {
    await db.from('plugin_dispatch_log').insert({
      delivery_id: deliveryId,
      project_id: projectId,
      plugin_slug: CURSOR_AGENT_SLUG,
      event: 'skill_pipeline.step.dispatched',
      attempt: 1,
      status: agentId ? 'ok' : 'error',
      http_status: agentId ? 200 : null,
      response_excerpt: agentId ? `agentId=${agentId}` : excerpt,
      duration_ms: Date.now() - start,
      next_retry_at: null,
      payload_digest: await sha256Hex(JSON.stringify({ runId: d.runId, stepIndex: d.stepIndex })),
    })
  } catch { /* best-effort */ }

  if (agentId) {
    pluginLog.info('Skill pipeline step dispatched to Cursor Cloud', {
      projectId,
      runId: d.runId,
      stepIndex: d.stepIndex,
      agentId,
    })
  }
}

async function failSkillPipelineStep(
  db: SupabaseClient,
  d: SkillPipelineStepPayload,
  notes: string,
): Promise<void> {
  const now = new Date().toISOString()
  pluginLog.warn('Skill pipeline step dispatch failed', { runId: d.runId, stepIndex: d.stepIndex, notes })
  await db
    .from('skill_pipeline_step_runs')
    .update({ status: 'failed', finished_at: now, updated_at: now, notes })
    .eq('run_id', d.runId)
    .eq('step_index', d.stepIndex)
  await db
    .from('skill_pipeline_runs')
    .update({ status: 'failed', finished_at: now })
    .eq('id', d.runId)
    .in('status', ['pending', 'running'])
}

async function deliverOne(
  db: SupabaseClient,
  projectId: string,
  event: MushiEventName | string,
  data: unknown,
  plugin: WebhookPlugin,
): Promise<void> {
  const deliveryId = crypto.randomUUID()
  const occurredAt = new Date().toISOString()
  const envelope = { event, deliveryId, occurredAt, projectId, pluginSlug: plugin.plugin_slug, data }
  const rawBody = JSON.stringify(envelope)
  const digest = await sha256Hex(rawBody)

  const secret = plugin.webhook_secret_vault_ref
    ? await loadSecret(db, plugin.webhook_secret_vault_ref)
    : null

  if (!secret) {
    try {
      await db.from('plugin_dispatch_log').insert({
        delivery_id: deliveryId,
        project_id: projectId,
        plugin_slug: plugin.plugin_slug,
        event,
        status: 'skipped',
        response_excerpt: 'missing_secret',
        payload_digest: digest,
      })
    } catch { /* dispatch log is best-effort */ }
    return
  }

  const t = Date.now()
  const sig = await signHmac(secret, `${t}.${rawBody}`)
  // Standard Webhooks: webhook-id=<deliveryId>, webhook-timestamp=<unix-secs>,
  // webhook-signature=v1,<base64-hmac> where payload = "${id}.${ts}.${body}"
  const stdTimestamp = String(Math.floor(t / 1000))
  const stdSig = await signHmacBase64(secret, `${deliveryId}.${stdTimestamp}.${rawBody}`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Legacy X-Mushi-* headers (kept for back-compat)
    'X-Mushi-Event': event,
    'X-Mushi-Signature': `t=${t},v1=${sig}`,
    'X-Mushi-Project': projectId,
    'X-Mushi-Plugin': plugin.plugin_slug,
    'X-Mushi-Delivery': deliveryId,
    // Standard Webhooks (https://www.standardwebhooks.com/) headers
    'webhook-id': deliveryId,
    'webhook-timestamp': stdTimestamp,
    'webhook-signature': `v1,${stdSig}`,
  }

  const start = Date.now()
  let status: 'ok' | 'error' | 'timeout' = 'error'
  let httpStatus: number | null = null
  let excerpt = ''

  const safeUrl = assertSafeOutboundUrl(plugin.webhook_url, {})
  if (!safeUrl.ok) {
    try {
      await db.from('plugin_dispatch_log').insert({
        delivery_id: deliveryId,
        project_id: projectId,
        plugin_slug: plugin.plugin_slug,
        event,
        status: 'error',
        response_excerpt: (safeUrl.reason ?? 'unsafe_url').slice(0, RESPONSE_EXCERPT_MAX),
        payload_digest: digest,
      })
    } catch { /* dispatch log is best-effort */ }
    return
  }

  try {
    const controller = new AbortController()
    const tm = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS)
    const res = await fetch(plugin.webhook_url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
    })
    clearTimeout(tm)
    httpStatus = res.status
    const text = await res.text().catch(() => '')
    excerpt = text.slice(0, RESPONSE_EXCERPT_MAX)
    status = res.ok ? 'ok' : 'error'
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') status = 'timeout'
    excerpt = String(err).slice(0, RESPONSE_EXCERPT_MAX)
  }
  const durationMs = Date.now() - start

  // Non-ok deliveries are stored as 'pending' with a retry timestamp so the
  // plugin-dispatch-retry cron can replay them with exponential backoff.
  const isFinal = status === 'ok'
  const persistedStatus = isFinal ? 'ok' : 'pending'
  const next_retry_at = isFinal ? null : new Date(Date.now() + 30_000).toISOString()

  try {
    await db.from('plugin_dispatch_log').insert({
      delivery_id: deliveryId,
      project_id: projectId,
      plugin_slug: plugin.plugin_slug,
      event,
      attempt: 1,
      status: persistedStatus,
      http_status: httpStatus,
      response_excerpt: excerpt || null,
      duration_ms: durationMs,
      next_retry_at,
      payload_digest: digest,
    })
  } catch { /* dispatch log is best-effort */ }

  try {
    await db.from('project_plugins')
      .update({ last_delivery_at: new Date().toISOString(), last_delivery_status: status })
      .eq('project_id', projectId)
      .eq('plugin_slug', plugin.plugin_slug)
  } catch { /* last-delivery stamp is best-effort */ }
}

async function loadSecret(db: SupabaseClient, ref: string): Promise<string | null> {
  const name = ref.startsWith('vault://') ? ref.slice('vault://'.length) : ref
  const { data, error } = await db.rpc('vault_lookup', { secret_name: name })
  if (error) {
    pluginLog.warn('vault_lookup failed for plugin secret', { error: error.message })
    return null
  }
  return typeof data === 'string' ? data : null
}

// ──────────────────────────────────────────────────────────────────────────
// Public test-delivery helper (used by the admin POST /:slug/test-event route)
// ──────────────────────────────────────────────────────────────────────────

export interface TestDeliveryResult {
  ok: boolean
  httpStatus: number | null
  durationMs: number
  excerpt: string
}

/**
 * Fire a `test.delivery` event at the plugin's webhook URL.
 * Identical signing logic to `deliverOne` — the envelope is signed and the
 * result is written to `plugin_dispatch_log` so it appears in the dispatch
 * table in the UI.
 */
export async function sendTestDelivery(
  db: SupabaseClient,
  projectId: string,
  slug: string,
): Promise<TestDeliveryResult> {
  const { data: row, error } = await db
    .from('project_plugins')
    .select('webhook_url, webhook_secret_vault_ref, plugin_slug, plugin_name')
    .eq('project_id', projectId)
    .or(`plugin_slug.eq.${slug},plugin_name.eq.${slug}`)
    .maybeSingle()

  if (error || !row) {
    return { ok: false, httpStatus: null, durationMs: 0, excerpt: error?.message ?? 'Plugin not found' }
  }
  if (!row.webhook_url) {
    return { ok: false, httpStatus: null, durationMs: 0, excerpt: 'Plugin has no webhook URL' }
  }

  const deliveryId = crypto.randomUUID()
  const occurredAt = new Date().toISOString()
  const pluginSlug = row.plugin_slug ?? row.plugin_name
  const event = 'test.delivery'
  const envelope = { event, deliveryId, occurredAt, projectId, pluginSlug, data: { test: true } }
  const rawBody = JSON.stringify(envelope)
  const digest = await sha256Hex(rawBody)

  const secret = row.webhook_secret_vault_ref
    ? await loadSecret(db, row.webhook_secret_vault_ref)
    : null

  if (!secret) {
    try {
      await db.from('plugin_dispatch_log').insert({
        delivery_id: deliveryId,
        project_id: projectId,
        plugin_slug: pluginSlug,
        event,
        attempt: 1,
        status: 'skipped',
        response_excerpt: 'missing_secret',
        payload_digest: digest,
      })
    } catch { /* dispatch log is best-effort */ }
    return { ok: false, httpStatus: null, durationMs: 0, excerpt: 'missing_secret' }
  }

  const t = Date.now()
  const sig = await signHmac(secret, `${t}.${rawBody}`)
  // Standard Webhooks: same ID as original delivery for idempotent retry tracking
  const stdTimestamp = String(Math.floor(t / 1000))
  const stdSig = await signHmacBase64(secret, `${deliveryId}.${stdTimestamp}.${rawBody}`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Legacy X-Mushi-* headers (kept for back-compat)
    'X-Mushi-Event': event,
    'X-Mushi-Signature': `t=${t},v1=${sig}`,
    'X-Mushi-Project': projectId,
    'X-Mushi-Plugin': pluginSlug,
    'X-Mushi-Delivery': deliveryId,
    // Standard Webhooks (https://www.standardwebhooks.com/) headers
    'webhook-id': deliveryId,
    'webhook-timestamp': stdTimestamp,
    'webhook-signature': `v1,${stdSig}`,
  }

  const start = Date.now()
  let status: 'ok' | 'error' | 'timeout' = 'error'
  let httpStatus: number | null = null
  let excerpt = ''

  try {
    const controller = new AbortController()
    const tm = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS)
    const res = await fetch(row.webhook_url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
    })
    clearTimeout(tm)
    httpStatus = res.status
    const text = await res.text().catch(() => '')
    excerpt = text.slice(0, RESPONSE_EXCERPT_MAX)
    status = res.ok ? 'ok' : 'error'
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') status = 'timeout'
    excerpt = String(err).slice(0, RESPONSE_EXCERPT_MAX)
  }
  const durationMs = Date.now() - start

  try {
    await db.from('plugin_dispatch_log').insert({
      delivery_id: deliveryId,
      project_id: projectId,
      plugin_slug: pluginSlug,
      event,
      attempt: 1,
      status,
      http_status: httpStatus,
      response_excerpt: excerpt || null,
      duration_ms: durationMs,
      next_retry_at: null,
      payload_digest: digest,
    })
  } catch { /* dispatch log is best-effort */ }

  try {
    await db.from('project_plugins')
      .update({ last_delivery_at: new Date().toISOString(), last_delivery_status: status })
      .eq('project_id', projectId)
      .or(`plugin_slug.eq.${pluginSlug},plugin_name.eq.${pluginSlug}`)
  } catch { /* last-delivery stamp is best-effort */ }

  return { ok: status === 'ok', httpStatus, durationMs, excerpt }
}

async function signHmac(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toHex(new Uint8Array(sig))
}

/** Standard Webhooks signature format: base64(HMAC_SHA256(secret, payload)) */
async function signHmacBase64(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function sha256Hex(payload: string): Promise<string> {
  const enc = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(payload))
  return toHex(new Uint8Array(buf))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
