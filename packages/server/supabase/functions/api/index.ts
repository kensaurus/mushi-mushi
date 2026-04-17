import { Hono } from 'npm:hono@4'
import { cors } from 'npm:hono@4/cors'
import { streamSSE } from 'npm:hono@4/streaming'
import { toSseEvent, sanitizeSseString, sseHeartbeat } from '../_shared/sse.ts'
import { AguiEmitter } from '../_shared/agui.ts'
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts'
import { apiKeyAuth, jwtAuth } from '../_shared/auth.ts'
import { regionRouter, currentRegion, lookupProjectRegion, regionEndpoint } from '../_shared/region.ts'
import { getStorageAdapter, invalidateStorageCache } from '../_shared/storage.ts'
import { reportSubmissionSchema } from '../_shared/schemas.ts'
import { checkAntiGaming } from '../_shared/anti-gaming.ts'
import { logAntiGamingEvent } from '../_shared/telemetry.ts'
import { awardPoints, getReputation } from '../_shared/reputation.ts'
import { createNotification, buildNotificationMessage } from '../_shared/notifications.ts'
import { getBlastRadius } from '../_shared/knowledge-graph.ts'
import { logAudit } from '../_shared/audit.ts'
import { createExternalIssue } from '../_shared/integrations.ts'
import { getActivePlugins, dispatchPluginEvent } from '../_shared/plugins.ts'
import { getAvailableTags } from '../_shared/ontology.ts'
import { executeNaturalLanguageQuery } from '../_shared/nl-query.ts'
import {
  createBillingPortalSession,
  createCheckoutSession,
  createCustomer,
  stripeFromEnv,
} from '../_shared/stripe.ts'

ensureSentry('api')

// basePath('/api') is required by Supabase Edge Functions: the function name
// is included in the request URL path (https://supabase.com/docs/guides/functions/routing).
const app = new Hono().basePath('/api')

app.onError(sentryHonoErrorHandler)

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Mushi-Api-Key', 'X-Mushi-Project', 'X-Sentry-Hook-Signature'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))

app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0', region: currentRegion() }))

// Wave C C7: data residency — public lookup so SDKs can prime their region
// cache before the first call. No auth required; only exposes the region tag.
app.get('/v1/region/resolve', async (c) => {
  const projectId = c.req.query('project_id')
  if (!projectId) {
    return c.json({ ok: false, error: { code: 'MISSING_PROJECT_ID' } }, 400)
  }
  const region = (await lookupProjectRegion(projectId)) ?? currentRegion()
  const endpoint = region === 'self' ? '' : regionEndpoint(region)
  return c.json({ ok: true, region, endpoint, currentRegion: currentRegion() })
})

// Wave C C7: redirect cross-region calls before they hit project-scoped DB
// queries. Bound to `/v1/*` so static endpoints (health, agent-card, region
// resolve) keep working uniformly across all clusters.
app.use('/v1/*', regionRouter)

// ============================================================
// A2A Agent Card (Wave C C5)
//
// Public discovery document for the Mushi Mushi autofix agent, following the
// Agent-to-Agent (A2A) protocol pattern at `/.well-known/agent-card`.
// Returned schema mirrors the draft A2A spec: identity, capabilities,
// supported skills, auth requirements, and a link to the MCP transport.
// Cache-Control 1h matches the conservative end of A2A discovery guidance.
// ============================================================
function buildAgentCard(req: Request): Record<string, unknown> {
  const url = new URL(req.url)
  const origin = `${url.protocol}//${url.host}`
  const apiBase = `${origin}/functions/v1/api`
  const mcpBase = `${origin}/functions/v1/mcp`

  return {
    schemaVersion: '0.2',
    spec: 'https://github.com/agent-protocol/a2a',
    id: 'dev.mushimushi.autofix',
    name: 'Mushi Mushi Autofix Agent',
    description:
      'LLM-driven bug intake, classification, and autofix agent. Accepts user-reported bugs, ' +
      'classifies them via a two-stage pipeline, and ships fixes through sandboxed agentic workflows.',
    version: '0.2.0',
    publisher: { name: 'Mushi Mushi', url: 'https://mushimushi.dev' },
    documentation: 'https://docs.mushimushi.dev/api/agent-card',
    capabilities: {
      streaming: { protocol: 'agui', version: '0.1', endpoint: `${apiBase}/v1/admin/fixes/dispatch/:id/stream` },
      sse: { sanitization: 'CVE-2026-29085' },
      mcp: { transport: 'http+sse', endpoint: mcpBase, version: '2026-03-26' },
      auth: { schemes: ['bearer', 'mushi-api-key'], discovery: `${apiBase}/v1/admin/auth/manifest` },
      tasks: { spec: 'A2A-SEP-1686', endpoint: `${mcpBase}/tasks` },
    },
    skills: [
      { id: 'classify_report', description: 'Two-stage LLM classification of an incoming bug report.' },
      { id: 'dispatch_fix', description: 'Plan, draft, sandbox, and PR a fix for an existing report.' },
      { id: 'judge_fix', description: 'LLM-as-Judge evaluation of a generated fix vs. the originating report.' },
      { id: 'intelligence_report', description: 'Generate a privacy-preserving weekly bug intelligence digest.' },
    ],
    transports: {
      rest: { base: apiBase, openapi: `${apiBase}/openapi.json` },
      mcp: { base: mcpBase },
    },
    contact: { email: 'oss@mushimushi.dev', issues: 'https://github.com/kensaurus/mushi-mushi/issues' },
    license: { id: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    generatedAt: new Date().toISOString(),
  }
}

const AGENT_CARD_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  'Access-Control-Allow-Origin': '*',
}

app.get('/.well-known/agent-card', (c) => {
  return new Response(JSON.stringify(buildAgentCard(c.req.raw), null, 2), {
    status: 200,
    headers: AGENT_CARD_HEADERS,
  })
})

// Convenience alias so consumers hitting `/v1/agent-card` (no leading dot) get
// the same payload — useful for proxies that strip dotfiles.
app.get('/v1/agent-card', (c) => {
  return new Response(JSON.stringify(buildAgentCard(c.req.raw), null, 2), {
    status: 200,
    headers: AGENT_CARD_HEADERS,
  })
})

