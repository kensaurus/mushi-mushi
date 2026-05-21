import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

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
  // Rewards program (P1+)
  | 'reward.points_awarded'
  | 'reward.tier_changed'
  | 'reward.payout_requested'
  | 'reward.payout_paid'

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
  const subscribedPlugins = allPlugins.filter(
    (p) => p.subscribed_events.length === 0 || p.subscribed_events.includes('*') || p.subscribed_events.includes(event),
  )

  await Promise.all(
    subscribedPlugins.map((p) => {
      // Cursor Cloud Agent uses direct REST dispatch — no webhook hop needed.
      if (p.plugin_slug === CURSOR_AGENT_SLUG && CURSOR_EVENTS.has(event)) {
        return deliverCursorAgent(db, projectId, event, data, {
          plugin_slug: p.plugin_slug,
          subscribed_events: p.subscribed_events,
          config: p.config ?? null,
        })
      }
      // All other plugins use the HMAC-signed webhook path.
      if (!p.webhook_url) return Promise.resolve()
      return deliverOne(db, projectId, event, data, p)
    }),
  )
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
const CURSOR_EVENTS = new Set(['report.classified', 'qa_story.failed', 'fix.requested'])
const CURSOR_SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 }

async function deliverCursorAgent(
  db: SupabaseClient,
  projectId: string,
  event: MushiEventName | string,
  data: unknown,
  plugin: CursorPluginRow,
): Promise<void> {
  const cfg = plugin.config ?? {}
  const apiKey = typeof cfg.api_key_ref === 'string' ? cfg.api_key_ref : ''
  const workspaceId = typeof cfg.workspace_id === 'string' ? cfg.workspace_id : ''
  const model = typeof cfg.model === 'string' ? cfg.model : 'composer-2.5'
  const autoCreatePR = cfg.auto_create_pr !== false
  const maxIterations = typeof cfg.max_iterations === 'number' ? cfg.max_iterations : 1

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

  // Resolve API key if it's a vault ref
  let resolvedApiKey = apiKey
  if (apiKey.startsWith('vault://')) {
    const vaultName = apiKey.slice('vault://'.length)
    const { data: vaultData } = await db.rpc('vault_lookup', { secret_name: vaultName })
    resolvedApiKey = typeof vaultData === 'string' ? vaultData : ''
    if (!resolvedApiKey) {
      pluginLog.warn('Cursor plugin: vault lookup failed for api_key_ref', { projectId })
      return
    }
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
