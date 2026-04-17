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
// Wave D D1: Webhook plugin dispatcher
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
    .select('plugin_slug, webhook_url, webhook_secret_vault_ref, subscribed_events')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .not('webhook_url', 'is', null)

  if (error) {
    pluginLog.warn('Failed to read project_plugins for dispatch', { projectId, event, error: error.message })
    return
  }

  const plugins = (rows ?? []) as WebhookPlugin[]
  await Promise.all(
    plugins
      .filter((p) => p.subscribed_events.length === 0 || p.subscribed_events.includes('*') || p.subscribed_events.includes(event))
      .map((p) => deliverOne(db, projectId, event, data, p)),
  )
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
    await db.from('plugin_dispatch_log').insert({
      delivery_id: deliveryId,
      project_id: projectId,
      plugin_slug: plugin.plugin_slug,
      event,
      status: 'skipped',
      response_excerpt: 'missing_secret',
      payload_digest: digest,
    }).catch(() => {})
    return
  }

  const t = Date.now()
  const sig = await signHmac(secret, `${t}.${rawBody}`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Mushi-Event': event,
    'X-Mushi-Signature': `t=${t},v1=${sig}`,
    'X-Mushi-Project': projectId,
    'X-Mushi-Plugin': plugin.plugin_slug,
    'X-Mushi-Delivery': deliveryId,
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

  await db.from('plugin_dispatch_log').insert({
    delivery_id: deliveryId,
    project_id: projectId,
    plugin_slug: plugin.plugin_slug,
    event,
    status,
    http_status: httpStatus,
    response_excerpt: excerpt || null,
    duration_ms: durationMs,
    payload_digest: digest,
  }).catch(() => {})

  await db.from('project_plugins')
    .update({ last_delivery_at: new Date().toISOString(), last_delivery_status: status })
    .eq('project_id', projectId)
    .eq('plugin_slug', plugin.plugin_slug)
    .catch(() => {})
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

async function signHmac(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toHex(new Uint8Array(sig))
}

async function sha256Hex(payload: string): Promise<string> {
  const enc = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(payload))
  return toHex(new Uint8Array(buf))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