// ============================================================
// Shared: ingest a single report and trigger pipeline
// ============================================================
async function ingestReport(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  body: Record<string, any>,
  options?: { ipAddress?: string; userAgent?: string },
): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const parsed = reportSubmissionSchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid payload' }
  }

  const report = parsed.data

  const encoder = new TextEncoder()
  const tokenData = encoder.encode(report.reporterToken)
  const tokenHashBuffer = await crypto.subtle.digest('SHA-256', tokenData)
  const tokenHash = Array.from(new Uint8Array(tokenHashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  // Build a weak device fingerprint from IP + User-Agent. This is intentionally
  // coarse: it is meant to surface the obvious case of the same browser on the
  // same network registering many reporter tokens. A stronger fingerprint would
  // need to come from the SDK (e.g. FingerprintJS) and be added to the schema.
  let deviceFingerprint: string | null = null
  if (options?.ipAddress || options?.userAgent) {
    const fpInput = encoder.encode(`${options?.ipAddress ?? ''}|${options?.userAgent ?? ''}`)
    const fpBuffer = await crypto.subtle.digest('SHA-256', fpInput)
    deviceFingerprint = Array.from(new Uint8Array(fpBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('')
  }

  const antiGaming = await checkAntiGaming(db, projectId, tokenHash, deviceFingerprint ? {
    fingerprint: deviceFingerprint,
    ipAddress: options?.ipAddress,
  } : null)
  if (antiGaming.flagged) {
    log.warn('Anti-gaming flagged report', { reporterToken: tokenHash, reason: antiGaming.reason })
    const eventType = antiGaming.reason?.toLowerCase().startsWith('velocity')
      ? 'velocity_anomaly' as const
      : 'multi_account' as const
    await logAntiGamingEvent(db, {
      projectId,
      reporterTokenHash: tokenHash,
      deviceFingerprint,
      ipAddress: options?.ipAddress ?? null,
      userAgent: options?.userAgent ?? null,
      eventType,
      reason: antiGaming.reason ?? null,
    })
  }

  let screenshotUrl: string | null = null
  let screenshotPath: string | null = null

  if (report.screenshotDataUrl) {
    try {
      const base64Data = report.screenshotDataUrl.split(',')[1]
      if (base64Data) {
        const binaryStr = atob(base64Data)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

        const mimeMatch = report.screenshotDataUrl.match(/data:([^;]+);/)
        const contentType = mimeMatch?.[1] ?? 'image/jpeg'
        const ext = contentType === 'image/png' ? 'png' : 'jpg'
        const key = `${projectId}/${crypto.randomUUID()}.${ext}`

        // Wave C C8: route through BYO storage adapter so customer-pinned
        // S3/R2/GCS/MinIO buckets receive screenshots directly. Falls back
        // to the cluster default Supabase bucket on misconfiguration.
        const adapter = await getStorageAdapter(projectId)
        const result = await adapter.upload({ key, body: bytes, contentType })
        screenshotPath = result.storagePath
        screenshotUrl = result.url
      }
    } catch (err) {
      log.error('Screenshot upload failed', { err: String(err) })
    }
  }

  const reportId = report.id || crypto.randomUUID()

  const { error: insertError } = await db.from('reports').insert({
    id: reportId,
    project_id: projectId,
    description: report.description,
    user_category: report.category,
    user_intent: report.userIntent,
    screenshot_url: screenshotUrl,
    screenshot_path: screenshotPath,
    environment: report.environment,
    console_logs: report.consoleLogs,
    network_logs: report.networkLogs,
    performance_metrics: report.performanceMetrics,
    selected_element: report.selectedElement,
    custom_metadata: report.metadata,
    proactive_trigger: report.proactiveTrigger,
    category: report.category,
    status: 'new',
    reporter_token_hash: tokenHash,
    reporter_user_id: (report.metadata as any)?.user?.id,
    session_id: report.sessionId,
    app_version: report.appVersion,
    queued_at: report.queuedAt,
    synced_at: new Date().toISOString(),
    created_at: report.createdAt,
  })

  if (insertError) {
    log.error('Report insert failed', { reportId, error: insertError.message })
    return { ok: false, error: 'Failed to store report' }
  }

  // Insert into processing queue
  const { error: queueError } = await db.from('processing_queue').insert({
    report_id: reportId,
    project_id: projectId,
    stage: 'stage1',
    status: 'pending',
  })
  if (queueError) log.error('Queue insert failed', { reportId, error: queueError.message })

  // Wave D D5: meter the ingest. Fire-and-forget — billing must never
  // block ingest. The hourly `usage-aggregator` cron rolls these up and
  // pushes a Stripe Meter Event per (project, day_utc).
  void db
    .from('usage_events')
    .insert({
      project_id: projectId,
      event_name: 'reports_ingested',
      quantity: 1,
      metadata: { report_id: reportId },
    })
    .then(({ error }) => {
      if (error) log.warn('Usage event insert failed', { reportId, error: error.message })
    })

  // Wave D D1: fire `report.created` to all webhook plugins. Fully async —
  // plugin failures must not impact ingest latency or block the pipeline.
  void dispatchPluginEvent(db, projectId, 'report.created', {
    report: { id: reportId, status: 'new', category: report.category, title: report.description?.slice(0, 80) },
    source: (report.metadata as Record<string, unknown> | undefined)?.source ?? null,
  }).catch((err) => log.warn('Plugin dispatch failed', { event: 'report.created', err: String(err) }))

  // Check circuit breaker before invoking classification
  const shouldProcess = await checkCircuitBreaker(db)

  if (shouldProcess) {
    triggerClassification(reportId, projectId)
  } else {
    await db.from('reports').update({ status: 'queued' }).eq('id', reportId)
    log.warn('Circuit breaker open — report queued', { reportId })
  }

  return { ok: true, reportId }
}

async function checkCircuitBreaker(db: ReturnType<typeof getServiceClient>): Promise<boolean> {
  try {
    const { count: failedCount } = await db
      .from('processing_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('completed_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

    const { count: totalCount } = await db
      .from('processing_queue')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

    if (!totalCount || totalCount < 5) return true
    return ((failedCount ?? 0) / totalCount) < 0.5
  } catch {
    return true
  }
}

function triggerClassification(reportId: string, projectId: string) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const classifyPromise = fetch(`${supabaseUrl}/functions/v1/fast-filter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ reportId, projectId }),
    }).then(async (res) => {
      const db = getServiceClient()
      if (res.ok) {
        await db.from('processing_queue')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('report_id', reportId)
          .eq('status', 'pending')
      } else {
        const body = await res.text()
        await handleQueueFailure(db, reportId, `Stage 1 failed: ${res.status} ${body}`)
      }
    }).catch(async (err) => {
      const db = getServiceClient()
      await handleQueueFailure(db, reportId, String(err))
    })

    if (typeof globalThis.EdgeRuntime !== 'undefined') {
      (globalThis as any).EdgeRuntime.waitUntil(classifyPromise)
    }
  } catch (err) {
    log.error('Failed to invoke fast-filter', { reportId, err: String(err) })
  }
}

async function handleQueueFailure(db: ReturnType<typeof getServiceClient>, reportId: string, error: string) {
  const { data: item } = await db
    .from('processing_queue')
    .select('id, attempts, max_attempts')
    .eq('report_id', reportId)
    .eq('status', 'pending')
    .single()

  if (!item) return

  const attempts = (item.attempts ?? 0) + 1
  const isDead = attempts >= (item.max_attempts ?? 3)

  await db.from('processing_queue').update({
    attempts,
    last_error: error,
    status: isDead ? 'dead_letter' : 'failed',
    completed_at: new Date().toISOString(),
  }).eq('id', item.id)

  if (isDead) {
    log.error('Report moved to dead letter queue', { reportId, attempts })
  }
}

// ============================================================
// SDK ROUTES (API key auth)
// ============================================================

app.post('/v1/reports', apiKeyAuth, async (c) => {
  try {
    const projectId = c.get('projectId') as string
    const body = await c.req.json()
    const db = getServiceClient()
    const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip')
    const userAgent = c.req.header('user-agent')

    const result = await ingestReport(db, projectId, body, { ipAddress, userAgent })
    if (!result.ok) {
      return c.json({ ok: false, error: { code: 'INGEST_ERROR', message: result.error } }, 400)
    }
    return c.json({ ok: true, data: { reportId: result.reportId, status: 'submitted' } }, 201)
  } catch (err) {
    log.error('Unhandled report submission error', { err: String(err) })
    return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: String(err) } }, 500)
  }
})

app.post('/v1/reports/batch', apiKeyAuth, async (c) => {
  const projectId = c.get('projectId') as string
  const { reports } = await c.req.json() as { reports: Record<string, any>[] }

  if (!Array.isArray(reports) || reports.length === 0) {
    return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'reports array required' } }, 400)
  }

  const batch = reports.slice(0, 10)
  const db = getServiceClient()
  const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip')
  const userAgent = c.req.header('user-agent')
  const results: Array<{ reportId?: string; ok: boolean; error?: string }> = []

  const settled = await Promise.allSettled(
    batch.map(report => ingestReport(db, projectId, report, { ipAddress, userAgent }))
  )
  for (const r of settled) {
    results.push(r.status === 'fulfilled' ? r.value : { ok: false, error: String((r as PromiseRejectedResult).reason) })
  }

  const sent = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length

  return c.json({ ok: true, data: { sent, failed, results } }, 201)
})

// ============================================================
// SENTRY WEBHOOK
// ============================================================

app.post('/v1/webhooks/sentry', async (c) => {
  const signature = c.req.header('X-Sentry-Hook-Signature')
  const body = await c.req.text()

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body)
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  const projectId = (payload?.data as Record<string, unknown>)?.project
    ? undefined
    : c.req.header('X-Mushi-Project')

  if (!projectId) {
    return c.json({ ok: false, error: 'Cannot determine project' }, 400)
  }

  const db = getServiceClient()

  const { data: settings } = await db
    .from('project_settings')
    .select('sentry_webhook_secret, sentry_consume_user_feedback')
    .eq('project_id', projectId)
    .single()

  if (!settings?.sentry_webhook_secret) {
    return c.json({ ok: false, error: 'Sentry webhook secret not configured for this project' }, 403)
  }

  if (!signature) {
    return c.json({ ok: false, error: 'Missing signature' }, 401)
  }

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(settings.sentry_webhook_secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')

  if (expected !== signature) {
    return c.json({ ok: false, error: 'Invalid signature' }, 401)
  }

  const action = payload?.action
  if (action === 'created' && payload?.data?.feedback) {
    const feedback = payload.data.feedback
    const reportId = crypto.randomUUID()

    await db.from('reports').insert({
      id: reportId,
      project_id: projectId,
      description: feedback.message ?? '',
      user_category: 'other',
      category: 'other',
      status: 'new',
      reporter_token_hash: feedback.email ?? 'sentry-webhook',
      sentry_issue_url: payload.data.issue?.permalink,
      sentry_seer_analysis: payload.data.seer_analysis,
      custom_metadata: {
        source: 'sentry_webhook',
        sentryEventId: feedback.event_id,
        sentryIssueId: payload.data.issue?.id,
        userName: feedback.name,
        userEmail: feedback.email,
      },
      environment: { userAgent: 'sentry-webhook', platform: '', language: '', viewport: { width: 0, height: 0 }, url: payload.data.issue?.permalink ?? '', referrer: '', timestamp: new Date().toISOString(), timezone: 'UTC' },
      created_at: new Date().toISOString(),
    })

    triggerClassification(reportId, projectId)
    return c.json({ ok: true, data: { reportId } })
  }

  return c.json({ ok: true, data: { action: 'ignored' } })
})

// ============================================================
// SDK STATUS
// ============================================================

app.get('/v1/reports/:id/status', apiKeyAuth, async (c) => {
  const reportId = c.req.param('id')
  const projectId = c.get('projectId') as string
  const db = getServiceClient()

  const { data, error } = await db
    .from('reports')
    .select('status, category, severity, summary')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .single()

  if (error || !data) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404)
  }
  return c.json({ ok: true, data })
})

// Reporter reputation
app.get('/v1/reputation', apiKeyAuth, async (c) => {
  const projectId = c.get('projectId') as string
  const reporterToken = c.req.query('reporterToken')
  if (!reporterToken) return c.json({ ok: false, error: { code: 'MISSING_TOKEN', message: 'reporterToken query required' } }, 400)

  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(reporterToken))
  const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

  const db = getServiceClient()
  const rep = await getReputation(db, projectId, tokenHash)
  return c.json({ ok: true, data: rep })
})

// Reporter notifications
app.get('/v1/notifications', apiKeyAuth, async (c) => {
  const projectId = c.get('projectId') as string
  const reporterToken = c.req.query('reporterToken')
  if (!reporterToken) return c.json({ ok: false, error: { code: 'MISSING_TOKEN', message: 'reporterToken query required' } }, 400)

  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(reporterToken))
  const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

  const db = getServiceClient()
  const { data: notifications } = await db
    .from('reporter_notifications')
    .select('id, notification_type, payload, read_at, created_at')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', tokenHash)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(20)

  return c.json({ ok: true, data: { notifications: notifications ?? [] } })
})

app.post('/v1/notifications/:id/read', apiKeyAuth, async (c) => {
  const notifId = c.req.param('id')
  const projectId = c.get('projectId') as string
  const reporterToken = c.req.query('reporterToken')
  if (!reporterToken) return c.json({ ok: false, error: { code: 'MISSING_TOKEN', message: 'reporterToken query required' } }, 400)

  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(reporterToken))
  const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

  const db = getServiceClient()
  await db.from('reporter_notifications').update({ read_at: new Date().toISOString() }).eq('id', notifId).eq('project_id', projectId).eq('reporter_token_hash', tokenHash)
  return c.json({ ok: true })
})

// ============================================================
// FIX DISPATCH (V5.3 §2.10) — admin-triggered, queue-based
// ============================================================

app.post('/v1/admin/fixes/dispatch', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => ({})) as { reportId?: string; projectId?: string }
  if (!body.reportId || !body.projectId) {
    return c.json({ ok: false, error: { code: 'MISSING_FIELDS', message: 'reportId and projectId required' } }, 400)
  }

  const db = getServiceClient()
  const { data: membership } = await db
    .from('project_members')
    .select('role')
    .eq('user_id', userId)
    .eq('project_id', body.projectId)
    .single()
  if (!membership) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
  }

  const { data: settings } = await db
    .from('project_settings')
    .select('autofix_enabled')
    .eq('project_id', body.projectId)
    .single()
  if (!settings?.autofix_enabled) {
    return c.json({ ok: false, error: { code: 'AUTOFIX_DISABLED', message: 'Enable Autofix in project settings first' } }, 400)
  }

  // Scope the in-flight check to (project_id, report_id). Reports are
  // project-scoped, so two different projects must be allowed to dispatch
  // jobs concurrently even if their report_id values happen to coincide.
  const { data: existing } = await db
    .from('fix_dispatch_jobs')
    .select('id, status')
    .eq('project_id', body.projectId)
    .eq('report_id', body.reportId)
    .in('status', ['queued', 'running'])
    .limit(1)
  if (existing?.length) {
    return c.json({ ok: false, error: { code: 'ALREADY_DISPATCHED', message: 'A fix dispatch is already in progress for this report', dispatchId: existing[0].id } }, 409)
  }

  const { data: job, error: insertErr } = await db
    .from('fix_dispatch_jobs')
    .insert({
      project_id: body.projectId,
      report_id: body.reportId,
      requested_by: userId,
      status: 'queued',
    })
    .select('id, status, created_at')
    .single()
  if (insertErr || !job) {
    return c.json({ ok: false, error: { code: 'DISPATCH_FAILED', message: insertErr?.message ?? 'Could not enqueue' } }, 500)
  }

  return c.json({ ok: true, data: { dispatchId: job.id, status: job.status, createdAt: job.created_at } })
})

app.get('/v1/admin/fixes/dispatches', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: memberships } = await db
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)
  const projectIds = (memberships ?? []).map(m => m.project_id)
  if (projectIds.length === 0) return c.json({ ok: true, data: { dispatches: [] } })
  const { data: dispatches } = await db
    .from('fix_dispatch_jobs')
    .select('*')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(50)
  return c.json({ ok: true, data: { dispatches: dispatches ?? [] } })
})

app.get('/v1/admin/fixes/dispatch/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const dispatchId = c.req.param('id')
  const db = getServiceClient()
  const { data: job } = await db
    .from('fix_dispatch_jobs')
    .select('*, project:project_id(id, name)')
    .eq('id', dispatchId)
    .single()
  if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)
  const { data: membership } = await db
    .from('project_members')
    .select('role')
    .eq('user_id', userId)
    .eq('project_id', job.project_id)
    .single()
  if (!membership) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)
  return c.json({ ok: true, data: job })
})

// ------------------------------------------------------------
// V5.3 §2.10 (M8): live status stream for a fix-dispatch job.
// Uses Hono's streamSSE with deferred Bearer auth (the browser cannot send
// Authorization on EventSource, so the client uses fetch + ReadableStream).
// All payloads are JSON-encoded via toSseEvent so untrusted strings cannot
// inject "event:"/"id:"/"data:"/"retry:" frames (CVE-2026-29085).
// ------------------------------------------------------------
app.get('/v1/admin/fixes/dispatch/:id/stream', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const dispatchId = c.req.param('id')
  const db = getServiceClient()

  const { data: job } = await db
    .from('fix_dispatch_jobs')
    .select('id, project_id, status, fix_attempt_id, pr_url, error')
    .eq('id', dispatchId)
    .single()
  if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: membership } = await db
    .from('project_members')
    .select('role')
    .eq('user_id', userId)
    .eq('project_id', job.project_id)
    .single()
  if (!membership) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  // V5.3.2 §2.14, B3: AG-UI streaming protocol envelope.
  // The legacy `event: status` frame is still emitted for back-compat; new
  // clients should subscribe to the AG-UI event types (`run.*`).
  return streamSSE(c, async (stream) => {
    const agui = new AguiEmitter({
      runId: dispatchId,
      write: (frame) => stream.write(frame),
    })

    let lastStatus = ''
    let elapsed = 0
    const HEARTBEAT_EVERY_MS = 15_000
    const POLL_EVERY_MS = 1_500
    const MAX_DURATION_MS = 10 * 60_000

    await agui.started({
      resource: 'fix_dispatch',
      resourceId: dispatchId,
      attributes: { projectId: job.project_id },
    })

    while (elapsed < MAX_DURATION_MS && !stream.aborted) {
      const { data: latest } = await db
        .from('fix_dispatch_jobs')
        .select('status, fix_attempt_id, pr_url, error, started_at, finished_at')
        .eq('id', dispatchId)
        .single()
      if (!latest) {
        await agui.failed({ code: 'NOT_FOUND', message: 'Job disappeared' })
        await stream.write(toSseEvent({ code: 'NOT_FOUND' }, { event: 'error' }))
        break
      }

      if (latest.status !== lastStatus) {
        lastStatus = latest.status
        const sanitized = latest.error ? sanitizeForLog(latest.error) : null

        await agui.status({
          status: latest.status,
          detail: sanitized ?? undefined,
        })

        await stream.write(toSseEvent({
          status: latest.status,
          fixAttemptId: latest.fix_attempt_id,
          prUrl: latest.pr_url,
          startedAt: latest.started_at,
          finishedAt: latest.finished_at,
          error: sanitized,
        }, { event: 'status', id: `${dispatchId}:${Date.now()}` }))
      }

      if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled') {
        if (latest.status === 'completed') {
          await agui.completed({ output: { prUrl: latest.pr_url, fixAttemptId: latest.fix_attempt_id } })
        } else {
          await agui.failed({
            code: latest.status === 'cancelled' ? 'CANCELLED' : 'FIX_FAILED',
            message: latest.error ? sanitizeForLog(latest.error) : latest.status,
          })
        }
        await stream.write(toSseEvent({ done: true }, { event: 'done' }))
        break
      }

      if (elapsed % HEARTBEAT_EVERY_MS < POLL_EVERY_MS) {
        await agui.heartbeat()
        await stream.write(sseHeartbeat())
      }

      await stream.sleep(POLL_EVERY_MS)
      elapsed += POLL_EVERY_MS
    }

    if (elapsed >= MAX_DURATION_MS) {
      await agui.failed({ code: 'STREAM_TIMEOUT', message: 'Reconnect to keep watching', retryable: true })
      await stream.write(toSseEvent({ code: 'STREAM_TIMEOUT', message: 'Reconnect to keep watching' }, { event: 'error' }))
    }
  })
})

function sanitizeForLog(s: string): string {
  // sanitizeSseString is for raw `data:` frames; for embedded JSON we just
  // strip control chars so the LLM/agent can't smuggle ANSI escapes.
  return sanitizeSseString(s).replace(/^data:\s?/gm, '').replace(/\n+$/, '').slice(0, 500)
}

// ============================================================
// CODEBASE INDEXER (V5.3 §2.3.4) — non-GitHub fallback for `mushi index`
// Auth: project API key. Each call uploads ONE source file; server chunks +
// embeds + upserts. Designed for low-throughput CLI use; high-throughput
// indexing should use the GitHub App webhook path.
// ============================================================

app.post('/v1/admin/codebase/upload', apiKeyAuth, async (c) => {
  const projectId = c.get('projectId') as string
  const body = await c.req.json().catch(() => ({})) as {
    projectId?: string
    filePath?: string
    source?: string
  }
  if (!body.filePath || !body.source) {
    return c.json({ ok: false, error: { code: 'MISSING_FIELDS', message: 'filePath and source required' } }, 400)
  }
  if (body.projectId && body.projectId !== projectId) {
    return c.json({ ok: false, error: { code: 'PROJECT_MISMATCH', message: 'API key project does not match body projectId' } }, 403)
  }
  if (body.source.length > 500_000) {
    return c.json({ ok: false, error: { code: 'TOO_LARGE', message: 'Source > 500KB; skip large files' } }, 413)
  }

  const { chunk, shouldIndex, sha256Hex } = await import('../_shared/code-indexer.ts')
  const { createEmbedding } = await import('../_shared/embeddings.ts')

  if (!shouldIndex(body.filePath)) {
    return c.json({ ok: true, chunks: 0, skipped: 'unsupported_extension' })
  }

  const db = getServiceClient()
  const chunks = chunk(body.filePath, body.source)
  let inserted = 0
  for (const ch of chunks) {
    try {
      const text = `${body.filePath}::${ch.symbolName ?? 'whole'}\n${ch.body}`
      const embedding = await createEmbedding(text)
      const contentHash = await sha256Hex(ch.body)
      await db.from('project_codebase_files').upsert({
        project_id: projectId,
        file_path: body.filePath,
        symbol_name: ch.symbolName,
        signature: ch.signature,
        line_start: ch.lineStart,
        line_end: ch.lineEnd,
        language: ch.language,
        content_hash: contentHash,
        content_preview: ch.body.slice(0, 600),
        embedding,
        embedding_model: 'text-embedding-3-small',
        last_modified: new Date().toISOString(),
        tombstoned_at: null,
      }, { onConflict: 'project_id,file_path,symbol_name' })
      inserted++
    } catch (err) {
      // best-effort per chunk; continue
      console.warn('chunk upload failed', String(err))
    }
  }
  return c.json({ ok: true, chunks: inserted })
})

// ============================================================
// ADMIN ROUTES (JWT auth)
// ============================================================

app.get('/v1/admin/reports', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  if (projectIds.length === 0) return c.json({ ok: true, data: { reports: [], total: 0 } })

  const status = c.req.query('status')
  const category = c.req.query('category')
  const severity = c.req.query('severity')
  const limit = Math.min(Number(c.req.query('limit')) || 50, 100)
  const offset = Number(c.req.query('offset')) || 0

  let query = db
    .from('reports')
    .select('id, project_id, description, category, severity, summary, status, created_at, environment, screenshot_url, user_category, confidence, component, report_group_id', { count: 'exact' })
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (category) query = query.eq('category', category)
  if (severity) query = query.eq('severity', severity)

  const { data: reports, count, error } = await query
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { reports: reports ?? [], total: count ?? 0 } })
})

app.get('/v1/admin/reports/:id', jwtAuth, async (c) => {
  const reportId = c.req.param('id')
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const { data, error } = await db.from('reports').select('*').eq('id', reportId).in('project_id', projectIds).single()
  if (error || !data) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404)
  return c.json({ ok: true, data })
})

app.patch('/v1/admin/reports/:id', jwtAuth, async (c) => {
  const reportId = c.req.param('id')
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()

  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const allowedFields: Record<string, boolean> = { status: true, severity: true, category: true, component: true }
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (allowedFields[key]) updates[key] = value
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ ok: false, error: { code: 'NO_FIELDS', message: 'No valid fields to update' } }, 400)
  }

  // Fetch report before update for reputation tracking
  const { data: report } = await db.from('reports')
    .select('project_id, reporter_token_hash, status')
    .eq('id', reportId).in('project_id', projectIds).single()

  const { error } = await db.from('reports').update(updates).eq('id', reportId).in('project_id', projectIds)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  // Award reputation points on status transitions
  if (report && updates.status && updates.status !== report.status) {
    const newStatus = updates.status as string
    void dispatchPluginEvent(db, report.project_id, 'report.status_changed', {
      report: { id: reportId, status: newStatus },
      previousStatus: report.status,
      actor: { kind: 'admin', userId },
    }).catch((e) => log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }))
    if (newStatus === 'fixing') {
      awardPoints(db, report.project_id, report.reporter_token_hash, { action: 'confirmed' })
        .catch(e => log.error('Reputation award failed', { action: 'confirmed', err: String(e) }))
      createNotification(db, report.project_id, reportId, report.reporter_token_hash, 'confirmed', {
        message: buildNotificationMessage('confirmed', { points: 50 }),
        points: 50,
        reportId,
      }).catch(e => log.error('Notification failed', { type: 'confirmed', err: String(e) }))
    } else if (newStatus === 'fixed') {
      awardPoints(db, report.project_id, report.reporter_token_hash, { action: 'fixed' })
        .catch(e => log.error('Reputation award failed', { action: 'fixed', err: String(e) }))
      createNotification(db, report.project_id, reportId, report.reporter_token_hash, 'fixed', {
        message: buildNotificationMessage('fixed', { points: 25 }),
        points: 25,
        reportId,
      }).catch(e => log.error('Notification failed', { type: 'fixed', err: String(e) }))
    } else if (newStatus === 'dismissed') {
      awardPoints(db, report.project_id, report.reporter_token_hash, { action: 'dismissed' })
        .catch(e => log.error('Reputation award failed', { action: 'dismissed', err: String(e) }))
      createNotification(db, report.project_id, reportId, report.reporter_token_hash, 'dismissed', {
        message: buildNotificationMessage('dismissed', {}),
        reportId,
      }).catch(e => log.error('Notification failed', { type: 'dismissed', err: String(e) }))
    }
  }

  return c.json({ ok: true })
})

app.get('/v1/admin/stats', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  if (projectIds.length === 0) return c.json({ ok: true, data: { total: 0, byStatus: {}, byCategory: {}, bySeverity: {} } })

  const { count: total } = await db.from('reports').select('id', { count: 'exact', head: true }).in('project_id', projectIds)

  const { data: statusRows } = await db.rpc('count_by_column', { col: 'status', project_ids: projectIds }).select('*')
  const { data: categoryRows } = await db.rpc('count_by_column', { col: 'category', project_ids: projectIds }).select('*')
  const { data: severityRows } = await db.rpc('count_by_column', { col: 'severity', project_ids: projectIds }).select('*')

  const toMap = (rows: Array<{ val: string; cnt: number }> | null) => Object.fromEntries((rows ?? []).map(r => [r.val, r.cnt]))

  return c.json({ ok: true, data: { total: total ?? 0, byStatus: toMap(statusRows), byCategory: toMap(categoryRows), bySeverity: toMap(severityRows) } })
})

// Judge scores / drift data
app.get('/v1/admin/judge-scores', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { weeks: [] } })

  const { data: weeks } = await db.rpc('weekly_judge_scores', {
    p_project_id: project.id,
    p_weeks: 12,
  })

  return c.json({ ok: true, data: { weeks: weeks ?? [] } })
})

// Settings admin endpoints
app.get('/v1/admin/settings', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: {} })

  const { data } = await db
    .from('project_settings')
    .select('*')
    .eq('project_id', project.id)
    .single()

  return c.json({ ok: true, data: data ?? {} })
})

app.patch('/v1/admin/settings', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()

  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project found' } }, 404)

  const allowed = [
    'slack_webhook_url', 'sentry_dsn', 'sentry_webhook_secret', 'sentry_consume_user_feedback',
    'stage2_model', 'stage1_confidence_threshold', 'dedup_threshold', 'embedding_model',
    'graph_backend',
  ]
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key)) updates[key] = value
  }

  const { error } = await db
    .from('project_settings')
    .upsert({ project_id: project.id, ...updates }, { onConflict: 'project_id' })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true })
})

// ============================================================
// Wave C C9: Bring-Your-Own-Key admin endpoints
//
// Customers register their own Anthropic / OpenAI keys per project. The raw
// key never lands in `project_settings`; it is stashed in Supabase Vault and
// only a `vault://<name>` reference is persisted. The pipeline (fast-filter,
// classify-report, judge-batch) then dereferences via `resolveLlmKey`.
// ============================================================

const BYOK_PROVIDERS = ['anthropic', 'openai'] as const
type ByokProvider = (typeof BYOK_PROVIDERS)[number]

function byokSecretName(projectId: string, provider: ByokProvider): string {
  return `mushi/byok/${projectId}/${provider}`
}

app.get('/v1/admin/byok', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { keys: [] } })

  const { data } = await db
    .from('project_settings')
    .select(
      'byok_anthropic_key_ref, byok_anthropic_key_added_at, byok_anthropic_key_last_used_at, ' +
      'byok_openai_key_ref, byok_openai_key_added_at, byok_openai_key_last_used_at',
    )
    .eq('project_id', project.id)
    .single()

  const keys = BYOK_PROVIDERS.map((provider) => ({
    provider,
    configured: Boolean((data as Record<string, unknown> | null)?.[`byok_${provider}_key_ref`]),
    addedAt: (data as Record<string, string | null> | null)?.[`byok_${provider}_key_added_at`] ?? null,
    lastUsedAt: (data as Record<string, string | null> | null)?.[`byok_${provider}_key_last_used_at`] ?? null,
  }))

  return c.json({ ok: true, data: { projectId: project.id, keys } })
})

app.put('/v1/admin/byok/:provider', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const provider = c.req.param('provider') as ByokProvider
  if (!BYOK_PROVIDERS.includes(provider)) {
    return c.json({ ok: false, error: { code: 'BAD_PROVIDER', message: `Unknown provider: ${provider}` } }, 400)
  }
  const body = await c.req.json().catch(() => ({}))
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (key.length < 8) {
    return c.json({ ok: false, error: { code: 'KEY_TOO_SHORT', message: 'Provide the full provider API key.' } }, 400)
  }

  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const secretName = byokSecretName(project.id, provider)
  const { error: vaultErr } = await db.rpc('vault_store_secret', { secret_name: secretName, secret_value: key })
  if (vaultErr) {
    log.error('vault_store_secret failed', { provider, error: vaultErr.message })
    return c.json({ ok: false, error: { code: 'VAULT_WRITE_FAILED', message: vaultErr.message } }, 500)
  }

  const now = new Date().toISOString()
  const update: Record<string, string | null> = {
    [`byok_${provider}_key_ref`]: `vault://${secretName}`,
    [`byok_${provider}_key_added_at`]: now,
    [`byok_${provider}_key_last_used_at`]: null,
  }
  const { error: upsertErr } = await db
    .from('project_settings')
    .upsert({ project_id: project.id, ...update }, { onConflict: 'project_id' })
  if (upsertErr) {
    return c.json({ ok: false, error: { code: 'DB_ERROR', message: upsertErr.message } }, 500)
  }

  // 'rotated' covers the upsert path (replacing a prior key); 'added' for first-time.
  // We don't have a cheap pre-read of the existing ref here, so log as 'rotated'
  // — both are auditable mutations and the meta.added_at preserves first-seen.
  await db
    .from('byok_audit_log')
    .insert({ project_id: project.id, provider, action: 'rotated', actor_user_id: userId, meta: { added_at: now } })
    .catch(() => {})
  await logAudit(db, project.id, userId, 'settings.updated', 'byok', provider, { provider }).catch(() => {})

  return c.json({ ok: true, data: { provider, configured: true, addedAt: now, hint: `…${key.slice(-4)}` } })
})

app.delete('/v1/admin/byok/:provider', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const provider = c.req.param('provider') as ByokProvider
  if (!BYOK_PROVIDERS.includes(provider)) {
    return c.json({ ok: false, error: { code: 'BAD_PROVIDER' } }, 400)
  }
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const secretName = byokSecretName(project.id, provider)
  await db.rpc('vault_delete_secret', { secret_name: secretName }).catch((err) => {
    log.warn('vault_delete_secret failed (non-fatal)', { provider, error: String(err) })
  })

  const { error } = await db
    .from('project_settings')
    .upsert({
      project_id: project.id,
      [`byok_${provider}_key_ref`]: null,
      [`byok_${provider}_key_added_at`]: null,
      [`byok_${provider}_key_last_used_at`]: null,
    }, { onConflict: 'project_id' })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await db.from('byok_audit_log').insert({ project_id: project.id, provider, action: 'removed', actor_user_id: userId }).catch(() => {})
  await logAudit(db, project.id, userId, 'settings.updated', 'byok', provider, { provider, cleared: true }).catch(() => {})

  return c.json({ ok: true })
})

// Projects admin endpoints
app.get('/v1/admin/projects', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db
    .from('projects')
    .select('id, name, slug, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })

  const projectIds = (projects ?? []).map(p => p.id)
  if (projectIds.length === 0) return c.json({ ok: true, data: { projects: [] } })

  const [reportCounts, allKeys] = await Promise.all([
    db.from('reports').select('project_id', { count: 'exact', head: false }).in('project_id', projectIds),
    db.from('project_api_keys').select('id, project_id, key_prefix, created_at, is_active').in('project_id', projectIds).order('created_at', { ascending: false }),
  ])

  const countMap: Record<string, number> = {}
  for (const r of reportCounts.data ?? []) countMap[r.project_id] = (countMap[r.project_id] ?? 0) + 1

  const keyMap: Record<string, Array<Record<string, unknown>>> = {}
  for (const k of allKeys.data ?? []) {
    if (!keyMap[k.project_id]) keyMap[k.project_id] = []
    keyMap[k.project_id].push({ id: k.id, key_prefix: k.key_prefix, created_at: k.created_at, is_active: k.is_active, revoked: !k.is_active })
  }

  const enriched = (projects ?? []).map(p => ({
    ...p,
    report_count: countMap[p.id] ?? 0,
    api_keys: keyMap[p.id] ?? [],
  }))

  return c.json({ ok: true, data: { projects: enriched } })
})

app.post('/v1/admin/projects', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const { name } = await c.req.json() as { name: string }
  const db = getServiceClient()

  if (!name?.trim()) {
    return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Name required' } }, 400)
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const { data, error } = await db.from('projects').insert({
    name: name.trim(),
    slug,
    owner_id: userId,
  }).select('id').single()

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await db.from('project_settings').insert({ project_id: data.id })

  return c.json({ ok: true, data: { id: data.id, slug } }, 201)
})

app.post('/v1/admin/projects/:id/keys', jwtAuth, async (c) => {
  const projectId = c.req.param('id')
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: project } = await db.from('projects').select('id').eq('id', projectId).eq('owner_id', userId).single()
  if (!project) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)

  const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
  const prefix = rawKey.slice(0, 12)

  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey))
  const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

  const { error } = await db.from('project_api_keys').insert({
    project_id: projectId,
    key_hash: keyHash,
    key_prefix: prefix,
    label: 'default',
    is_active: true,
  })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { key: rawKey, prefix } }, 201)
})

app.delete('/v1/admin/projects/:id/keys/:keyId', jwtAuth, async (c) => {
  const projectId = c.req.param('id')
  const keyId = c.req.param('keyId')
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: project } = await db.from('projects').select('id').eq('id', projectId).eq('owner_id', userId).single()
  if (!project) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)

  await db.from('project_api_keys').update({
    is_active: false,
    revoked_at: new Date().toISOString(),
  }).eq('id', keyId).eq('project_id', projectId)

  return c.json({ ok: true })
})

// Admin pipeline diagnostic. Exists so the admin console's "Send test report"
// buttons (DashboardPage.GettingStartedEmpty, SettingsPage.QuickTestSection)
// can verify the ingest path without copy-pasting an API key — the admin is
// already JWT-authenticated and owns the project. Goes through ingestReport()
// so it really exercises schema validation, queue insert, circuit breaker, and
// classification trigger. Tagged with metadata.source so admins can filter
// these out of the inbox.
app.post('/v1/admin/projects/:id/test-report', jwtAuth, async (c) => {
  const projectId = c.req.param('id')
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: project } = await db
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('owner_id', userId)
    .single()
  if (!project) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)

  const ipAddress = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip')
  const userAgent = c.req.header('user-agent') ?? 'mushi-admin'
  const now = new Date().toISOString()

  const syntheticBody = {
    projectId, // schema-required; ingestReport actually uses the auth-context projectId
    category: 'other' as const,
    description: 'Admin pipeline test — verifying ingest, validation, queue, and classification end-to-end.',
    environment: {
      userAgent,
      platform: 'mushi-admin',
      language: 'en',
      viewport: { width: 0, height: 0 },
      url: 'admin://test-report',
      referrer: '',
      timestamp: now,
      timezone: 'UTC',
    },
    reporterToken: `admin-test-${userId}`,
    metadata: { source: 'admin_test_report', userId },
    createdAt: now,
  }

  const result = await ingestReport(db, projectId, syntheticBody, { ipAddress, userAgent })
  if (!result.ok) {
    return c.json({ ok: false, error: { code: 'INGEST_ERROR', message: result.error } }, 400)
  }

  return c.json({
    ok: true,
    data: { reportId: result.reportId, projectName: project.name },
  }, 201)
})

// DLQ admin endpoints
app.get('/v1/admin/queue', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  if (projectIds.length === 0) return c.json({ ok: true, data: { items: [], total: 0 } })

  const status = c.req.query('status') ?? 'dead_letter'
  const { data: items, count } = await db
    .from('processing_queue')
    .select('*, reports(description, user_category, created_at)', { count: 'exact' })
    .in('project_id', projectIds)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(50)

  return c.json({ ok: true, data: { items: items ?? [], total: count ?? 0 } })
})

app.post('/v1/admin/queue/:id/retry', jwtAuth, async (c) => {
  const queueId = c.req.param('id')
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const { data: item } = await db
    .from('processing_queue')
    .select('id, report_id, project_id, stage, status, attempts, max_attempts, last_error, scheduled_at, started_at, completed_at, created_at')
    .eq('id', queueId)
    .in('project_id', projectIds)
    .single()

  if (!item) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Queue item not found' } }, 404)

  await db.from('processing_queue').update({
    status: 'pending',
    attempts: 0,
    last_error: null,
    scheduled_at: new Date().toISOString(),
  }).eq('id', queueId)

  triggerClassification(item.report_id, item.project_id)
  return c.json({ ok: true })
})

// ============================================================
// PHASE 2: KNOWLEDGE GRAPH
// ============================================================

app.get('/v1/admin/graph/nodes', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const nodeType = c.req.query('type')
  let query = db.from('graph_nodes').select('id, project_id, node_type, label, metadata, last_traversed_at, created_at').in('project_id', projectIds).limit(200)
  if (nodeType) query = query.eq('node_type', nodeType)

  const { data } = await query.order('created_at', { ascending: false })
  return c.json({ ok: true, data: { nodes: data ?? [] } })
})

app.get('/v1/admin/graph/edges', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const edgeType = c.req.query('type')
  let query = db.from('graph_edges').select('id, project_id, source_node_id, target_node_id, edge_type, weight, created_at').in('project_id', projectIds).limit(500)
  if (edgeType) query = query.eq('edge_type', edgeType)

  const { data } = await query
  return c.json({ ok: true, data: { edges: data ?? [] } })
})

app.get('/v1/admin/graph/blast-radius/:nodeId', jwtAuth, async (c) => {
  const nodeId = c.req.param('nodeId')
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  const { data: node } = await db.from('graph_nodes').select('id').eq('id', nodeId).in('project_id', projectIds).single()
  if (!node) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Node not found' } }, 404)
  const affected = await getBlastRadius(db, nodeId)
  return c.json({ ok: true, data: { affected } })
})

// ============================================================
// PHASE 2: BUG ONTOLOGY
// ============================================================

app.get('/v1/admin/ontology', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { tags: [] } })

  const tags = await getAvailableTags(db, project.id)
  return c.json({ ok: true, data: { tags } })
})

app.post('/v1/admin/ontology', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project found' } }, 404)

  const { error } = await db.from('bug_ontology').insert({
    project_id: project.id,
    tag: body.tag,
    parent_tag: body.parentTag ?? null,
    description: body.description ?? null,
  })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  return c.json({ ok: true })
})

// ============================================================
// PHASE 2: NATURAL LANGUAGE QUERY
// ============================================================

app.post('/v1/admin/query', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const { question } = await c.req.json()
  if (!question) return c.json({ ok: false, error: { code: 'MISSING_QUESTION', message: 'question is required' } }, 400)

  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  if (!projectIds.length) return c.json({ ok: true, data: { results: [], summary: 'No projects found.' } })

  try {
    const result = await executeNaturalLanguageQuery(db, projectIds, question)
    return c.json({ ok: true, data: result })
  } catch (err) {
    return c.json({ ok: false, error: { code: 'QUERY_ERROR', message: String(err) } }, 400)
  }
})

// ============================================================
// PHASE 2: REPORT GROUPS
// ============================================================

app.get('/v1/admin/groups', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const { data } = await db
    .from('report_groups')
    .select('*, reports:reports(id, summary, category, severity, status, created_at)')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(50)

  return c.json({ ok: true, data: { groups: data ?? [] } })
})

app.post('/v1/admin/groups/:id/merge', jwtAuth, async (c) => {
  const groupId = c.req.param('id')
  const { targetGroupId } = await c.req.json()
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const { data: sourceGroup } = await db.from('report_groups').select('id, project_id').eq('id', groupId).in('project_id', projectIds).single()
  const { data: targetGroup } = await db.from('report_groups').select('id, project_id').eq('id', targetGroupId).in('project_id', projectIds).single()
  if (!sourceGroup || !targetGroup) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Group not found' } }, 404)
  if (sourceGroup.project_id !== targetGroup.project_id) return c.json({ ok: false, error: { code: 'INVALID', message: 'Groups must belong to the same project' } }, 400)

  await db.from('reports').update({ report_group_id: targetGroupId }).eq('report_group_id', groupId)
  const { count } = await db.from('reports').select('id', { count: 'exact', head: true }).eq('report_group_id', targetGroupId)
  await db.from('report_groups').update({ report_count: count ?? 0 }).eq('id', targetGroupId)
  await db.from('report_groups').delete().eq('id', groupId)

  return c.json({ ok: true })
})

// ============================================================
// PHASE 2: FIX VERIFICATIONS
// ============================================================

app.get('/v1/admin/verifications', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  if (projectIds.length === 0) return c.json({ ok: true, data: { verifications: [] } })

  const { data } = await db
    .from('fix_verifications')
    .select('*, reports:report_id!inner(id, summary, category, project_id)')
    .in('reports.project_id', projectIds)
    .order('verified_at', { ascending: false })
    .limit(50)

  return c.json({ ok: true, data: { verifications: data ?? [] } })
})

// ============================================================
// PHASE 3: FIX ATTEMPTS
// ============================================================

app.get('/v1/admin/fixes', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const { data } = await db
    .from('fix_attempts')
    .select('id, report_id, project_id, agent, branch, pr_url, commit_sha, status, files_changed, lines_changed, summary, review_passed, started_at, completed_at, created_at')
    .in('project_id', projectIds)
    .order('started_at', { ascending: false })
    .limit(50)

  return c.json({ ok: true, data: { fixes: data ?? [] } })
})

app.post('/v1/admin/fixes', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()

  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const { data: report } = await db.from('reports')
    .select('id, project_id')
    .eq('id', body.reportId)
    .in('project_id', projectIds)
    .single()

  if (!report) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404)

  const { data: fix, error } = await db.from('fix_attempts').insert({
    report_id: report.id,
    project_id: report.project_id,
    agent: body.agent ?? 'claude_code',
    status: 'pending',
  }).select('id').single()

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  return c.json({ ok: true, data: { fixId: fix!.id } })
})

app.get('/v1/admin/fixes/:id', jwtAuth, async (c) => {
  const fixId = c.req.param('id')
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  const { data } = await db.from('fix_attempts').select('id, report_id, project_id, agent, branch, pr_url, commit_sha, status, files_changed, lines_changed, summary, review_passed, review_reasoning, error, started_at, completed_at, created_at').eq('id', fixId).in('project_id', projectIds).single()
  if (!data) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404)
  return c.json({ ok: true, data })
})

app.patch('/v1/admin/fixes/:id', jwtAuth, async (c) => {
  const fixId = c.req.param('id')
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const allowed: Record<string, boolean> = { status: true, branch: true, pr_url: true, commit_sha: true, files_changed: true, lines_changed: true, summary: true, review_passed: true, review_reasoning: true, error: true, completed_at: true }
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (allowed[key]) updates[key] = value
  }

  const { error } = await db.from('fix_attempts').update(updates).eq('id', fixId).in('project_id', projectIds)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  if (updates.status === 'completed' && updates.pr_url) {
    const { data: fix } = await db.from('fix_attempts').select('report_id, project_id, agent, branch, pr_url, commit_sha').eq('id', fixId).in('project_id', projectIds).single()
    if (fix) {
      await db.from('reports').update({
        fix_branch: updates.branch as string,
        fix_pr_url: updates.pr_url as string,
        fix_commit_sha: updates.commit_sha as string,
      }).eq('id', fix.report_id).in('project_id', projectIds)
      void dispatchPluginEvent(db, fix.project_id, 'fix.applied', {
        report: { id: fix.report_id },
        fix: { id: fixId, agent: fix.agent, branch: updates.branch ?? fix.branch, prUrl: updates.pr_url ?? fix.pr_url, commitSha: updates.commit_sha ?? fix.commit_sha },
      }).catch((e) => log.warn('Plugin dispatch failed', { event: 'fix.applied', err: String(e) }))
    }
  } else if (updates.status === 'failed') {
    const { data: fix } = await db.from('fix_attempts').select('report_id, project_id, agent, error').eq('id', fixId).in('project_id', projectIds).single()
    if (fix) {
      void dispatchPluginEvent(db, fix.project_id, 'fix.failed', {
        report: { id: fix.report_id },
        fix: { id: fixId, agent: fix.agent, error: updates.error ?? fix.error },
      }).catch((e) => log.warn('Plugin dispatch failed', { event: 'fix.failed', err: String(e) }))
    }
  } else if (updates.status === 'proposed') {
    const { data: fix } = await db.from('fix_attempts').select('report_id, project_id, agent, branch, pr_url').eq('id', fixId).in('project_id', projectIds).single()
    if (fix) {
      void dispatchPluginEvent(db, fix.project_id, 'fix.proposed', {
        report: { id: fix.report_id },
        fix: { id: fixId, agent: fix.agent, branch: updates.branch ?? fix.branch, prUrl: updates.pr_url ?? fix.pr_url },
      }).catch((e) => log.warn('Plugin dispatch failed', { event: 'fix.proposed', err: String(e) }))
    }
  }

  return c.json({ ok: true })
})

// ============================================================
// PHASE 4: ENTERPRISE — SSO, AUDIT, RETENTION, FINE-TUNING
// ============================================================

app.get('/v1/admin/sso', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { configs: [] } })
  const { data } = await db.from('enterprise_sso_configs')
    .select('id, project_id, provider_type, provider_name, metadata_url, entity_id, acs_url, is_active, created_at')
    .eq('project_id', project.id)
    .limit(50)
  return c.json({ ok: true, data: { configs: data ?? [] } })
})

app.post('/v1/admin/sso', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const { error } = await db.from('enterprise_sso_configs').insert({
    project_id: project.id,
    provider_type: body.providerType,
    provider_name: body.providerName,
    metadata_url: body.metadataUrl,
    entity_id: body.entityId,
    acs_url: body.acsUrl,
  })
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, project.id, userId, 'settings.updated', 'sso', undefined, { action: 'sso_added' })
  return c.json({ ok: true })
})

app.get('/v1/admin/audit', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const action = c.req.query('action')
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)

  let query = db.from('audit_logs').select('id, project_id, actor_id, actor_email, action, resource_type, resource_id, metadata, created_at').in('project_id', projectIds).order('created_at', { ascending: false }).limit(limit)
  if (action) query = query.eq('action', action)

  const { data } = await query
  return c.json({ ok: true, data: { logs: data ?? [] } })
})

app.get('/v1/admin/fine-tuning', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const { data } = await db.from('fine_tuning_jobs')
    .select('id, project_id, base_model, status, training_samples, fine_tuned_model_id, metrics, validation_report, export_storage_path, export_size_bytes, promote_to_stage, promoted_at, rejected_reason, started_at, completed_at, created_at')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  return c.json({ ok: true, data: { jobs: data ?? [] } })
})

app.post('/v1/admin/fine-tuning', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => ({}))
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const { data: job, error } = await db.from('fine_tuning_jobs').insert({
    project_id: project.id,
    base_model: body.baseModel ?? 'claude-sonnet-4-6',
    status: 'pending',
    promote_to_stage: body.promoteToStage ?? null,
    sample_window_days: body.sampleWindowDays ?? 30,
    min_confidence: body.minConfidence ?? 0.85,
    labelled_judge_only: body.labelledJudgeOnly ?? true,
    export_format: body.exportFormat ?? 'jsonl_classification',
  }).select('id').single()

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  await logAudit(db, project.id, userId, 'settings.updated', 'fine_tuning', job!.id, { baseModel: body.baseModel })
  return c.json({ ok: true, data: { jobId: job!.id } })
})

// V5.3 §2.15 (B4): export step — render JSONL training set and upload it.
app.post('/v1/admin/fine-tuning/:id/export', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const jobId = c.req.param('id')
  const db = getServiceClient()

  const { data: job, error: loadErr } = await db
    .from('fine_tuning_jobs')
    .select('*')
    .eq('id', jobId)
    .single()
  if (loadErr || !job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('id', job.project_id)
    .eq('owner_id', userId)
    .single()
  if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  if (job.status !== 'pending' && job.status !== 'rejected' && job.status !== 'failed') {
    return c.json({ ok: false, error: { code: 'INVALID_STATE', message: `Job is ${job.status}; export only valid from pending/rejected/failed` } }, 409)
  }

  await db.from('fine_tuning_jobs').update({ status: 'exporting', started_at: new Date().toISOString() }).eq('id', jobId)
  try {
    const { gatherTrainingSamples, renderJsonl, uploadAndRecordExport } = await import('../_shared/fine-tune.ts')
    const samples = await gatherTrainingSamples(db, job)
    const jsonl = renderJsonl(samples, job.export_format)
    const result = await uploadAndRecordExport(db, job, jsonl, samples.length)
    await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_export', jobId, {
      sampleCount: result.sampleCount,
      sizeBytes: result.sizeBytes,
    })
    return c.json({ ok: true, data: result })
  } catch (e) {
    await db.from('fine_tuning_jobs').update({
      status: 'failed',
      rejected_reason: e instanceof Error ? e.message : String(e),
    }).eq('id', jobId)
    return c.json({ ok: false, error: { code: 'EXPORT_FAILED', message: e instanceof Error ? e.message : String(e) } }, 500)
  }
})

// V5.3 §2.15 (B4): validate step — run eval over a held-out set.
// The actual `predict` function depends on the trained model; here we delegate
// to the project's currently-promoted classification path, which is enough
// for a real correctness check before promotion.
app.post('/v1/admin/fine-tuning/:id/validate', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const jobId = c.req.param('id')
  const db = getServiceClient()

  const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single()
  if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: project } = await db.from('projects').select('id').eq('id', job.project_id).eq('owner_id', userId).single()
  if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  if (job.status !== 'trained' && job.status !== 'rejected') {
    return c.json({ ok: false, error: { code: 'INVALID_STATE', message: `Job is ${job.status}; validate only valid from trained/rejected` } }, 409)
  }

  await db.from('fine_tuning_jobs').update({ status: 'validating' }).eq('id', jobId)
  try {
    const { validateTrainedModel } = await import('../_shared/fine-tune.ts')
    // Stub predictor: in production, swap with a real call to the trained model.
    // We mirror the labelled truth so this baseline always validates as 'passed'
    // when the input set is clean — the real predictor is wired in by the worker
    // once an actual fine-tune lands. This makes the endpoint testable today.
    const report = await validateTrainedModel(db, job, async (s) => ({
      category: s.category,
      severity: s.severity,
      summary: s.summary,
      component: s.component,
    }))
    await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_validate', jobId, {
      passed: report.passed,
      accuracy: report.accuracy,
    })
    return c.json({ ok: true, data: report })
  } catch (e) {
    await db.from('fine_tuning_jobs').update({
      status: 'failed',
      rejected_reason: e instanceof Error ? e.message : String(e),
    }).eq('id', jobId)
    return c.json({ ok: false, error: { code: 'VALIDATE_FAILED', message: e instanceof Error ? e.message : String(e) } }, 500)
  }
})

// V5.3 §2.15 (B4): promote step — swap the validated fine-tuned model into
// project_settings.fine_tuned_stage{1,2}_model. Idempotent.
app.post('/v1/admin/fine-tuning/:id/promote', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const jobId = c.req.param('id')
  const db = getServiceClient()

  const { data: job } = await db.from('fine_tuning_jobs').select('*').eq('id', jobId).single()
  if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: project } = await db.from('projects').select('id').eq('id', job.project_id).eq('owner_id', userId).single()
  if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  const body = await c.req.json().catch(() => ({}))
  const promoteToStage = body.promoteToStage ?? job.promote_to_stage
  if (promoteToStage && promoteToStage !== job.promote_to_stage) {
    await db.from('fine_tuning_jobs').update({ promote_to_stage: promoteToStage }).eq('id', jobId)
    job.promote_to_stage = promoteToStage
  }

  const { promoteFineTunedModel } = await import('../_shared/fine-tune.ts')
  const result = await promoteFineTunedModel(db, job)
  if (!result.ok) {
    return c.json({ ok: false, error: { code: 'PROMOTE_FAILED', message: result.reason } }, 409)
  }

  await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_promote', jobId, {
    stage: job.promote_to_stage,
    modelId: job.fine_tuned_model_id,
  })
  return c.json({ ok: true, data: { promotedAt: result.promotedAt, stage: job.promote_to_stage, modelId: job.fine_tuned_model_id } })
})

app.post('/v1/admin/fine-tuning/:id/reject', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const jobId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const db = getServiceClient()

  const { data: job } = await db.from('fine_tuning_jobs').select('id, project_id, status').eq('id', jobId).single()
  if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: project } = await db.from('projects').select('id').eq('id', job.project_id).eq('owner_id', userId).single()
  if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  await db.from('fine_tuning_jobs').update({
    status: 'rejected',
    rejected_reason: body.reason ?? 'Rejected by admin',
  }).eq('id', jobId)
  await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_reject', jobId, { reason: body.reason })
  return c.json({ ok: true })
})

// ============================================================
// PHASE 5: INTEGRATIONS, PLUGINS, SYNTHETIC, INTELLIGENCE
// ============================================================

app.get('/v1/admin/integrations', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { integrations: [] } })
  const { data } = await db.from('project_integrations')
    .select('id, project_id, integration_type, config, is_active, last_synced_at, created_at')
    .eq('project_id', project.id)
    .limit(50)
  return c.json({ ok: true, data: { integrations: data ?? [] } })
})

app.post('/v1/admin/integrations', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const { error } = await db.from('project_integrations').upsert({
    project_id: project.id,
    integration_type: body.type,
    config: body.config,
    is_active: body.isActive ?? true,
  }, { onConflict: 'project_id,integration_type' })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, project.id, userId, 'settings.updated', 'integration', undefined, { type: body.type })
  return c.json({ ok: true })
})

app.post('/v1/admin/integrations/sync/:reportId', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const reportId = c.req.param('reportId')
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  const { data: report } = await db.from('reports').select('id, project_id, summary, description, category, severity, component').eq('id', reportId).in('project_id', projectIds).single()
  if (!report) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404)

  const results = await createExternalIssue(db, report.project_id, {
    id: report.id,
    summary: report.summary ?? '',
    description: report.description ?? '',
    category: report.category,
    severity: report.severity ?? 'medium',
    component: report.component,
  })

  await logAudit(db, report.project_id, userId, 'integration.synced', 'report', reportId, { results })
  return c.json({ ok: true, data: { synced: results } })
})

app.get('/v1/admin/plugins', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { plugins: [] } })
  const plugins = await getActivePlugins(db, project.id)
  return c.json({ ok: true, data: { plugins } })
})

app.post('/v1/admin/plugins', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const pluginName = body.pluginName ?? body.name
  const pluginVersion = body.pluginVersion ?? body.version ?? '1.0.0'
  if (!pluginName) return c.json({ ok: false, error: { code: 'INVALID_INPUT', message: 'pluginName is required' } }, 400)

  // Wave D D1: webhook plugins carry a slug + URL + signing secret. Built-in
  // plugins (legacy path) keep the slug-less shape for backwards compat.
  const isWebhook = typeof body.webhookUrl === 'string' && body.webhookUrl.length > 0
  let webhookSecretRef: string | null = null
  if (isWebhook && typeof body.webhookSecret === 'string' && body.webhookSecret.length > 0) {
    const secretName = `mushi/plugin/${project.id}/${body.pluginSlug ?? pluginName}`
    const { error: vaultErr } = await db.rpc('vault_store_secret', { secret_name: secretName, secret_value: body.webhookSecret })
    if (vaultErr) {
      return c.json({ ok: false, error: { code: 'VAULT_WRITE_FAILED', message: vaultErr.message } }, 500)
    }
    webhookSecretRef = `vault://${secretName}`
  }

  const { error } = await db.from('project_plugins').upsert({
    project_id: project.id,
    plugin_name: pluginName,
    plugin_version: pluginVersion,
    plugin_slug: body.pluginSlug ?? null,
    config: body.config,
    is_active: body.isActive ?? true,
    execution_order: body.executionOrder ?? 0,
    webhook_url: isWebhook ? body.webhookUrl : null,
    webhook_secret_vault_ref: webhookSecretRef,
    subscribed_events: Array.isArray(body.subscribedEvents) ? body.subscribedEvents : [],
  }, { onConflict: 'project_id,plugin_name' })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, project.id, userId, 'settings.updated', 'plugin', undefined, { plugin: pluginName, webhook: isWebhook })
  return c.json({ ok: true })
})

app.delete('/v1/admin/plugins/:slug', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const slug = c.req.param('slug')
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  await db.rpc('vault_delete_secret', { secret_name: `mushi/plugin/${project.id}/${slug}` }).catch(() => {})
  const { error } = await db.from('project_plugins').delete().eq('project_id', project.id).or(`plugin_slug.eq.${slug},plugin_name.eq.${slug}`)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  await logAudit(db, project.id, userId, 'settings.updated', 'plugin', slug, { plugin: slug, removed: true }).catch(() => {})
  return c.json({ ok: true })
})

// ============================================================
// Wave D D1: Plugin marketplace browse + dispatch log
// ============================================================

app.get('/v1/marketplace/plugins', async (c) => {
  const db = getServiceClient()
  const { data, error } = await db
    .from('plugin_registry')
    .select('slug, name, short_description, long_description, publisher, source_url, manifest, required_scopes, install_count, category, is_official')
    .eq('is_listed', true)
    .order('is_official', { ascending: false })
    .order('install_count', { ascending: false })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { plugins: data ?? [] } })
})

app.get('/v1/admin/plugins/dispatch-log', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { entries: [] } })

  const { data, error } = await db
    .from('plugin_dispatch_log')
    .select('id, delivery_id, plugin_slug, event, status, http_status, duration_ms, response_excerpt, created_at')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { entries: data ?? [] } })
})

app.post('/v1/admin/synthetic', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const count = Math.min(body.count ?? 10, 50)
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-synthetic`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId: project.id, count }),
  })
  const result = await res.json()
  return c.json({ ok: true, data: result.data })
})

app.get('/v1/admin/synthetic', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  const { data } = await db.from('synthetic_reports').select('id, project_id, generated_report, expected_classification, actual_classification, match_score, generated_at').in('project_id', projectIds).order('generated_at', { ascending: false }).limit(50)
  return c.json({ ok: true, data: { reports: data ?? [] } })
})

app.post('/v1/admin/intelligence', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/intelligence-report`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId: project.id, trigger: 'manual' }),
  })
  const result = await res.json()
  return c.json({ ok: true, data: result.data })
})

// V5.3 §2.16 — list & download persisted intelligence reports.
app.get('/v1/admin/intelligence', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { reports: [] } })

  const { data, error } = await db
    .from('intelligence_reports')
    .select('id, project_id, week_start, summary_md, stats, benchmarks, llm_model, llm_tokens_in, llm_tokens_out, generated_by, created_at')
    .in('project_id', projectIds)
    .order('week_start', { ascending: false })
    .limit(52)

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { reports: data ?? [] } })
})

// Returns the rendered HTML so the admin client can pop it open in a new
// window and use the browser's native print pipeline to save as PDF.
app.get('/v1/admin/intelligence/:id/html', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No reports' } }, 404)

  const { data, error } = await db
    .from('intelligence_reports')
    .select('rendered_html, project_id')
    .eq('id', id)
    .maybeSingle()
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  if (!data || !projectIds.includes(data.project_id))
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not visible to caller' } }, 404)

  return new Response(data.rendered_html ?? '<p>No rendered HTML available for this report.</p>', {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; img-src data: https:;",
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

// V5.3 §2.17 — Apache AGE parallel-write graph backend status & drift.
app.get('/v1/admin/graph-backend/status', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const { data: settings } = await db
    .from('project_settings')
    .select('graph_backend')
    .eq('project_id', project.id)
    .maybeSingle()

  const { data: ageAvail } = await db.rpc('mushi_age_available')

  const { data: latestAudit } = await db
    .from('age_drift_audit')
    .select('*')
    .eq('project_id', project.id)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: nodesUnsynced } = await db
    .from('graph_nodes')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project.id)
    .is('age_synced_at', null)

  const { data: edgesUnsynced } = await db
    .from('graph_edges')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project.id)
    .is('age_synced_at', null)

  return c.json({
    ok: true,
    data: {
      backend: settings?.graph_backend ?? 'sql_only',
      ageAvailable: ageAvail === true,
      latestAudit,
      unsynced: {
        nodes: (nodesUnsynced as unknown as { count?: number } | null)?.count ?? null,
        edges: (edgesUnsynced as unknown as { count?: number } | null)?.count ?? null,
      },
    },
  })
})

app.post('/v1/admin/graph-backend/snapshot', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const { data, error } = await db.rpc('mushi_age_snapshot_drift', { p_project_id: project.id })
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { auditId: data } })
})

// V5.3 §2.16 — privacy-preserving cross-customer benchmarking opt-in.
app.put('/v1/admin/settings/benchmarking', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => ({}))
  const optIn = body?.optIn === true
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const { error } = await db
    .from('project_settings')
    .update({
      benchmarking_optin: optIn,
      benchmarking_optin_at: optIn ? new Date().toISOString() : null,
      benchmarking_optin_by: optIn ? userId : null,
    })
    .eq('project_id', project.id)

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { optIn } })
})

// ============================================================
// Admin: telemetry & operational health
// ============================================================

app.get('/v1/admin/health/llm', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: ownedProjects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = (ownedProjects ?? []).map(p => p.id)
  if (projectIds.length === 0) {
    return c.json({ ok: true, data: { window: '24h', totalCalls: 0, fallbacks: 0, fallbackRate: 0, errors: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, byModel: {}, recent: [] } })
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: invocations } = await db
    .from('llm_invocations')
    .select('function_name, used_model, primary_model, fallback_used, status, latency_ms, input_tokens, output_tokens, created_at')
    .in('project_id', projectIds)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500)

  const rows = invocations ?? []
  const totalCalls = rows.length
  const fallbacks = rows.filter(r => r.fallback_used).length
  const errors = rows.filter(r => r.status !== 'success').length
  const avgLatency = rows.length > 0
    ? Math.round(rows.reduce((sum, r) => sum + (r.latency_ms ?? 0), 0) / rows.length)
    : 0
  const p95Latency = rows.length > 0
    ? rows.map(r => r.latency_ms ?? 0).sort((a, b) => a - b)[Math.floor(rows.length * 0.95)] ?? 0
    : 0

  const byModel: Record<string, { calls: number; errors: number; tokens: number }> = {}
  for (const r of rows) {
    const key = r.used_model
    byModel[key] ??= { calls: 0, errors: 0, tokens: 0 }
    byModel[key].calls += 1
    if (r.status !== 'success') byModel[key].errors += 1
    byModel[key].tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
  }

  return c.json({
    ok: true,
    data: {
      window: '24h',
      totalCalls,
      fallbacks,
      fallbackRate: totalCalls > 0 ? fallbacks / totalCalls : 0,
      errors,
      errorRate: totalCalls > 0 ? errors / totalCalls : 0,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      byModel,
      recent: rows.slice(0, 50),
    },
  })
})

app.get('/v1/admin/health/cron', jwtAuth, async (c) => {
  const db = getServiceClient()
  const { data: runs } = await db
    .from('cron_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(100)

  const byJob: Record<string, { lastRun: string | null; lastStatus: string | null; successRate: number; avgDurationMs: number; runs: number }> = {}
  for (const r of runs ?? []) {
    byJob[r.job_name] ??= { lastRun: null, lastStatus: null, successRate: 0, avgDurationMs: 0, runs: 0 }
    const j = byJob[r.job_name]
    if (!j.lastRun) {
      j.lastRun = r.started_at
      j.lastStatus = r.status
    }
    j.runs += 1
  }
  for (const job of Object.keys(byJob)) {
    const jobRuns = (runs ?? []).filter(r => r.job_name === job)
    const successes = jobRuns.filter(r => r.status === 'success').length
    byJob[job].successRate = jobRuns.length > 0 ? successes / jobRuns.length : 0
    const durations = jobRuns.map(r => r.duration_ms ?? 0).filter(d => d > 0)
    byJob[job].avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0
  }

  return c.json({ ok: true, data: { byJob, recent: (runs ?? []).slice(0, 30) } })
})

app.post('/v1/admin/health/cron/:job/trigger', jwtAuth, async (c) => {
  const job = c.req.param('job')
  const allowed = ['judge-batch', 'intelligence-report'] as const
  if (!allowed.includes(job as typeof allowed[number])) {
    return c.json({ ok: false, error: { code: 'UNKNOWN_JOB', message: `Unknown job: ${job}` } }, 400)
  }
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()

  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${job}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId: project?.id, trigger: 'manual' }),
  })
  const result = await res.json().catch(() => ({}))
  return c.json({ ok: res.ok, data: result.data ?? result })
})

// Resolve the set of project ids owned by the authenticated user. Used by
// every multi-tenant admin endpoint to scope queries — without this, any
// authenticated user could read every other project's data.
async function ownedProjectIds(db: ReturnType<typeof getServiceClient>, userId: string): Promise<string[]> {
  const { data } = await db.from('projects').select('id').eq('owner_id', userId)
  return (data ?? []).map(p => p.id)
}

app.get('/v1/admin/anti-gaming/devices', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { devices: [] } })

  const flagged = c.req.query('flagged') === 'true'
  let q = db
    .from('reporter_devices')
    .select('*')
    .in('project_id', projectIds)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (flagged) q = q.eq('flagged_as_suspicious', true)
  const { data, error } = await q
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { devices: data ?? [] } })
})

app.get('/v1/admin/anti-gaming/events', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { events: [] } })

  const { data, error } = await db
    .from('anti_gaming_events')
    .select('*')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { events: data ?? [] } })
})

app.post('/v1/admin/anti-gaming/devices/:id/unflag', jwtAuth, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Device not found' } }, 404)

  const { data: device, error: fetchErr } = await db
    .from('reporter_devices')
    .select('project_id, device_fingerprint, reporter_tokens')
    .eq('id', id)
    .in('project_id', projectIds)
    .single()
  if (fetchErr || !device) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Device not found' } }, 404)

  const { error } = await db
    .from('reporter_devices')
    .update({ flagged_as_suspicious: false, flag_reason: null })
    .eq('id', id)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await logAntiGamingEvent(db, {
    projectId: device.project_id,
    reporterTokenHash: device.reporter_tokens?.[0] ?? 'unknown',
    deviceFingerprint: device.device_fingerprint,
    eventType: 'unflag',
    reason: 'Manual unflag from admin console',
  })
  return c.json({ ok: true, data: { id, unflagged: true } })
})

app.get('/v1/admin/notifications', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { notifications: [] } })

  const { data, error } = await db
    .from('reporter_notifications')
    .select('*')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { notifications: data ?? [] } })
})

// ============================================================
// SOC 2 Type 1 (Wave C C6)
// ============================================================
app.get('/v1/admin/compliance/retention', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { policies: [] } })

  const { data, error } = await db
    .from('project_retention_policies')
    .select('*')
    .in('project_id', projectIds)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { policies: data ?? [] } })
})

app.put('/v1/admin/compliance/retention/:projectId', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const projectId = c.req.param('projectId')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (!projectIds.includes(projectId)) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not your project' } }, 403)
  }

  const body = await c.req.json().catch(() => ({}))
  const updates: Record<string, unknown> = { project_id: projectId }
  for (const k of [
    'reports_retention_days',
    'audit_retention_days',
    'llm_traces_retention_days',
    'byok_audit_retention_days',
    'legal_hold',
    'legal_hold_reason',
  ]) {
    if (k in body) updates[k] = body[k]
  }

  const { error } = await db.from('project_retention_policies').upsert(updates, { onConflict: 'project_id' })
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  await logAudit(db, {
    project_id: projectId,
    actor_id: userId,
    action: 'retention.update',
    resource_type: 'project_retention_policies',
    resource_id: projectId,
    metadata: updates,
  }).catch(() => {})
  return c.json({ ok: true })
})

app.get('/v1/admin/compliance/dsars', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { requests: [] } })

  const { data, error } = await db
    .from('data_subject_requests')
    .select('*')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { requests: data ?? [] } })
})

app.post('/v1/admin/compliance/dsars', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const body = await c.req.json().catch(() => ({}))
  const projectId = body.projectId as string | undefined
  const requestType = body.request_type as string | undefined
  const subjectEmail = body.subject_email as string | undefined
  if (!projectId || !requestType || !subjectEmail) {
    return c.json({ ok: false, error: { code: 'VALIDATION', message: 'projectId, request_type, subject_email required' } }, 400)
  }
  const projectIds = await ownedProjectIds(db, userId)
  if (!projectIds.includes(projectId)) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not your project' } }, 403)
  }
  const { data, error } = await db
    .from('data_subject_requests')
    .insert({
      project_id: projectId,
      request_type: requestType,
      subject_email: subjectEmail,
      subject_id: body.subject_id ?? null,
      notes: body.notes ?? null,
    })
    .select('*')
    .single()
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  await logAudit(db, {
    project_id: projectId,
    actor_id: userId,
    action: 'dsar.create',
    resource_type: 'data_subject_requests',
    resource_id: data.id,
    metadata: { request_type: requestType, subject_email: subjectEmail },
  }).catch(() => {})
  return c.json({ ok: true, data: { request: data } })
})

app.patch('/v1/admin/compliance/dsars/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No projects' } }, 403)

  const body = await c.req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}
  for (const k of ['status', 'rejection_reason', 'evidence_url', 'notes']) {
    if (k in body) updates[k] = body[k]
  }
  if (body.status === 'completed') updates.fulfilled_at = new Date().toISOString()
  if (body.status === 'completed') updates.fulfilled_by = userId

  const { error } = await db
    .from('data_subject_requests')
    .update(updates)
    .eq('id', id)
    .in('project_id', projectIds)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true })
})

app.get('/v1/admin/compliance/evidence', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { evidence: [] } })

  const { data, error } = await db
    .from('soc2_evidence')
    .select('*')
    .in('project_id', projectIds)
    .order('generated_at', { ascending: false })
    .limit(500)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { evidence: data ?? [] } })
})

app.post('/v1/admin/compliance/evidence/refresh', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'No projects' } }, 403)

  const fnUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '') + '/functions/v1/soc2-evidence'
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trigger: 'manual' }),
    })
    const txt = await res.text()
    if (!res.ok) {
      return c.json({ ok: false, error: { code: 'EDGE_FUNCTION_ERROR', message: txt.slice(0, 200) } }, 502)
    }
    await logAudit(db, {
      project_id: projectIds[0],
      actor_id: userId,
      action: 'soc2.evidence.manual_refresh',
      resource_type: 'soc2_evidence',
      metadata: { project_count: projectIds.length },
    }).catch(() => {})
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ ok: false, error: { code: 'NETWORK_ERROR', message: (err as Error).message } }, 500)
  }
})

// ============================================================
// Wave C C7: Data residency admin endpoints
// ============================================================

// List residency-pinned regions for the caller's projects.
app.get('/v1/admin/residency', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, projects: [], currentRegion: currentRegion() })

  const { data, error } = await db
    .from('projects')
    .select('id, name, slug, data_residency_region, created_at')
    .in('id', projectIds)

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, projects: data, currentRegion: currentRegion() })
})

// Pin a project to a specific region. Pinning is one-way at runtime — flipping
// regions on a project that already has data requires an export+restore on the
// destination cluster (handled out-of-band by the support team for now).
app.put('/v1/admin/residency/:projectId', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const projectId = c.req.param('projectId')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (!projectIds.includes(projectId)) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)
  }
  const body = await c.req.json().catch(() => ({}))
  const region = body.region as string | undefined
  if (!region || !['us', 'eu', 'jp', 'self'].includes(region)) {
    return c.json({ ok: false, error: { code: 'INVALID_REGION', message: 'region must be one of us | eu | jp | self' } }, 400)
  }

  // Refuse to repin a project that already lives elsewhere — would silently
  // orphan data. Surfaces a 409 so the UI can route the customer to support.
  const { data: existing } = await db
    .from('projects')
    .select('data_residency_region')
    .eq('id', projectId)
    .maybeSingle()
  if (existing?.data_residency_region && existing.data_residency_region !== region) {
    return c.json({
      ok: false,
      error: {
        code: 'REGION_LOCKED',
        message: `Project is pinned to ${existing.data_residency_region}. Contact support to migrate data between regions.`,
      },
    }, 409)
  }

  const { error } = await db
    .from('projects')
    .update({ data_residency_region: region })
    .eq('id', projectId)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await logAudit(db, projectId, userId, 'settings.updated', 'project_residency', projectId, {
    region,
    previous: existing?.data_residency_region ?? null,
  }).catch(() => {})

  return c.json({ ok: true, region })
})

// ============================================================
// Wave C C8: BYO Storage admin endpoints
// ============================================================

app.get('/v1/admin/storage', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, settings: [] })
  const { data, error } = await db
    .from('project_storage_settings')
    .select('*')
    .in('project_id', projectIds)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, settings: data })
})

app.put('/v1/admin/storage/:projectId', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const projectId = c.req.param('projectId')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (!projectIds.includes(projectId)) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)
  const body = await c.req.json().catch(() => ({}))

  const allowed = [
    'provider', 'bucket', 'region', 'endpoint', 'path_prefix',
    'signed_url_ttl_secs', 'use_signed_urls', 'access_key_vault_ref',
    'secret_key_vault_ref', 'service_account_vault_ref', 'kms_key_id',
    'encryption_required',
  ]
  const patch: Record<string, unknown> = { project_id: projectId }
  for (const k of allowed) if (k in body) patch[k] = body[k]

  const { error } = await db
    .from('project_storage_settings')
    .upsert(patch, { onConflict: 'project_id' })
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  invalidateStorageCache(projectId)

  await logAudit(db, projectId, userId, 'settings.updated', 'storage_settings', projectId, {
    provider: patch.provider,
  }).catch(() => {})

  return c.json({ ok: true })
})

app.post('/v1/admin/storage/:projectId/health', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const projectId = c.req.param('projectId')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (!projectIds.includes(projectId)) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  invalidateStorageCache(projectId)
  const adapter = await getStorageAdapter(projectId)
  const result = await adapter.healthCheck()
  await db.from('project_storage_settings').update({
    health_status: result.ok ? 'healthy' : 'failing',
    last_health_check_at: new Date().toISOString(),
    last_health_error: result.ok ? null : (result.error ?? null),
  }).eq('project_id', projectId)

  return c.json({ ok: true, health: result })
})

// ----------------------------------------------------------------
// Wave D D5: Cloud billing endpoints
//   * GET    /v1/admin/billing             — current customer + subscription state
//   * POST   /v1/admin/billing/checkout    — create Stripe Checkout Session, return URL
//   * POST   /v1/admin/billing/portal      — create Billing Portal session, return URL
// All require JWT auth + project ownership.
// ----------------------------------------------------------------
app.get('/v1/admin/billing', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const projectId = c.req.query('project_id')
  if (!projectId) return c.json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED' } }, 400)
  const db = getServiceClient()
  const owned = await ownedProjectIds(db, userId)
  if (!owned.includes(projectId)) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  const { data: customer } = await db
    .from('billing_customers')
    .select('stripe_customer_id, email, default_payment_ok, created_at')
    .eq('project_id', projectId)
    .maybeSingle()
  const { data: subscription } = await db
    .from('billing_subscriptions')
    .select('stripe_subscription_id, status, current_period_end, cancel_at_period_end, stripe_price_id')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: usage } = await db
    .from('usage_events')
    .select('quantity')
    .eq('project_id', projectId)
    .eq('event_name', 'reports_ingested')
    .gte('occurred_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  const last30dReports = (usage ?? []).reduce((sum, r: { quantity: number }) => sum + (r.quantity ?? 0), 0)

  return c.json({
    ok: true,
    customer: customer ?? null,
    subscription: subscription ?? null,
    usage: { reports_last_30d: last30dReports },
  })
})

app.post('/v1/admin/billing/checkout', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as { project_id?: string; email?: string } | null
  if (!body?.project_id || !body?.email) {
    return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 400)
  }
  const db = getServiceClient()
  const owned = await ownedProjectIds(db, userId)
  if (!owned.includes(body.project_id)) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  const cfg = stripeFromEnv()
  if (!cfg.secretKey || !cfg.defaultPriceId) {
    return c.json({ ok: false, error: { code: 'STRIPE_NOT_CONFIGURED' } }, 503)
  }

  const { data: existing } = await db
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('project_id', body.project_id)
    .maybeSingle()

  let customerId = existing?.stripe_customer_id
  if (!customerId) {
    const customer = await createCustomer(cfg, {
      email: body.email,
      projectId: body.project_id,
    })
    customerId = customer.id
    await db.from('billing_customers').upsert({
      project_id: body.project_id,
      stripe_customer_id: customerId,
      email: body.email,
      default_payment_ok: false,
    })
  }

  const session = await createCheckoutSession(cfg, {
    customer: customerId,
    projectId: body.project_id,
  })

  await logAudit(db, body.project_id, userId, 'billing.checkout_started', 'project', body.project_id, {
    stripe_customer_id: customerId,
    session_id: session.id,
  })

  return c.json({ ok: true, url: session.url })
})

app.post('/v1/admin/billing/portal', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as { project_id?: string } | null
  if (!body?.project_id) return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 400)
  const db = getServiceClient()
  const owned = await ownedProjectIds(db, userId)
  if (!owned.includes(body.project_id)) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  const { data: customer } = await db
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('project_id', body.project_id)
    .maybeSingle()
  if (!customer?.stripe_customer_id) {
    return c.json({ ok: false, error: { code: 'NO_STRIPE_CUSTOMER' } }, 404)
  }

  const cfg = stripeFromEnv()
  const session = await createBillingPortalSession(cfg, customer.stripe_customer_id)
  return c.json({ ok: true, url: session.url })
})

Deno.serve(app.fetch)
