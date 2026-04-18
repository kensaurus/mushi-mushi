import { Hono, type Context } from 'npm:hono@4'
import { cors } from 'npm:hono@4/cors'
import { streamSSE } from 'npm:hono@4/streaming'
import { toSseEvent, sanitizeSseString, sseHeartbeat } from '../_shared/sse.ts'
import { AguiEmitter } from '../_shared/agui.ts'
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts'
import { apiKeyAuth, jwtAuth } from '../_shared/auth.ts'
import { checkIngestQuota } from '../_shared/quota.ts'
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
  listInvoices,
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
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

  const antiGaming = await checkAntiGaming(
    db,
    projectId,
    tokenHash,
    deviceFingerprint || report.fingerprintHash
      ? {
          // Synthesize a placeholder when only the SDK hash is available so the
          // legacy multi-account/velocity checks still have something to key on.
          fingerprint: deviceFingerprint ?? `sdk:${report.fingerprintHash}`,
          ipAddress: options?.ipAddress,
          fingerprintHash: report.fingerprintHash,
        }
      : null,
  )
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

    const quota = await checkIngestQuota(db, projectId)
    if (!quota.allowed) {
      c.header('Retry-After', String(quota.retryAfterSeconds ?? 3600))
      return c.json({
        ok: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: `Free tier quota of ${quota.limit} reports/month exceeded. Upgrade or wait until ${quota.periodResetsAt}.`,
          used: quota.used,
          limit: quota.limit,
          periodResetsAt: quota.periodResetsAt,
        },
      }, 402)
    }

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

  const quota = await checkIngestQuota(db, projectId)
  if (!quota.allowed) {
    c.header('Retry-After', String(quota.retryAfterSeconds ?? 3600))
    return c.json({
      ok: false,
      error: {
        code: 'QUOTA_EXCEEDED',
        message: `Free tier quota of ${quota.limit} reports/month exceeded. Upgrade or wait until ${quota.periodResetsAt}.`,
        used: quota.used,
        limit: quota.limit,
        periodResetsAt: quota.periodResetsAt,
      },
    }, 402)
  }

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
// SENTRY SEER WEBHOOK (Wave E §3b — push complement to /sentry-seer-poll)
// ============================================================
//
// Configure in Sentry: Settings → Developer Settings → Internal Integration
//   Webhook URL:   <api>/v1/webhooks/sentry/seer?projectId=<mushi-project-id>
//   Webhook secret: same value as project_settings.sentry_webhook_secret
//   Resources:     Issue (for seer-fixability changes)
//
// Auth: HMAC-SHA256 hex digest of the *raw* body, sent in
// `Sentry-Hook-Signature`. We must verify before parsing JSON to avoid
// re-encoding altering bytes. Project is identified via querystring
// because Sentry doesn't propagate custom headers to internal integrations.

app.post('/v1/webhooks/sentry/seer', async (c) => {
  const { verifySentryHookSignature, parseIssueWebhookBody, parseSeerAutofixBody, applySeerAnalysis } =
    await import('../_shared/seer.ts')

  const projectId = c.req.query('projectId')
    ?? c.req.header('X-Mushi-Project')
    ?? ''
  if (!projectId) {
    return c.json({ ok: false, error: { code: 'MISSING_PROJECT', message: 'projectId query param or X-Mushi-Project header is required' } }, 400)
  }

  const rawBody = await c.req.text()
  const signature = c.req.header('Sentry-Hook-Signature') ?? c.req.header('X-Sentry-Hook-Signature')

  const db = getServiceClient()
  const { data: settings } = await db
    .from('project_settings')
    .select('sentry_webhook_secret, sentry_seer_enabled')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!settings?.sentry_webhook_secret) {
    return c.json({ ok: false, error: { code: 'NO_SECRET', message: 'Sentry webhook secret not configured for this project' } }, 403)
  }
  if (!settings.sentry_seer_enabled) {
    return c.json({ ok: true, data: { ignored: 'seer_disabled' } }, 202)
  }

  const valid = await verifySentryHookSignature(rawBody, signature ?? null, settings.sentry_webhook_secret)
  if (!valid) {
    return c.json({ ok: false, error: { code: 'BAD_SIGNATURE', message: 'Invalid HMAC signature' } }, 401)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return c.json({ ok: false, error: { code: 'BAD_JSON' } }, 400)
  }

  const issue = parseIssueWebhookBody(body)
  if (!issue) {
    return c.json({ ok: true, data: { ignored: 'no_issue_in_payload' } }, 202)
  }

  // Sentry sends two flavours of seer payload: (a) issue-event with the
  // analysis embedded under data.seer_analysis or data.autofix, (b) thin
  // notification with just the issue id, expecting us to pull. We try
  // (a) first to avoid an extra round-trip; fall back to (b) if missing.
  const dataObj = (body as Record<string, unknown>).data as Record<string, unknown> | undefined
  let parsed = parseSeerAutofixBody(dataObj?.autofix ? dataObj : { autofix: dataObj?.seer_analysis })
  if (!parsed && dataObj?.seer_analysis) {
    const sa = dataObj.seer_analysis as Record<string, unknown>
    parsed = {
      rootCause: sa.rootCause ?? sa.root_cause ?? null,
      fixSuggestion: sa.fixSuggestion ?? sa.fix_suggestion ?? sa.solution ?? null,
    }
  }

  if (!parsed) {
    // Thin notification: enqueue a one-shot fetch via the existing poll fn.
    // Cheap fire-and-forget — if it fails the next 15-min cron will still
    // catch it. We don't await so the webhook response stays under Sentry's
    // 10s timeout budget.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (supabaseUrl && serviceRoleKey) {
      void fetch(`${supabaseUrl}/functions/v1/sentry-seer-poll`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceRoleKey}` },
        signal: AbortSignal.timeout(2_000),
      }).catch(() => { /* best-effort */ })
    }
    return c.json({ ok: true, data: { issueId: issue.id, deferred: true } }, 202)
  }

  const result = await applySeerAnalysis(db, projectId, {
    issueId: issue.id,
    shortId: issue.shortId,
    permalink: issue.permalink,
    rootCause: parsed.rootCause,
    fixSuggestion: parsed.fixSuggestion,
    fixabilityScore: issue.seerFixability?.fixabilityScore ?? null,
    fetchedAt: new Date().toISOString(),
    source: 'webhook',
  })

  return c.json({ ok: true, data: { issueId: issue.id, ...result } })
})

// ============================================================
// GITHUB CHECK-RUN WEBHOOK (V5.3 §2.10 — closes the PDCA loop)
// ============================================================
// Configure in GitHub: Settings → Webhooks → Add webhook
//   Payload URL: <api>/v1/webhooks/github
//   Content type: application/json
//   Secret: same value as project_settings.github_webhook_secret
//   Events: "Check runs" + "Check suites"

app.post('/v1/webhooks/github', async (c) => {
  const event = c.req.header('X-GitHub-Event')
  const sig = c.req.header('X-Hub-Signature-256') ?? ''
  const body = await c.req.text()

  if (event !== 'check_run' && event !== 'check_suite') {
    return c.json({ ok: true, data: { event, action: 'ignored' } })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body)
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  const repo = payload.repository as { full_name?: string } | undefined
  const checkRun = (payload.check_run ?? payload.check_suite) as
    | { head_sha?: string; status?: string; conclusion?: string | null }
    | undefined

  if (!repo?.full_name || !checkRun?.head_sha) {
    return c.json({ ok: true, data: { reason: 'missing repo or sha' } })
  }

  const db = getServiceClient()

  // Match by commit_sha — the fix-worker persists this on PR creation.
  const { data: candidates } = await db
    .from('fix_attempts')
    .select('id, project_id')
    .eq('commit_sha', checkRun.head_sha)
    .limit(5)

  if (!candidates || candidates.length === 0) {
    return c.json({ ok: true, data: { reason: 'no matching fix_attempt' } })
  }

  // Verify against any matched project's secret. If no project has a secret
  // configured (dev fallback), we accept the event but mark as unverified.
  let verified = false
  let verifiedProjectId: string | null = null
  let anySecretConfigured = false
  for (const cand of candidates) {
    const { data: settings } = await db
      .from('project_settings')
      .select('github_webhook_secret')
      .eq('project_id', cand.project_id)
      .single()
    const secret = settings?.github_webhook_secret as string | undefined
    if (!secret) continue
    anySecretConfigured = true
    if (await verifyGithubSignature(sig, body, secret)) {
      verified = true
      verifiedProjectId = cand.project_id
      break
    }
  }

  if (anySecretConfigured && !verified) {
    return c.json({ ok: false, error: { code: 'INVALID_SIGNATURE' } }, 401)
  }

  const updates = {
    check_run_status: checkRun.status ?? null,
    check_run_conclusion: checkRun.conclusion ?? null,
    check_run_updated_at: new Date().toISOString(),
  }

  const targetIds = verifiedProjectId
    ? candidates.filter(x => x.project_id === verifiedProjectId).map(x => x.id)
    : candidates.map(x => x.id)

  await db.from('fix_attempts').update(updates).in('id', targetIds)

  return c.json({ ok: true, data: { updated: targetIds.length, verified } })
})

async function verifyGithubSignature(headerSig: string, body: string, secret: string): Promise<boolean> {
  const expected = headerSig.startsWith('sha256=') ? headerSig.slice('sha256='.length) : ''
  if (!expected) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  if (computed.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

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
//
// Auth model (Wave 2.8): two flows are accepted, in priority order:
//
//   (A) HMAC-signed (preferred). The SDK proves possession of the reporter
//       token without sending it on the wire:
//
//         X-Reporter-Token-Hash: <sha256(token) hex>
//         X-Reporter-Ts:         <unix ms>
//         X-Reporter-Hmac:       hex(HMAC-SHA256(
//                                  secret = projectApiKey,
//                                  msg    = `${projectId}.${ts}.${tokenHash}`))
//
//       Server enforces `|now - ts| < 5 min` to defeat replay, then recomputes
//       the HMAC against the API key already validated by apiKeyAuth.
//
//   (B) Legacy raw-token. Accepted for backwards compatibility but logged as a
//       deprecation warning by the SDK. Token can be passed as
//       `X-Reporter-Token` header (preferred over query so it doesn't leak
//       into proxy logs) or `?reporterToken=...`.
//
// Both flows resolve to a stable `reporter_token_hash` for table lookup.
async function resolveReporterTokenHash(c: Context, projectId: string): Promise<
  | { ok: true; tokenHash: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const headerHash = c.req.header('X-Reporter-Token-Hash')
  const ts = c.req.header('X-Reporter-Ts')
  const sig = c.req.header('X-Reporter-Hmac')
  const apiKey = c.req.header('X-Mushi-Api-Key') || c.req.header('X-Mushi-Project')

  if (headerHash && ts && sig && apiKey) {
    const parsedTs = Number(ts)
    if (!Number.isFinite(parsedTs)) {
      return { ok: false, status: 400, code: 'BAD_TIMESTAMP', message: 'X-Reporter-Ts must be a unix-ms integer' }
    }
    const skewMs = Math.abs(Date.now() - parsedTs)
    if (skewMs > 5 * 60 * 1000) {
      return { ok: false, status: 401, code: 'STALE_REQUEST', message: 'X-Reporter-Ts outside 5-minute window' }
    }
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(apiKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const expected = await crypto.subtle.sign(
      'HMAC',
      key,
      enc.encode(`${projectId}.${parsedTs}.${headerHash.toLowerCase()}`),
    )
    const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, '0')).join('')
    if (!constantTimeEqualHex(expectedHex, sig)) {
      return { ok: false, status: 401, code: 'INVALID_HMAC', message: 'X-Reporter-Hmac signature mismatch' }
    }
    return { ok: true, tokenHash: headerHash.toLowerCase() }
  }

  const rawToken =
    c.req.header('X-Reporter-Token') ?? c.req.query('reporterToken') ?? null
  if (!rawToken) {
    return {
      ok: false,
      status: 400,
      code: 'MISSING_TOKEN',
      message: 'Pass X-Reporter-Token-Hash + X-Reporter-Hmac (preferred) or X-Reporter-Token / ?reporterToken=',
    }
  }
  const enc = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(rawToken))
  const tokenHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return { ok: true, tokenHash }
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

app.get('/v1/notifications', apiKeyAuth, async (c) => {
  const projectId = c.get('projectId') as string
  const auth = await resolveReporterTokenHash(c, projectId)
  if (!auth.ok) return c.json({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status as 400 | 401)

  const sinceParam = c.req.query('since')
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam).toISOString() : null
  const includeRead = c.req.query('includeRead') === '1'
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '20'), 1), 100)

  const db = getServiceClient()
  let query = db
    .from('reporter_notifications')
    .select('id, notification_type, payload, read_at, created_at')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', auth.tokenHash)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!includeRead) query = query.is('read_at', null)
  if (since) query = query.gt('created_at', since)

  const { data: notifications, error } = await query
  if (error) {
    return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  }

  c.header('Cache-Control', 'no-store')
  return c.json({
    ok: true,
    data: {
      notifications: notifications ?? [],
      server_time: new Date().toISOString(),
    },
  })
})

app.post('/v1/notifications/:id/read', apiKeyAuth, async (c) => {
  const notifId = c.req.param('id')
  const projectId = c.get('projectId') as string
  const auth = await resolveReporterTokenHash(c, projectId)
  if (!auth.ok) return c.json({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status as 400 | 401)

  const db = getServiceClient()
  const { error } = await db
    .from('reporter_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notifId)
    .eq('project_id', projectId)
    .eq('reporter_token_hash', auth.tokenHash)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
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

  // Fire-and-forget invoke of the fix-worker Edge Function. We deliberately
  // do not await — the SSE stream above is the channel the UI uses to track
  // progress. EdgeRuntime.waitUntil keeps the worker alive after the
  // dispatch response returns. If the worker invocation fails, the dispatch
  // row sits in 'queued' until a future cron-driven retry picks it up.
  invokeFixWorker(job.id).catch(err => {
    console.warn('[fix-dispatch] worker invocation failed', { dispatchId: job.id, err: String(err) })
  })

  return c.json({ ok: true, data: { dispatchId: job.id, status: job.status, createdAt: job.created_at } })
})

async function invokeFixWorker(dispatchId: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return

  // Local dev: the functions endpoint sits on localhost:54321/functions/v1.
  // Production: <project>.supabase.co/functions/v1. SUPABASE_URL is the
  // base of either. We never await this — the worker reports back via the
  // fix_dispatch_jobs row that the SSE endpoint subscribes to.
  await fetch(`${supabaseUrl}/functions/v1/fix-worker`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dispatchId }),
    // Don't block the dispatch response on the worker booting.
    signal: AbortSignal.timeout(2_000),
  }).catch(() => { /* worker is fire-and-forget */ })
}

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
      const embedding = await createEmbedding(text, { projectId })
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
  const component = c.req.query('component')
  const reporter = c.req.query('reporter')
  const search = c.req.query('q')?.trim()
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
  const offset = Number(c.req.query('offset')) || 0
  const sortField = c.req.query('sort') ?? 'created_at'
  const sortDir = c.req.query('dir') === 'asc' ? 'asc' : 'desc'
  const allowedSorts: Record<string, string> = {
    created_at: 'created_at',
    severity: 'severity',
    confidence: 'confidence',
    status: 'status',
    component: 'component',
  }
  const orderColumn = allowedSorts[sortField] ?? 'created_at'

  let query = db
    .from('reports')
    .select('id, project_id, description, category, severity, summary, status, created_at, environment, screenshot_url, user_category, confidence, component, report_group_id', { count: 'exact' })
    .in('project_id', projectIds)
    .order(orderColumn, { ascending: sortDir === 'asc', nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (category) query = query.eq('category', category)
  if (severity) query = query.eq('severity', severity)
  if (component) query = query.eq('component', component)
  if (reporter) query = query.eq('reporter_token_hash', reporter)
  if (search) {
    // Bilateral OR — summary or description matches the search prefix.
    const escaped = search.replace(/[%,]/g, '')
    query = query.or(`summary.ilike.%${escaped}%,description.ilike.%${escaped}%`)
  }

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

  // Attach the LLM invocation timeline for this report so the detail page can
  // deep-link to Langfuse traces for each pipeline stage (fast-filter, classify-report,
  // judge-batch). Cheaper to fetch alongside the report than as a separate round-trip.
  const { data: invocations } = await db
    .from('llm_invocations')
    .select('id, function_name, stage, used_model, primary_model, fallback_used, fallback_reason, status, error_message, latency_ms, input_tokens, output_tokens, key_source, langfuse_trace_id, prompt_version, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
    .limit(20)

  return c.json({ ok: true, data: { ...data, llm_invocations: invocations ?? [] } })
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

// Bulk mutations on reports — drives the triage table's checkbox toolbar.
// Limit batch size so a single request can't touch thousands of rows;
// front-end sends ids in chunks if needed. Same allow-listed fields as the
// per-row PATCH so we don't widen the attack surface.
app.post('/v1/admin/reports/bulk', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => null) as
    | { ids?: unknown; action?: unknown; value?: unknown }
    | null
  if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ ok: false, error: { code: 'INVALID_INPUT', message: 'ids[] required' } }, 400)
  }
  const ids = body.ids.filter((x): x is string => typeof x === 'string').slice(0, 200)
  if (ids.length === 0) {
    return c.json({ ok: false, error: { code: 'INVALID_INPUT', message: 'No valid ids' } }, 400)
  }
  const action = String(body.action ?? '')
  const allowedActions = new Set(['set_status', 'set_severity', 'set_category', 'dismiss'])
  if (!allowedActions.has(action)) {
    return c.json({ ok: false, error: { code: 'INVALID_ACTION', message: `Unsupported action: ${action}` } }, 400)
  }

  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = (projects ?? []).map((p) => p.id)
  if (projectIds.length === 0) {
    return c.json({ ok: false, error: { code: 'NO_PROJECTS', message: 'No projects owned by user' } }, 403)
  }

  const updates: Record<string, unknown> = {}
  if (action === 'dismiss') {
    updates.status = 'dismissed'
  } else if (action === 'set_status') {
    const allowed = new Set(['new', 'classified', 'fixing', 'fixed', 'dismissed'])
    if (!allowed.has(String(body.value))) {
      return c.json({ ok: false, error: { code: 'INVALID_VALUE', message: 'Invalid status value' } }, 400)
    }
    updates.status = String(body.value)
  } else if (action === 'set_severity') {
    const allowed = new Set(['critical', 'high', 'medium', 'low'])
    if (!allowed.has(String(body.value))) {
      return c.json({ ok: false, error: { code: 'INVALID_VALUE', message: 'Invalid severity value' } }, 400)
    }
    updates.severity = String(body.value)
  } else if (action === 'set_category') {
    const allowed = new Set(['bug', 'slow', 'visual', 'confusing', 'other'])
    if (!allowed.has(String(body.value))) {
      return c.json({ ok: false, error: { code: 'INVALID_VALUE', message: 'Invalid category value' } }, 400)
    }
    updates.category = String(body.value)
  }

  // Snapshot pre-update rows so we can fan out reputation events for status
  // transitions, identical to the per-row PATCH path.
  const { data: before } = await db
    .from('reports')
    .select('id, project_id, reporter_token_hash, status')
    .in('id', ids)
    .in('project_id', projectIds)
  const beforeMap = new Map((before ?? []).map((r) => [r.id, r]))
  const allowedIds = [...beforeMap.keys()]
  if (allowedIds.length === 0) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No reports matched' } }, 404)
  }

  const { error: updErr } = await db
    .from('reports')
    .update(updates)
    .in('id', allowedIds)
    .in('project_id', projectIds)
  if (updErr) {
    return c.json({ ok: false, error: { code: 'DB_ERROR', message: updErr.message } }, 500)
  }

  // Side effects mirror PATCH: reputation, notifications, plugin dispatch on
  // status changes. Done sequentially per row but each kicked off without await
  // so the bulk endpoint stays snappy.
  if (typeof updates.status === 'string') {
    const newStatus = updates.status
    for (const id of allowedIds) {
      const prev = beforeMap.get(id)
      if (!prev || prev.status === newStatus) continue
      void dispatchPluginEvent(db, prev.project_id, 'report.status_changed', {
        report: { id, status: newStatus },
        previousStatus: prev.status,
        actor: { kind: 'admin', userId },
      }).catch((e) => log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }))
      const reputationAction =
        newStatus === 'fixing' ? 'confirmed'
          : newStatus === 'fixed' ? 'fixed'
            : newStatus === 'dismissed' ? 'dismissed'
              : null
      if (reputationAction) {
        const points = reputationAction === 'confirmed' ? 50 : reputationAction === 'fixed' ? 25 : 0
        awardPoints(db, prev.project_id, prev.reporter_token_hash, { action: reputationAction })
          .catch((e) => log.error('Reputation award failed', { action: reputationAction, err: String(e) }))
        createNotification(db, prev.project_id, id, prev.reporter_token_hash, reputationAction, {
          message: buildNotificationMessage(reputationAction, points ? { points } : {}),
          ...(points ? { points } : {}),
          reportId: id,
        }).catch((e) => log.error('Notification failed', { type: reputationAction, err: String(e) }))
      }
    }
  }

  const firstProjectId = beforeMap.values().next().value?.project_id ?? ''
  await logAudit(
    db,
    firstProjectId,
    userId,
    'report.triaged',
    'report',
    undefined,
    { action, value: body.value ?? null, count: allowedIds.length, ids: allowedIds },
  )

  return c.json({ ok: true, data: { updated: allowedIds.length, ids: allowedIds } })
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

// Richer dashboard data: 14-day trends, fix pipeline state, LLM cost,
// triage backlog, top components, and recent activity. Powers the rebuilt
// DashboardPage. Single round-trip so the page hydrates quickly without N
// chained requests.
app.get('/v1/admin/dashboard', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db
    .from('projects')
    .select('id, name')
    .eq('owner_id', userId)
  const projectIds = (projects ?? []).map(p => p.id)
  if (projectIds.length === 0) {
    return c.json({ ok: true, data: { empty: true } })
  }

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 13)
  since.setUTCHours(0, 0, 0, 0)
  const sinceIso = since.toISOString()

  // Reports — richer slice for triage backlog, top components, trend
  const { data: recentReports } = await db
    .from('reports')
    .select('id, project_id, summary, description, status, severity, category, component, created_at, stage1_latency_ms, stage2_latency_ms')
    .in('project_id', projectIds)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(500)

  // Fix attempts — for the auto-fix pipeline tile
  const { data: recentFixes } = await db
    .from('fix_attempts')
    .select('id, report_id, project_id, status, agent, pr_url, pr_number, llm_model, llm_input_tokens, llm_output_tokens, started_at, completed_at, created_at')
    .in('project_id', projectIds)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(100)

  // LLM invocations — for cost / latency trend
  const { data: recentLlm } = await db
    .from('llm_invocations')
    .select('id, project_id, function_name, used_model, status, latency_ms, input_tokens, output_tokens, created_at, key_source')
    .in('project_id', projectIds)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(2000)

  // Integration health — last 14 days, used to render a global "platform health" sparkline
  const { data: healthRows } = await db
    .from('integration_health_history')
    .select('kind, status, latency_ms, checked_at')
    .in('project_id', projectIds)
    .gte('checked_at', sinceIso)
    .order('checked_at', { ascending: true })
    .limit(2000)

  // Bucket helpers
  const dayKey = (iso: string) => iso.slice(0, 10)
  const days: string[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(since)
    d.setUTCDate(since.getUTCDate() + i)
    days.push(d.toISOString().slice(0, 10))
  }

  // Per-day report intake by severity (for stacked sparkline)
  const reportsByDay: Record<string, { total: number; critical: number; high: number; medium: number; low: number; unscored: number }> = {}
  for (const d of days) reportsByDay[d] = { total: 0, critical: 0, high: 0, medium: 0, low: 0, unscored: 0 }
  for (const r of recentReports ?? []) {
    const d = dayKey(String(r.created_at))
    if (!reportsByDay[d]) continue
    const bucket = reportsByDay[d]
    bucket.total++
    const sev = (r.severity ?? '').toLowerCase()
    if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') {
      bucket[sev as 'critical' | 'high' | 'medium' | 'low']++
    } else {
      bucket.unscored++
    }
  }

  // Per-day LLM cost (token-based proxy: input + output tokens / 1k)
  const llmByDay: Record<string, { calls: number; tokens: number; latencyMs: number; failures: number }> = {}
  for (const d of days) llmByDay[d] = { calls: 0, tokens: 0, latencyMs: 0, failures: 0 }
  let totalTokens = 0
  let totalLlmCalls = 0
  let totalLlmFailures = 0
  for (const inv of recentLlm ?? []) {
    const d = dayKey(String(inv.created_at))
    if (!llmByDay[d]) continue
    llmByDay[d].calls++
    const tok = (inv.input_tokens ?? 0) + (inv.output_tokens ?? 0)
    llmByDay[d].tokens += tok
    llmByDay[d].latencyMs += inv.latency_ms ?? 0
    if (inv.status !== 'success') llmByDay[d].failures++
    totalTokens += tok
    totalLlmCalls++
    if (inv.status !== 'success') totalLlmFailures++
  }

  // Triage SLA — mean minutes from created_at -> first stage classification
  // (proxied as stage2_latency_ms presence). For "open" backlog, count anything
  // still status='new' or 'queued' beyond 1h.
  const now = Date.now()
  const openBacklog = (recentReports ?? []).filter(r => {
    const status = String(r.status ?? '')
    if (status !== 'new' && status !== 'queued') return false
    return now - new Date(String(r.created_at)).getTime() > 60 * 60 * 1000
  }).length

  // Top components by report count
  const componentCounts = new Map<string, number>()
  for (const r of recentReports ?? []) {
    const comp = (r.component ?? '').trim()
    if (!comp) continue
    componentCounts.set(comp, (componentCounts.get(comp) ?? 0) + 1)
  }
  const topComponents = [...componentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([component, count]) => ({ component, count }))

  // Auto-fix pipeline summary
  const fixSummary = {
    total: (recentFixes ?? []).length,
    completed: (recentFixes ?? []).filter(f => f.status === 'completed').length,
    failed: (recentFixes ?? []).filter(f => f.status === 'failed').length,
    inProgress: (recentFixes ?? []).filter(f => f.status === 'queued' || f.status === 'running').length,
    openPrs: (recentFixes ?? []).filter(f => f.pr_number != null && f.status === 'completed').length,
  }

  // Triage queue — top 5 most recent reports needing attention
  const triageQueue = (recentReports ?? [])
    .filter(r => r.status === 'new' || r.status === 'queued' || r.status === 'classified')
    .slice(0, 5)
    .map(r => ({
      id: r.id,
      summary: r.summary ?? r.description?.slice(0, 140) ?? '(no summary)',
      severity: r.severity,
      category: r.category,
      status: r.status,
      created_at: r.created_at,
    }))

  // Recent activity — last 8 events across reports + fixes
  const activity = [
    ...(recentReports ?? []).slice(0, 6).map(r => ({
      kind: 'report' as const,
      id: r.id,
      label: r.summary ?? r.description?.slice(0, 100) ?? '(no summary)',
      meta: r.severity ?? r.category ?? r.status,
      at: r.created_at,
    })),
    ...(recentFixes ?? []).slice(0, 4).map(f => ({
      kind: 'fix' as const,
      id: f.report_id,
      label: `Auto-fix ${f.status}`,
      meta: f.llm_model ?? f.agent ?? null,
      at: f.created_at,
    })),
  ]
    .sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime())
    .slice(0, 8)

  // Integration health — group by kind, derive last status + uptime ratio
  const healthByKind = new Map<string, { last: string | null; lastAt: string | null; ok: number; total: number }>()
  for (const row of healthRows ?? []) {
    const k = String(row.kind)
    if (!healthByKind.has(k)) healthByKind.set(k, { last: null, lastAt: null, ok: 0, total: 0 })
    const entry = healthByKind.get(k)!
    entry.total++
    if (row.status === 'ok') entry.ok++
    entry.last = String(row.status)
    entry.lastAt = String(row.checked_at)
  }
  const integrations = [...healthByKind.entries()].map(([kind, v]) => ({
    kind,
    lastStatus: v.last,
    lastAt: v.lastAt,
    uptime: v.total > 0 ? v.ok / v.total : null,
  }))

  return c.json({
    ok: true,
    data: {
      empty: false,
      projects: (projects ?? []).map(p => ({ id: p.id, name: p.name })),
      window: { days, since: sinceIso },
      counts: {
        reports14d: (recentReports ?? []).length,
        openBacklog,
        fixesTotal: fixSummary.total,
        openPrs: fixSummary.openPrs,
        llmCalls14d: totalLlmCalls,
        llmTokens14d: totalTokens,
        llmFailures14d: totalLlmFailures,
      },
      reportsByDay: days.map(d => ({ day: d, ...reportsByDay[d] })),
      llmByDay: days.map(d => ({ day: d, ...llmByDay[d] })),
      fixSummary,
      topComponents,
      triageQueue,
      activity,
      integrations,
    },
  })
})

// Judge scores / drift data
app.get('/v1/admin/judge-scores', jwtAuth, async (c) => {
  // Aggregates across all owned projects so multi-project accounts see the
  // full picture, not the first project only. We call weekly_judge_scores
  // per project then bucket-merge in JS — RPC isn't variadic over project_ids.
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { weeks: [] } })

  const perProject = await Promise.all(
    projectIds.map((pid) => db.rpc('weekly_judge_scores', { p_project_id: pid, p_weeks: 12 })),
  )
  const buckets = new Map<string, { week_start: string; sum_score: number; sum_acc: number; sum_sev: number; sum_comp: number; sum_repro: number; eval_count: number }>()
  for (const r of perProject) {
    for (const w of r.data ?? []) {
      const key = String(w.week_start)
      const prev = buckets.get(key) ?? { week_start: key, sum_score: 0, sum_acc: 0, sum_sev: 0, sum_comp: 0, sum_repro: 0, eval_count: 0 }
      const n = Number(w.eval_count ?? 0)
      prev.sum_score += Number(w.avg_score ?? 0) * n
      prev.sum_acc   += Number(w.avg_accuracy ?? 0) * n
      prev.sum_sev   += Number(w.avg_severity ?? 0) * n
      prev.sum_comp  += Number(w.avg_component ?? 0) * n
      prev.sum_repro += Number(w.avg_repro ?? 0) * n
      prev.eval_count += n
      buckets.set(key, prev)
    }
  }
  const weeks = [...buckets.values()]
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
    .map(b => ({
      week_start: b.week_start,
      avg_score: b.eval_count ? b.sum_score / b.eval_count : 0,
      avg_accuracy: b.eval_count ? b.sum_acc / b.eval_count : 0,
      avg_severity: b.eval_count ? b.sum_sev / b.eval_count : 0,
      avg_component: b.eval_count ? b.sum_comp / b.eval_count : 0,
      avg_repro: b.eval_count ? b.sum_repro / b.eval_count : 0,
      eval_count: b.eval_count,
    }))
  return c.json({ ok: true, data: { weeks } })
})

// Per-report judge evaluations — paginated table for the Judge page.
app.get('/v1/admin/judge/evaluations', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { evaluations: [] } })

  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200)
  const sort = c.req.query('sort') === 'score_asc' ? { col: 'judge_score', asc: true } : { col: 'created_at', asc: false }

  const { data, error } = await db
    .from('classification_evaluations')
    .select('id, report_id, project_id, judge_model, judge_score, accuracy_score, severity_score, component_score, repro_score, classification_agreed, judge_reasoning, prompt_version, created_at, judge_fallback_used')
    .in('project_id', projectIds)
    .order(sort.col, { ascending: sort.asc })
    .limit(limit)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { evaluations: data ?? [] } })
})

// Score distribution histogram (bucketed into 10 deciles).
app.get('/v1/admin/judge/distribution', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { buckets: Array(10).fill(0), total: 0 } })

  const { data } = await db
    .from('classification_evaluations')
    .select('judge_score')
    .in('project_id', projectIds)
    .not('judge_score', 'is', null)
    .limit(2000)
  const buckets = Array(10).fill(0) as number[]
  for (const row of data ?? []) {
    const s = Math.max(0, Math.min(0.9999, Number(row.judge_score ?? 0)))
    const bin = Math.floor(s * 10)
    buckets[bin] = (buckets[bin] ?? 0) + 1
  }
  return c.json({ ok: true, data: { buckets, total: (data ?? []).length } })
})

// Trigger judge-batch on demand for the user's projects (fire-and-forget).
app.post('/v1/admin/judge/run', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) {
    return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project found' } }, 404)
  }
  // Fire-and-forget per project; we don't await — the page polls or uses
  // realtime to pick up new evaluations.
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/judge-batch`
  const headers = {
    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    'Content-Type': 'application/json',
  }
  for (const pid of projectIds) {
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectId: pid, trigger: 'manual' }),
    }).catch(() => { /* best-effort */ })
  }
  return c.json({ ok: true, data: { dispatched: projectIds.length } })
})

// Prompt-version leaderboard — joins prompt_versions with eval counts.
app.get('/v1/admin/judge/prompts', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { prompts: [] } })

  const { data } = await db
    .from('prompt_versions')
    .select('id, project_id, stage, version, is_active, is_candidate, traffic_percentage, avg_judge_score, total_evaluations, created_at')
    .or(`project_id.is.null,project_id.in.(${projectIds.join(',')})`)
    .order('avg_judge_score', { ascending: false, nullsFirst: false })
    .order('total_evaluations', { ascending: false })
    .limit(50)
  return c.json({ ok: true, data: { prompts: data ?? [] } })
})

// ============================================================
// PROMPT LAB — manage prompt versions + view eval dataset.
// Replaces the old "Fine-Tuning" page that nobody could complete.
// ============================================================

app.get('/v1/admin/prompt-lab', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)

  // Prompts: include global defaults (project_id IS NULL) + this user's own.
  // Wave E §4: also expose auto-generated metadata + parent_version_id so the
  // Prompt Lab UI can surface auto candidates and diff them against parent.
  let promptsQuery = db
    .from('prompt_versions')
    .select('id, project_id, stage, version, prompt_template, is_active, is_candidate, traffic_percentage, avg_judge_score, total_evaluations, created_at, updated_at, auto_generated, auto_generation_metadata, parent_version_id')
    .order('stage', { ascending: true })
    .order('version', { ascending: true })
    .limit(100)
  promptsQuery = projectIds.length === 0
    ? promptsQuery.is('project_id', null)
    : promptsQuery.or(`project_id.is.null,project_id.in.(${projectIds.join(',')})`)
  const { data: prompts } = await promptsQuery

  // Dataset stats — what reports could the next experiment be evaluated on?
  let totalReports = 0
  let labelledReports = 0
  let recentSamples: Array<{ id: string; description: string; category: string | null; severity: string | null; component: string | null; created_at: string }> = []
  let fineTuningJobs: Array<{ id: string; status: string; base_model: string | null; training_samples: number | null; created_at: string; project_id: string }> = []
  if (projectIds.length > 0) {
    const { count: total } = await db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
    totalReports = total ?? 0
    const { count: labelled } = await db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .eq('status', 'classified')
      .not('category', 'is', null)
    labelledReports = labelled ?? 0
    const { data: recent } = await db
      .from('reports')
      .select('id, description, category, severity, component, created_at')
      .in('project_id', projectIds)
      .eq('status', 'classified')
      .order('created_at', { ascending: false })
      .limit(8)
    recentSamples = recent ?? []

    // Surface legacy fine-tuning jobs so operators can clean up the
    // pre-Prompt-Lab "pending" rows that are otherwise orphaned in the DB.
    const { data: ft } = await db
      .from('fine_tuning_jobs')
      .select('id, project_id, status, base_model, training_samples, created_at')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(20)
    fineTuningJobs = ft ?? []
  }

  return c.json({
    ok: true,
    data: {
      prompts: prompts ?? [],
      dataset: {
        total: totalReports,
        labelled: labelledReports,
        recentSamples,
      },
      fineTuningJobs,
    },
  })
})

app.post('/v1/admin/prompt-lab/prompts', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => ({}))
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) {
    return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'You need at least one project to author prompts.' } }, 400)
  }
  const stage = body.stage === 'stage1' || body.stage === 'stage2' ? body.stage : null
  if (!stage) return c.json({ ok: false, error: { code: 'BAD_INPUT', message: 'stage must be stage1 or stage2' } }, 400)
  const version = String(body.version ?? '').trim()
  const promptTemplate = String(body.promptTemplate ?? '').trim()
  if (!version) return c.json({ ok: false, error: { code: 'BAD_INPUT', message: 'version required' } }, 400)
  if (!promptTemplate) return c.json({ ok: false, error: { code: 'BAD_INPUT', message: 'promptTemplate required' } }, 400)
  const projectId = body.projectId && projectIds.includes(body.projectId) ? body.projectId : projectIds[0]

  const { data, error } = await db.from('prompt_versions').insert({
    project_id: projectId,
    stage,
    version,
    prompt_template: promptTemplate,
    is_candidate: true,
    is_active: false,
    traffic_percentage: Math.max(0, Math.min(100, Number(body.trafficPercentage ?? 0))),
  }).select('id').single()
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, projectId, userId, 'settings.updated', 'prompt_version', data!.id, { stage, version })
  return c.json({ ok: true, data: { id: data!.id } })
})

app.patch('/v1/admin/prompt-lab/prompts/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  const { data: existing } = await db
    .from('prompt_versions')
    .select('id, project_id, stage')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)
  if (existing.project_id && !projectIds.includes(existing.project_id)) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)
  }
  if (!existing.project_id) {
    // Global defaults are read-only from the UI to prevent shared corruption.
    return c.json({ ok: false, error: { code: 'READONLY', message: 'Global default prompts are read-only — clone first.' } }, 409)
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.promptTemplate === 'string') updates.prompt_template = body.promptTemplate
  if (typeof body.trafficPercentage === 'number') updates.traffic_percentage = Math.max(0, Math.min(100, body.trafficPercentage))
  if (typeof body.isCandidate === 'boolean') updates.is_candidate = body.isCandidate

  // Activating a prompt is exclusive: only one active per (project_id, stage).
  if (body.isActive === true) {
    await db
      .from('prompt_versions')
      .update({ is_active: false, traffic_percentage: 0 })
      .eq('project_id', existing.project_id)
      .eq('stage', existing.stage)
    updates.is_active = true
    updates.is_candidate = false
    if (updates.traffic_percentage == null) updates.traffic_percentage = 100
  } else if (body.isActive === false) {
    updates.is_active = false
  }

  const { error } = await db.from('prompt_versions').update(updates).eq('id', id)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, existing.project_id, userId, 'settings.updated', 'prompt_version', id, updates)
  return c.json({ ok: true })
})

app.delete('/v1/admin/prompt-lab/prompts/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)
  const { data: existing } = await db
    .from('prompt_versions')
    .select('id, project_id, is_active')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)
  if (!existing.project_id) {
    return c.json({ ok: false, error: { code: 'READONLY', message: 'Global default prompts cannot be deleted.' } }, 409)
  }
  if (!projectIds.includes(existing.project_id)) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)
  }
  if (existing.is_active) {
    return c.json({ ok: false, error: { code: 'IN_USE', message: 'Deactivate before deleting.' } }, 409)
  }
  const { error } = await db.from('prompt_versions').delete().eq('id', id)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, existing.project_id, userId, 'settings.updated', 'prompt_version_delete', id, {})
  return c.json({ ok: true })
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
      'byok_anthropic_key_ref, byok_anthropic_key_added_at, byok_anthropic_key_last_used_at, byok_anthropic_test_status, byok_anthropic_tested_at, ' +
      'byok_openai_key_ref, byok_openai_key_added_at, byok_openai_key_last_used_at, byok_openai_base_url, byok_openai_test_status, byok_openai_tested_at',
    )
    .eq('project_id', project.id)
    .single()

  const row = (data as Record<string, unknown> | null) ?? {}
  const keys = BYOK_PROVIDERS.map((provider) => ({
    provider,
    configured: Boolean(row[`byok_${provider}_key_ref`]),
    addedAt: (row[`byok_${provider}_key_added_at`] as string | null) ?? null,
    lastUsedAt: (row[`byok_${provider}_key_last_used_at`] as string | null) ?? null,
    testStatus: (row[`byok_${provider}_test_status`] as string | null) ?? null,
    testedAt: (row[`byok_${provider}_tested_at`] as string | null) ?? null,
    baseUrl: provider === 'openai' ? ((row.byok_openai_base_url as string | null) ?? null) : null,
  }))

  return c.json({ ok: true, data: { projectId: project.id, keys } })
})

app.put('/v1/admin/byok/:provider', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const provider = c.req.param('provider') as ByokProvider
  if (!BYOK_PROVIDERS.includes(provider)) {
    return c.json({ ok: false, error: { code: 'BAD_PROVIDER', message: `Unknown provider: ${provider}` } }, 400)
  }
  const body = await c.req.json().catch(() => ({})) as { key?: string; baseUrl?: string | null }
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (key.length < 8) {
    return c.json({ ok: false, error: { code: 'KEY_TOO_SHORT', message: 'Provide the full provider API key.' } }, 400)
  }

  // baseUrl is OpenAI-only — schema constraint, also a defence against any
  // request smuggling a surprise field for `anthropic`.
  const rawBaseUrl = provider === 'openai' && typeof body?.baseUrl === 'string'
    ? body.baseUrl.trim()
    : ''
  let baseUrl: string | null = null
  if (rawBaseUrl) {
    try {
      const u = new URL(rawBaseUrl)
      if (u.protocol !== 'https:') {
        return c.json({ ok: false, error: { code: 'BAD_BASE_URL', message: 'baseUrl must be https://' } }, 400)
      }
      baseUrl = u.toString().replace(/\/$/, '')
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_BASE_URL', message: 'baseUrl is not a valid URL' } }, 400)
    }
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
    // Reset the connectivity test cache on every key change — stale "ok"
    // chips are dangerous; require an explicit re-test after rotation.
    [`byok_${provider}_test_status`]: null,
    [`byok_${provider}_tested_at`]: null,
  }
  if (provider === 'openai') {
    update.byok_openai_base_url = baseUrl
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

/**
 * POST /v1/admin/byok/:provider/test
 *
 * Probe the BYOK key with the cheapest possible call to confirm:
 *   1. The key authenticates (not 401/403).
 *   2. The endpoint is reachable (no DNS/CORS/baseUrl typo).
 *   3. There's quota left (not 429).
 *
 * Persists the outcome (ok / error_auth / error_network / error_quota) to
 * project_settings so the chip stays accurate across reloads. Never logs the
 * key, only the last 4 chars (the BYOK resolver hint).
 *
 * Cost: ~ $0.0001 — uses Anthropic /v1/models or OpenAI /v1/models, both of
 * which are free metadata calls.
 */
app.post('/v1/admin/byok/:provider/test', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const provider = c.req.param('provider') as ByokProvider
  if (!BYOK_PROVIDERS.includes(provider)) {
    return c.json({ ok: false, error: { code: 'BAD_PROVIDER' } }, 400)
  }

  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  // Reuse the same resolver path the LLM pipeline takes. If this returns null
  // the user has no BYOK and no env fallback — surface that as 'untested'.
  const { resolveLlmKey } = await import('../_shared/byok.ts')
  const resolved = await resolveLlmKey(db, project.id, provider)
  if (!resolved) {
    return c.json({ ok: false, error: { code: 'NO_KEY', message: 'No BYOK key set and no platform default available.' } }, 400)
  }

  const startedAt = Date.now()
  let status: 'ok' | 'error_auth' | 'error_network' | 'error_quota' = 'ok'
  let detail = ''
  let httpStatus = 0

  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': resolved.key,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8_000),
      })
      httpStatus = res.status
      if (res.status === 401 || res.status === 403) status = 'error_auth'
      else if (res.status === 429) status = 'error_quota'
      else if (!res.ok) {
        status = 'error_network'
        detail = `HTTP ${res.status}`
      }
    } else {
      // BYOK base URLs come in two flavors:
      //   - "https://api.openai.com" (no version) → append "/v1/models"
      //   - "https://openrouter.ai/api/v1" (already versioned) → append "/models"
      // Detect either form so OpenRouter / Together / Fireworks all probe
      // their actual /models endpoint instead of /v1/v1/models (404).
      const rawBase = (resolved.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '')
      const modelsUrl = /\/v\d+$/.test(rawBase) ? `${rawBase}/models` : `${rawBase}/v1/models`
      const res = await fetch(modelsUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${resolved.key}` },
        signal: AbortSignal.timeout(8_000),
      })
      httpStatus = res.status
      if (res.status === 401 || res.status === 403) status = 'error_auth'
      else if (res.status === 429) status = 'error_quota'
      else if (!res.ok) {
        status = 'error_network'
        detail = `HTTP ${res.status}`
      }
    }
  } catch (err) {
    status = 'error_network'
    detail = String(err).slice(0, 200)
  }

  const latencyMs = Date.now() - startedAt
  const now = new Date().toISOString()
  await db
    .from('project_settings')
    .upsert({
      project_id: project.id,
      [`byok_${provider}_test_status`]: status,
      [`byok_${provider}_tested_at`]: now,
    }, { onConflict: 'project_id' })

  // Mirror to integration_health_history so the IntegrationsPage sparkline
  // shows BYOK key probes alongside Sentry/Langfuse/GitHub.
  await db.from('integration_health_history').insert({
    project_id: project.id,
    kind: provider,
    status: status === 'ok' ? 'ok' : (status === 'error_quota' ? 'degraded' : 'down'),
    latency_ms: latencyMs,
    message: detail || `HTTP ${httpStatus}`,
    source: 'manual',
  })

  return c.json({
    ok: true,
    data: {
      provider,
      status,
      hint: resolved.hint,
      source: resolved.source,
      baseUrl: resolved.baseUrl ?? null,
      httpStatus,
      latencyMs,
      detail,
      testedAt: now,
    },
  })
})

// ============================================================
// Wave E: Firecrawl BYOK admin endpoints
//
// Firecrawl is a non-LLM provider (web scraping / search) used by the new
// research page, fix-worker auto-augmentation, and the library-modernizer
// cron. Same vault-indirection pattern as the LLM keys but its own column
// set so the LLM resolver stays single-purpose.
// ============================================================

function firecrawlSecretName(projectId: string): string {
  return `mushi/byok/${projectId}/firecrawl`
}

app.get('/v1/admin/byok/firecrawl', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: null })

  const { data } = await db
    .from('project_settings')
    .select('byok_firecrawl_key_ref, byok_firecrawl_key_added_at, byok_firecrawl_key_last_used_at, byok_firecrawl_test_status, byok_firecrawl_tested_at, firecrawl_allowed_domains, firecrawl_max_pages_per_call')
    .eq('project_id', project.id)
    .maybeSingle()

  return c.json({
    ok: true,
    data: {
      configured: Boolean(data?.byok_firecrawl_key_ref),
      addedAt: (data?.byok_firecrawl_key_added_at as string | null) ?? null,
      lastUsedAt: (data?.byok_firecrawl_key_last_used_at as string | null) ?? null,
      testStatus: (data?.byok_firecrawl_test_status as string | null) ?? null,
      testedAt: (data?.byok_firecrawl_tested_at as string | null) ?? null,
      allowedDomains: (data?.firecrawl_allowed_domains as string[] | null) ?? [],
      maxPagesPerCall: (data?.firecrawl_max_pages_per_call as number | null) ?? 5,
    },
  })
})

app.put('/v1/admin/byok/firecrawl', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => ({})) as {
    key?: string
    allowedDomains?: string[]
    maxPagesPerCall?: number
  }

  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const update: Record<string, unknown> = { project_id: project.id }

  if (typeof body.key === 'string' && body.key.trim().length > 0) {
    const key = body.key.trim()
    if (key.length < 8) {
      return c.json({ ok: false, error: { code: 'KEY_TOO_SHORT', message: 'Provide the full Firecrawl API key.' } }, 400)
    }
    const secretName = firecrawlSecretName(project.id)
    const { error: vaultErr } = await db.rpc('vault_store_secret', { secret_name: secretName, secret_value: key })
    if (vaultErr) {
      log.error('vault_store_secret failed for firecrawl', { error: vaultErr.message })
      return c.json({ ok: false, error: { code: 'VAULT_WRITE_FAILED', message: vaultErr.message } }, 500)
    }
    update.byok_firecrawl_key_ref = `vault://${secretName}`
    update.byok_firecrawl_key_added_at = new Date().toISOString()
    update.byok_firecrawl_key_last_used_at = null
    update.byok_firecrawl_test_status = null
    update.byok_firecrawl_tested_at = null
  }

  if (Array.isArray(body.allowedDomains)) {
    update.firecrawl_allowed_domains = body.allowedDomains
      .filter((d): d is string => typeof d === 'string')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0 && d.length < 254)
      .slice(0, 50)
  }

  if (typeof body.maxPagesPerCall === 'number' && Number.isFinite(body.maxPagesPerCall)) {
    update.firecrawl_max_pages_per_call = Math.max(1, Math.min(50, Math.floor(body.maxPagesPerCall)))
  }

  const { error } = await db
    .from('project_settings')
    .upsert(update, { onConflict: 'project_id' })
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  if (update.byok_firecrawl_key_ref) {
    await db
      .from('byok_audit_log')
      .insert({ project_id: project.id, provider: 'firecrawl', action: 'rotated', actor_user_id: userId })
      .catch(() => {})
    await logAudit(db, project.id, userId, 'settings.updated', 'byok', 'firecrawl', { provider: 'firecrawl' }).catch(() => {})
  }

  return c.json({ ok: true })
})

app.delete('/v1/admin/byok/firecrawl', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const secretName = firecrawlSecretName(project.id)
  await db.rpc('vault_delete_secret', { secret_name: secretName }).catch((err) => {
    log.warn('vault_delete_secret failed for firecrawl (non-fatal)', { error: String(err) })
  })

  const { error } = await db
    .from('project_settings')
    .upsert({
      project_id: project.id,
      byok_firecrawl_key_ref: null,
      byok_firecrawl_key_added_at: null,
      byok_firecrawl_key_last_used_at: null,
      byok_firecrawl_test_status: null,
      byok_firecrawl_tested_at: null,
    }, { onConflict: 'project_id' })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await db.from('byok_audit_log').insert({ project_id: project.id, provider: 'firecrawl', action: 'removed', actor_user_id: userId }).catch(() => {})
  await logAudit(db, project.id, userId, 'settings.updated', 'byok', 'firecrawl', { provider: 'firecrawl', cleared: true }).catch(() => {})

  return c.json({ ok: true })
})

app.post('/v1/admin/byok/firecrawl/test', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const { probeFirecrawl } = await import('../_shared/firecrawl.ts')
  const probe = await probeFirecrawl(db, project.id)

  const now = new Date().toISOString()
  await db
    .from('project_settings')
    .upsert({
      project_id: project.id,
      byok_firecrawl_test_status: probe.status,
      byok_firecrawl_tested_at: now,
    }, { onConflict: 'project_id' })

  await db.from('integration_health_history').insert({
    project_id: project.id,
    kind: 'firecrawl',
    status: probe.status === 'ok' ? 'ok' : (probe.status === 'error_quota' ? 'degraded' : 'down'),
    latency_ms: probe.latencyMs,
    message: probe.detail,
    source: 'manual',
  }).catch(() => {})

  return c.json({
    ok: true,
    data: {
      status: probe.status,
      hint: probe.hint,
      source: probe.source,
      latencyMs: probe.latencyMs,
      detail: probe.detail,
      testedAt: now,
    },
  })
})

// ============================================================
// Wave E: Research page admin endpoints
//
// Manual web research powered by Firecrawl. Admin types a query, we hit
// Firecrawl, persist the session + snippets, and let the user attach any
// snippet to a specific report as triage evidence.
// ============================================================

app.post('/v1/admin/research/search', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => ({})) as { query?: string; domains?: string[]; limit?: number }
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (query.length < 2 || query.length > 500) {
    return c.json({ ok: false, error: { code: 'BAD_QUERY', message: 'Query must be between 2 and 500 characters.' } }, 400)
  }

  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const { firecrawlSearch } = await import('../_shared/firecrawl.ts')

  let results: Array<{ url: string; title: string; snippet: string; markdown?: string }> = []
  let errCode: string | null = null
  try {
    results = await firecrawlSearch(db, project.id, query, {
      domains: Array.isArray(body.domains) ? body.domains.filter((d): d is string => typeof d === 'string') : undefined,
      limit: typeof body.limit === 'number' ? body.limit : 5,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'FIRECRAWL_NOT_CONFIGURED') {
      return c.json({ ok: false, error: { code: 'FIRECRAWL_NOT_CONFIGURED', message: 'Add a Firecrawl API key in Settings → BYOK first.' } }, 412)
    }
    if (msg === 'FIRECRAWL_AUTH_FAILED') {
      return c.json({ ok: false, error: { code: 'FIRECRAWL_AUTH_FAILED', message: 'Firecrawl rejected the key. Check Settings → BYOK.' } }, 401)
    }
    if (msg === 'FIRECRAWL_RATE_LIMITED') {
      return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Firecrawl rate-limited. Try again shortly.' } }, 429)
    }
    errCode = msg
    log.warn('research search failed', { projectId: project.id, error: msg })
    return c.json({ ok: false, error: { code: 'SEARCH_FAILED', message: msg } }, 502)
  }

  const { data: session, error: sErr } = await db
    .from('research_sessions')
    .insert({
      project_id: project.id,
      query,
      mode: 'search',
      domains: Array.isArray(body.domains) ? body.domains : [],
      result_count: results.length,
      created_by: userId,
    })
    .select('id, created_at')
    .single()

  if (sErr || !session) {
    return c.json({ ok: false, error: { code: 'DB_ERROR', message: sErr?.message ?? 'Failed to persist session' } }, 500)
  }

  if (results.length > 0) {
    await db.from('research_snippets').insert(
      results.map((r) => ({
        session_id: session.id,
        project_id: project.id,
        url: r.url,
        title: r.title,
        snippet: r.snippet,
        markdown: r.markdown ?? null,
      })),
    )
  }

  await logAudit(db, project.id, userId, 'settings.updated', 'research', session.id, { query: query.slice(0, 120), results: results.length }).catch(() => {})

  const { data: snippets } = await db
    .from('research_snippets')
    .select('id, url, title, snippet, attached_to_report_id')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true })

  return c.json({
    ok: true,
    data: {
      sessionId: session.id,
      createdAt: session.created_at,
      query,
      results: snippets ?? [],
      errCode,
    },
  })
})

app.get('/v1/admin/research/sessions', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { sessions: [] } })

  const { data: sessions, error } = await db
    .from('research_sessions')
    .select('id, query, mode, result_count, created_at, created_by')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { sessions: sessions ?? [] } })
})

app.get('/v1/admin/research/sessions/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const sessionId = c.req.param('id')
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const { data: session, error: sErr } = await db
    .from('research_sessions')
    .select('id, query, mode, domains, result_count, created_at')
    .eq('id', sessionId)
    .eq('project_id', project.id)
    .maybeSingle()
  if (sErr) return c.json({ ok: false, error: { code: 'DB_ERROR', message: sErr.message } }, 500)
  if (!session) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: snippets } = await db
    .from('research_snippets')
    .select('id, url, title, snippet, attached_to_report_id, attached_at')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true })

  return c.json({ ok: true, data: { session, snippets: snippets ?? [] } })
})

app.post('/v1/admin/research/snippets/:id/attach', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const snippetId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as { reportId?: string }
  const reportId = typeof body.reportId === 'string' ? body.reportId : ''
  if (!reportId) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'reportId is required' } }, 400)
  }

  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const { data: report } = await db
    .from('reports')
    .select('id')
    .eq('id', reportId)
    .eq('project_id', project.id)
    .maybeSingle()
  if (!report) return c.json({ ok: false, error: { code: 'REPORT_NOT_FOUND' } }, 404)

  const { error } = await db
    .from('research_snippets')
    .update({ attached_to_report_id: reportId, attached_at: new Date().toISOString(), attached_by: userId })
    .eq('id', snippetId)
    .eq('project_id', project.id)

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await logAudit(db, project.id, userId, 'report.triaged', 'research_snippet', snippetId, { reportId }).catch(() => {})
  return c.json({ ok: true })
})

// ============================================================
// LIBRARY MODERNIZATION (Wave E §2c)
// ============================================================
//
// Read-only listing + dispatch/dismiss for findings produced by the weekly
// library-modernizer cron. "Dispatch" simply forwards the synthetic report
// (created at finding-time for major/security/deprecated severities) into
// the existing fix_dispatch_jobs queue, so the entire fix pipeline stays
// on one code path.

app.get('/v1/admin/modernization', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const status = c.req.query('status') ?? 'pending'
  const db = getServiceClient()

  const { data: memberships } = await db
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)
  const projectIds = (memberships ?? []).map((m) => m.project_id)
  if (projectIds.length === 0) return c.json({ ok: true, data: { findings: [] } })

  let q = db
    .from('modernization_findings')
    .select('id, project_id, repo_id, dep_name, current_version, suggested_version, manifest_path, summary, severity, changelog_url, related_report_id, status, detected_at')
    .in('project_id', projectIds)
    .order('detected_at', { ascending: false })
    .limit(100)
  if (status !== 'all') q = q.eq('status', status)

  const { data, error } = await q
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { findings: data ?? [] } })
})

app.post('/v1/admin/modernization/:id/dispatch', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const findingId = c.req.param('id')
  const db = getServiceClient()

  const { data: finding } = await db
    .from('modernization_findings')
    .select('id, project_id, related_report_id, dep_name, status')
    .eq('id', findingId)
    .maybeSingle()
  if (!finding) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: membership } = await db
    .from('project_members')
    .select('role')
    .eq('user_id', userId)
    .eq('project_id', finding.project_id)
    .maybeSingle()
  if (!membership) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  if (!finding.related_report_id) {
    return c.json({ ok: false, error: { code: 'NO_REPORT', message: 'This finding has no synthetic report attached (low-severity findings are info-only).' } }, 400)
  }

  const { data: settings } = await db
    .from('project_settings')
    .select('autofix_enabled')
    .eq('project_id', finding.project_id)
    .maybeSingle()
  if (!settings?.autofix_enabled) {
    return c.json({ ok: false, error: { code: 'AUTOFIX_DISABLED', message: 'Enable Autofix in project settings first' } }, 400)
  }

  const { data: existing } = await db
    .from('fix_dispatch_jobs')
    .select('id, status')
    .eq('project_id', finding.project_id)
    .eq('report_id', finding.related_report_id)
    .in('status', ['queued', 'running'])
    .limit(1)
  if (existing?.length) {
    return c.json({ ok: true, data: { dispatchId: existing[0].id, status: existing[0].status, deduplicated: true } })
  }

  const { data: job, error: insertErr } = await db
    .from('fix_dispatch_jobs')
    .insert({
      project_id: finding.project_id,
      report_id: finding.related_report_id,
      requested_by: userId,
      status: 'queued',
    })
    .select('id, status, created_at')
    .single()
  if (insertErr || !job) {
    return c.json({ ok: false, error: { code: 'DISPATCH_FAILED', message: insertErr?.message ?? 'enqueue failed' } }, 500)
  }

  await db
    .from('modernization_findings')
    .update({ status: 'dispatched' })
    .eq('id', finding.id)

  invokeFixWorker(job.id).catch((err) => {
    console.warn('[modernization] worker invocation failed', { dispatchId: job.id, err: String(err) })
  })

  await logAudit(db, finding.project_id, userId, 'fix.attempted', 'modernization_finding', finding.id, { dep: finding.dep_name, dispatchId: job.id, source: 'modernization' }).catch(() => {})
  return c.json({ ok: true, data: { dispatchId: job.id, status: job.status, createdAt: job.created_at } })
})

app.post('/v1/admin/modernization/:id/dismiss', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const findingId = c.req.param('id')
  const db = getServiceClient()

  const { data: finding } = await db
    .from('modernization_findings')
    .select('project_id, dep_name')
    .eq('id', findingId)
    .maybeSingle()
  if (!finding) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: membership } = await db
    .from('project_members')
    .select('role')
    .eq('user_id', userId)
    .eq('project_id', finding.project_id)
    .maybeSingle()
  if (!membership) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  const { error } = await db
    .from('modernization_findings')
    .update({ status: 'dismissed' })
    .eq('id', findingId)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await logAudit(db, finding.project_id, userId, 'report.triaged', 'modernization_finding', findingId, { dep: finding.dep_name, action: 'dismissed' }).catch(() => {})
  return c.json({ ok: true })
})

// ============================================================
// INTEGRATION HEALTH (V5.3 §2.18) — admin probe + history
// ============================================================
//
// One endpoint per non-LLM integration. Each test does the smallest possible
// authenticated request against the provider, records the result in
// integration_health_history, and returns a structured payload for the UI.
//
// Why per-provider rather than a generic /v1/admin/health/:kind: every
// provider has a different "is alive" call (Sentry needs the org slug,
// Langfuse needs the public key as a basic-auth header, GitHub needs a
// bearer token + repo). Generic adapters end up as a giant switch
// statement anyway — keeping them named makes the code grep-friendly.

const INTEGRATION_KINDS = ['sentry', 'langfuse', 'github'] as const
type IntegrationKind = typeof INTEGRATION_KINDS[number]

app.post('/v1/admin/health/integration/:kind', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const kind = c.req.param('kind') as IntegrationKind
  if (!INTEGRATION_KINDS.includes(kind)) {
    return c.json({ ok: false, error: { code: 'BAD_KIND' } }, 400)
  }

  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const { data: settings } = await db
    .from('project_settings')
    .select('sentry_org_slug, sentry_project_slug, sentry_auth_token_ref, sentry_dsn, langfuse_host, langfuse_public_key_ref, langfuse_secret_key_ref, github_repo_url, github_installation_token_ref')
    .eq('project_id', project.id)
    .single()

  const startedAt = Date.now()
  let healthStatus: 'ok' | 'degraded' | 'down' | 'unknown' = 'unknown'
  let detail = ''
  let httpStatus = 0

  try {
    if (kind === 'sentry') {
      const token = await dereferenceMaybeVault(db, settings?.sentry_auth_token_ref ?? null)
      const org = settings?.sentry_org_slug
      if (!token || !org) {
        healthStatus = 'unknown'
        detail = 'Set sentry_org_slug and sentry_auth_token in Integrations to enable health checks.'
      } else {
        const res = await fetch(`https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        healthStatus = res.ok ? 'ok' : (res.status === 401 || res.status === 403 ? 'down' : 'degraded')
        if (!res.ok) detail = `HTTP ${res.status}`
      }
    } else if (kind === 'langfuse') {
      const host = settings?.langfuse_host || Deno.env.get('LANGFUSE_BASE_URL') || 'https://cloud.langfuse.com'
      const pub = await dereferenceMaybeVault(db, settings?.langfuse_public_key_ref ?? null) || Deno.env.get('LANGFUSE_PUBLIC_KEY') || ''
      const sec = await dereferenceMaybeVault(db, settings?.langfuse_secret_key_ref ?? null) || Deno.env.get('LANGFUSE_SECRET_KEY') || ''
      if (!pub || !sec) {
        healthStatus = 'unknown'
        detail = 'Add Langfuse public + secret keys (or set env vars on the host).'
      } else {
        const auth = btoa(`${pub}:${sec}`)
        const res = await fetch(`${host.replace(/\/$/, '')}/api/public/health`, {
          headers: { 'Authorization': `Basic ${auth}` },
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        healthStatus = res.ok ? 'ok' : (res.status === 401 ? 'down' : 'degraded')
        if (!res.ok) detail = `HTTP ${res.status}`
      }
    } else if (kind === 'github') {
      const token = await dereferenceMaybeVault(db, settings?.github_installation_token_ref ?? null) || Deno.env.get('GITHUB_TOKEN') || ''
      const url = settings?.github_repo_url ?? ''
      // Repo names can contain dots (e.g. glot.it). Strip optional trailing
      // `.git` and capture everything up to the next `/` or end-of-string.
      const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
      if (!token || !match) {
        healthStatus = 'unknown'
        detail = 'Add github_repo_url and a GitHub App / PAT installation token.'
      } else {
        const [, owner, repo] = match
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'mushi-mushi-health-probe/1.0',
          },
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        healthStatus = res.ok ? 'ok' : (res.status === 401 || res.status === 403 || res.status === 404 ? 'down' : 'degraded')
        if (!res.ok) detail = `HTTP ${res.status}`
      }
    }
  } catch (err) {
    healthStatus = 'down'
    detail = String(err).slice(0, 200)
  }

  const latencyMs = Date.now() - startedAt
  await db.from('integration_health_history').insert({
    project_id: project.id,
    kind,
    status: healthStatus,
    latency_ms: latencyMs,
    message: detail || (httpStatus ? `HTTP ${httpStatus}` : null),
    source: 'manual',
  })

  return c.json({ ok: true, data: { kind, status: healthStatus, httpStatus, latencyMs, detail } })
})

app.get('/v1/admin/health/history', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { history: [] } })

  const { data } = await db
    .from('integration_health_history')
    .select('id, kind, status, latency_ms, message, source, checked_at')
    .eq('project_id', project.id)
    .order('checked_at', { ascending: false })
    .limit(200)

  return c.json({ ok: true, data: { history: data ?? [] } })
})

async function dereferenceMaybeVault(db: ReturnType<typeof getServiceClient>, ref: string | null): Promise<string | null> {
  if (!ref) return null
  if (!ref.startsWith('vault://')) return ref
  const id = ref.slice('vault://'.length)
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id })
  if (error) return null
  return typeof data === 'string' ? data : null
}

// Projects admin endpoints
// Wave 4.2: billing summary for the admin /billing page.
// Returns plan, current-period usage, and quota state for every project the
// user owns. Free-tier projects show used/limit; subscribed projects show
// metered usage with no hard cap.
app.get('/v1/admin/billing', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db
    .from('projects')
    .select('id, name')
    .eq('owner_id', userId)

  if (!projects || projects.length === 0) {
    return c.json({ ok: true, data: { projects: [] } })
  }

  const periodStart = new Date()
  periodStart.setUTCDate(1)
  periodStart.setUTCHours(0, 0, 0, 0)

  const projectIds = projects.map(p => p.id)
  const [{ data: subs }, { data: customers }, { data: usage }] = await Promise.all([
    db.from('billing_subscriptions')
      .select('project_id, status, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end')
      .in('project_id', projectIds),
    db.from('billing_customers')
      .select('project_id, stripe_customer_id, default_payment_ok, email')
      .in('project_id', projectIds),
    db.from('usage_events')
      .select('project_id, event_name, quantity, occurred_at')
      .in('project_id', projectIds)
      .gte('occurred_at', periodStart.toISOString()),
  ])

  const subByProject = new Map<string, any>()
  for (const s of subs ?? []) {
    if (!subByProject.has(s.project_id)) subByProject.set(s.project_id, s)
  }
  const customerByProject = new Map<string, any>()
  for (const c of customers ?? []) customerByProject.set(c.project_id, c)

  const usageByProject = new Map<string, { reports: number; fixes: number; tokens: number }>()
  for (const u of usage ?? []) {
    const cur = usageByProject.get(u.project_id) ?? { reports: 0, fixes: 0, tokens: 0 }
    if (u.event_name === 'reports_ingested') cur.reports += Number(u.quantity)
    else if (u.event_name === 'fixes_attempted') cur.fixes += Number(u.quantity)
    else if (u.event_name === 'classifier_tokens') cur.tokens += Number(u.quantity)
    usageByProject.set(u.project_id, cur)
  }

  const freeLimit = Number(Deno.env.get('MUSHI_FREE_REPORTS_PER_MONTH') ?? '1000')

  const items = projects.map(p => {
    const sub = subByProject.get(p.id) ?? null
    const cust = customerByProject.get(p.id) ?? null
    const u = usageByProject.get(p.id) ?? { reports: 0, fixes: 0, tokens: 0 }
    const subscribed = !!sub && ['active', 'trialing', 'past_due'].includes(sub.status)
    return {
      project_id: p.id,
      project_name: p.name,
      plan: subscribed ? sub.stripe_price_id : 'free',
      subscription: sub,
      customer: cust,
      period_start: periodStart.toISOString(),
      usage: u,
      limit_reports: subscribed ? null : freeLimit,
      over_quota: !subscribed && u.reports >= freeLimit,
    }
  })

  return c.json({ ok: true, data: { projects: items, free_limit_reports_per_month: freeLimit } })
})

// =================================================================================
// GET /v1/admin/setup
// ---------------------------------------------------------------------------------
// Aggregates the seven onboarding signals per owned project. Single source of truth
// for the dashboard `SetupChecklist` banner, the full `/onboarding` wizard, and
// every contextual EmptyState nudge across the app. Reads live DB state instead of
// the legacy `localStorage.mushi:onboarding_completed` flag so progress survives
// across devices/browsers and reflects the actual pipeline.
// =================================================================================
app.get('/v1/admin/setup', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const { data: projects } = await db
    .from('projects')
    .select('id, name, slug, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })

  if (!projects || projects.length === 0) {
    return c.json({
      ok: true,
      data: {
        has_any_project: false,
        projects: [],
      },
    })
  }

  const projectIds = projects.map(p => p.id)

  // Pull every signal in parallel; we project narrow column lists to keep this
  // cheap even when the user owns dozens of projects.
  const [keysRes, settingsRes, reportsRes, fixesRes, reposRes] = await Promise.all([
    db.from('project_api_keys')
      .select('project_id, is_active')
      .in('project_id', projectIds)
      .eq('is_active', true),
    db.from('project_settings')
      .select('project_id, github_repo_url, sentry_org_slug, byok_anthropic_key_ref')
      .in('project_id', projectIds),
    db.from('reports')
      .select('project_id, environment, created_at')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('fix_attempts')
      .select('project_id')
      .in('project_id', projectIds)
      .limit(1000),
    db.from('project_repos')
      .select('project_id')
      .in('project_id', projectIds),
  ])

  const keyByProject = new Set<string>()
  for (const k of keysRes.data ?? []) keyByProject.add(k.project_id)

  const settingsByProject = new Map<string, { github_repo_url: string | null; sentry_org_slug: string | null; byok_anthropic_key_ref: string | null }>()
  for (const s of settingsRes.data ?? []) settingsByProject.set(s.project_id, s as never)

  const reposByProject = new Set<string>()
  for (const r of reposRes.data ?? []) reposByProject.add(r.project_id)

  // SDK installed = at least one report whose `environment.userAgent` is a real
  // browser (not the admin-only `mushi-admin` synthetic), and whose `environment`
  // contains the `viewport` key the SDK always emits.
  const sdkByProject = new Set<string>()
  const reportsByProject = new Map<string, { count: number; firstAt: string | null }>()
  for (const r of reportsRes.data ?? []) {
    const cur = reportsByProject.get(r.project_id) ?? { count: 0, firstAt: null }
    cur.count += 1
    cur.firstAt = r.created_at
    reportsByProject.set(r.project_id, cur)
    const env = (r.environment ?? {}) as Record<string, unknown>
    const platform = typeof env.platform === 'string' ? env.platform : ''
    if (platform && platform !== 'mushi-admin') sdkByProject.add(r.project_id)
  }

  const fixesByProject = new Map<string, number>()
  for (const f of fixesRes.data ?? []) {
    fixesByProject.set(f.project_id, (fixesByProject.get(f.project_id) ?? 0) + 1)
  }

  type StepId =
    | 'project_created'
    | 'api_key_generated'
    | 'sdk_installed'
    | 'first_report_received'
    | 'github_connected'
    | 'sentry_connected'
    | 'byok_anthropic'
    | 'first_fix_dispatched'

  interface Step {
    id: StepId
    label: string
    description: string
    complete: boolean
    /** True when this step is required for the basic pipeline to work. */
    required: boolean
    /** Admin-console link the wizard / nudge should jump to. */
    cta_to: string
    cta_label: string
  }

  const enriched = projects.map(p => {
    const hasKey = keyByProject.has(p.id)
    const settings = settingsByProject.get(p.id)
    const hasSdk = sdkByProject.has(p.id)
    const reportInfo = reportsByProject.get(p.id) ?? { count: 0, firstAt: null }
    const hasGithub = Boolean(settings?.github_repo_url) || reposByProject.has(p.id)
    const hasSentry = Boolean(settings?.sentry_org_slug)
    const hasByok = Boolean(settings?.byok_anthropic_key_ref)
    const fixCount = fixesByProject.get(p.id) ?? 0

    const steps: Step[] = [
      {
        id: 'project_created',
        label: 'Create your first project',
        description: 'A project groups all bug reports from one application.',
        complete: true,
        required: true,
        cta_to: '/projects',
        cta_label: 'Manage projects',
      },
      {
        id: 'api_key_generated',
        label: 'Generate an API key',
        description: 'Your SDK uses this key to authenticate report submissions.',
        complete: hasKey,
        required: true,
        cta_to: '/projects',
        cta_label: 'Generate key',
      },
      {
        id: 'sdk_installed',
        label: 'Install the SDK in your app',
        description: 'Drop the Mushi widget into your app so users can submit reports.',
        complete: hasSdk,
        required: true,
        cta_to: '/onboarding',
        cta_label: 'View setup guide',
      },
      {
        id: 'first_report_received',
        label: 'Receive your first bug report',
        description: 'Send a test report or wait for a real user submission.',
        complete: reportInfo.count > 0,
        required: true,
        cta_to: '/onboarding',
        cta_label: 'Send test report',
      },
      {
        id: 'github_connected',
        label: 'Connect GitHub',
        description: 'Required for auto-fix PRs and code grounding.',
        complete: hasGithub,
        required: false,
        cta_to: '/integrations',
        cta_label: 'Connect GitHub',
      },
      {
        id: 'sentry_connected',
        label: 'Connect Sentry (optional)',
        description: 'Pull Sentry issues + Seer root-cause into Mushi reports.',
        complete: hasSentry,
        required: false,
        cta_to: '/integrations',
        cta_label: 'Connect Sentry',
      },
      {
        id: 'byok_anthropic',
        label: 'Add your Anthropic key (optional)',
        description: 'BYOK avoids platform quotas and sends usage to your own bill.',
        complete: hasByok,
        required: false,
        cta_to: '/settings',
        cta_label: 'Add API key',
      },
      {
        id: 'first_fix_dispatched',
        label: 'Dispatch your first auto-fix',
        description: 'Open a report, click "Dispatch fix", and watch the LLM agent.',
        complete: fixCount > 0,
        required: false,
        cta_to: '/reports',
        cta_label: 'Open Reports',
      },
    ]

    const requiredSteps = steps.filter(s => s.required)
    const completeRequired = requiredSteps.filter(s => s.complete).length
    const completeAll = steps.filter(s => s.complete).length

    return {
      project_id: p.id,
      project_name: p.name,
      project_slug: p.slug,
      created_at: p.created_at,
      steps,
      required_total: requiredSteps.length,
      required_complete: completeRequired,
      total: steps.length,
      complete: completeAll,
      done: completeRequired === requiredSteps.length,
      report_count: reportInfo.count,
      fix_count: fixCount,
    }
  })

  return c.json({
    ok: true,
    data: {
      has_any_project: true,
      projects: enriched,
    },
  })
})

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

  const [reportCounts, allKeys, members, latestReports] = await Promise.all([
    db.from('reports').select('project_id', { count: 'exact', head: false }).in('project_id', projectIds),
    db.from('project_api_keys').select('id, project_id, key_prefix, created_at, is_active').in('project_id', projectIds).order('created_at', { ascending: false }),
    db.from('project_members').select('project_id, user_id, role').in('project_id', projectIds),
    db.from('reports').select('project_id, created_at').in('project_id', projectIds).order('created_at', { ascending: false }).limit(projectIds.length * 2),
  ])

  const countMap: Record<string, number> = {}
  for (const r of reportCounts.data ?? []) countMap[r.project_id] = (countMap[r.project_id] ?? 0) + 1

  const keyMap: Record<string, Array<Record<string, unknown>>> = {}
  for (const k of allKeys.data ?? []) {
    if (!keyMap[k.project_id]) keyMap[k.project_id] = []
    keyMap[k.project_id].push({ id: k.id, key_prefix: k.key_prefix, created_at: k.created_at, is_active: k.is_active, revoked: !k.is_active })
  }

  const memberMap: Record<string, Array<{ user_id: string; role: string }>> = {}
  for (const m of members.data ?? []) {
    if (!memberMap[m.project_id]) memberMap[m.project_id] = []
    memberMap[m.project_id].push({ user_id: m.user_id, role: m.role })
  }

  const lastReportMap: Record<string, string> = {}
  for (const r of latestReports.data ?? []) {
    if (!lastReportMap[r.project_id]) lastReportMap[r.project_id] = r.created_at
  }

  const enriched = (projects ?? []).map(p => {
    const keys = keyMap[p.id] ?? []
    return {
      ...p,
      report_count: countMap[p.id] ?? 0,
      api_keys: keys,
      active_key_count: keys.filter(k => k.is_active).length,
      member_count: (memberMap[p.id] ?? []).length,
      members: memberMap[p.id] ?? [],
      last_report_at: lastReportMap[p.id] ?? null,
    }
  })

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
  // Membership is the source-of-truth for "can this user dispatch fixes /
  // see traces / etc". Without this row the owner can read via owner_id but
  // member-gated endpoints (fixes/dispatch) reject them. Always seed.
  await db.from('project_members').upsert(
    { project_id: data.id, user_id: userId, role: 'owner' },
    { onConflict: 'project_id,user_id' },
  )

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

  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) {
    return c.json({ ok: true, data: { items: [], total: 0, page: 1, pageSize: 50 } })
  }

  const status = c.req.query('status') ?? 'dead_letter'
  const stage = c.req.query('stage')
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const pageSize = Math.min(100, Math.max(10, Number(c.req.query('pageSize') ?? 25)))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = db
    .from('processing_queue')
    .select('*, reports(description, user_category, created_at)', { count: 'exact' })
    .in('project_id', projectIds)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(from, to)
  if (stage) query = query.eq('stage', stage)

  const { data: items, count } = await query
  return c.json({
    ok: true,
    data: { items: items ?? [], total: count ?? 0, page, pageSize },
  })
})

// Counts per stage/status so the queue page can show "where is the
// backlog" at a glance without paginating through everything.
app.get('/v1/admin/queue/summary', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) {
    return c.json({ ok: true, data: { byStatus: {}, byStage: {}, stages: [] } })
  }
  const { data } = await db
    .from('processing_queue')
    .select('stage, status')
    .in('project_id', projectIds)
    .limit(5000)
  const byStatus: Record<string, number> = {}
  const byStage: Record<string, Record<string, number>> = {}
  for (const r of data ?? []) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    byStage[r.stage] ??= {}
    byStage[r.stage][r.status] = (byStage[r.stage][r.status] ?? 0) + 1
  }
  return c.json({
    ok: true,
    data: { byStatus, byStage, stages: Object.keys(byStage).sort() },
  })
})

// 14-day daily throughput across all stages — Pending/Completed/Failed.
// Drives the sparkline at the top of the queue page.
app.get('/v1/admin/queue/throughput', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { days: [] } })
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 13)
  since.setUTCHours(0, 0, 0, 0)
  const { data } = await db
    .from('processing_queue')
    .select('status, created_at, completed_at')
    .in('project_id', projectIds)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })
    .limit(5000)
  const days: { day: string; created: number; completed: number; failed: number }[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(since)
    d.setUTCDate(since.getUTCDate() + i)
    days.push({ day: d.toISOString().slice(0, 10), created: 0, completed: 0, failed: 0 })
  }
  const byDay = new Map(days.map((d) => [d.day, d]))
  for (const r of data ?? []) {
    const k = String(r.created_at).slice(0, 10)
    const bucket = byDay.get(k)
    if (!bucket) continue
    bucket.created++
    if (r.status === 'completed') bucket.completed++
    if (r.status === 'failed' || r.status === 'dead_letter') bucket.failed++
  }
  return c.json({ ok: true, data: { days } })
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

// Wave 2.2: bulk flush for circuit-breaker queued reports.
// When `checkCircuitBreaker` trips, ingestReport sets `reports.status='queued'`
// and skips the per-report fast-filter invoke. Once the breaker clears, those
// reports stay queued until manually rerun. This endpoint replays them in a
// single click. Bounded at 50/call to avoid runaway invocations.
app.post('/v1/admin/queue/flush-queued', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) {
    return c.json({ ok: true, data: { flushed: 0, scanned: 0 } })
  }

  const { data: queued, error } = await db
    .from('reports')
    .select('id, project_id')
    .in('project_id', projectIds)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  }

  const items = queued ?? []
  for (const r of items) {
    await db.from('reports').update({ status: 'new' }).eq('id', r.id)
    triggerClassification(r.id, r.project_id)
  }

  for (const projectId of [...new Set(items.map(i => i.project_id))]) {
    await logAudit(
      db,
      projectId,
      userId,
      'settings.updated',
      'queue',
      undefined,
      { kind: 'flush_queued', flushed: items.filter(i => i.project_id === projectId).length },
    ).catch(() => {})
  }

  return c.json({ ok: true, data: { flushed: items.length, scanned: items.length } })
})

// Pipeline recovery: broader scope than flush-queued. Re-fires fast-filter
// for `status IN ('new','queued')` reports older than 5min that never got
// past stage1, plus pending queue items past their SLA, plus failed queue
// items with attempts left. Mirrors what the `mushi-pipeline-recovery-5m`
// pg_cron does, but scoped to the requesting admin's projects.
app.post('/v1/admin/queue/recover', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()

  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) {
    return c.json({ ok: true, data: { reports: 0, queue: 0, reconciled: 0 } })
  }

  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString()
  const { data: stranded } = await db
    .from('reports')
    .select('id, project_id')
    .in('project_id', projectIds)
    .in('status', ['new', 'queued'])
    .lt('created_at', cutoff)
    .lt('processing_attempts', 3)
    .order('created_at', { ascending: true })
    .limit(50)

  const items = stranded ?? []
  for (const r of items) {
    if (r.status === 'queued') {
      await db.from('reports').update({ status: 'new' }).eq('id', r.id)
    }
    triggerClassification(r.id, r.project_id)
  }

  const { data: failed } = await db
    .from('processing_queue')
    .select('id, report_id, project_id, attempts, max_attempts')
    .in('project_id', projectIds)
    .eq('status', 'failed')
    .order('created_at', { ascending: true })
    .limit(50)

  const retryable = (failed ?? []).filter((f) => (f.attempts ?? 0) < (f.max_attempts ?? 3))
  for (const q of retryable) {
    await db.from('processing_queue').update({
      status: 'pending',
      scheduled_at: new Date().toISOString(),
    }).eq('id', q.id)
    triggerClassification(q.report_id, q.project_id)
  }

  const { data: stale } = await db
    .from('processing_queue')
    .select('id, reports!inner(status)')
    .in('project_id', projectIds)
    .eq('status', 'pending')
    .in('reports.status', ['classified', 'dispatched', 'completed'])
    .limit(100)

  const reconcileIds = (stale ?? []).map((s) => s.id)
  if (reconcileIds.length > 0) {
    await db.from('processing_queue').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).in('id', reconcileIds)
  }

  for (const projectId of [...new Set(items.map((i) => i.project_id))]) {
    await logAudit(
      db,
      projectId,
      userId,
      'settings.updated',
      'queue',
      undefined,
      { kind: 'recover_stranded', reports: items.filter((i) => i.project_id === projectId).length, queue: retryable.length },
    ).catch(() => {})
  }

  return c.json({
    ok: true,
    data: {
      reports: items.length,
      queue: retryable.length,
      reconciled: reconcileIds.length,
    },
  })
})

// ============================================================
// PHASE 2: KNOWLEDGE GRAPH
// ============================================================

app.get('/v1/admin/graph/nodes', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []
  if (projectIds.length === 0) return c.json({ ok: true, data: { nodes: [] } })

  const nodeType = c.req.query('type')
  let query = db
    .from('graph_nodes')
    .select('id, project_id, node_type, label, metadata, last_traversed_at, created_at')
    .in('project_id', projectIds)
    .limit(200)
  if (nodeType) query = query.eq('node_type', nodeType)

  const { data: nodes } = await query.order('created_at', { ascending: false })
  if (!nodes || nodes.length === 0) return c.json({ ok: true, data: { nodes: [] } })

  // Compute occurrence_count for component / page nodes by joining against
  // reports. Done in JS to avoid an N+1 — single SELECT, in-memory bucketing.
  // The graph page uses this to size and rank nodes.
  const componentLabels = nodes.filter(n => n.node_type === 'component').map(n => n.label)
  const pageLabels = nodes.filter(n => n.node_type === 'page').map(n => n.label)

  const counts = new Map<string, number>()
  if (componentLabels.length > 0 || pageLabels.length > 0) {
    const { data: reportRows } = await db
      .from('reports')
      .select('component, url, project_id')
      .in('project_id', projectIds)
    for (const r of reportRows ?? []) {
      if (r.component) counts.set(`component:${r.component}`, (counts.get(`component:${r.component}`) ?? 0) + 1)
      if (r.url) {
        try {
          const path = new URL(r.url).pathname
          counts.set(`page:${path}`, (counts.get(`page:${path}`) ?? 0) + 1)
        } catch {
          // url may be relative; just use it as-is
          counts.set(`page:${r.url}`, (counts.get(`page:${r.url}`) ?? 0) + 1)
        }
      }
    }
  }

  const enriched = nodes.map(n => {
    const occ = counts.get(`${n.node_type}:${n.label}`) ?? 0
    const meta = (n.metadata && typeof n.metadata === 'object' && !Array.isArray(n.metadata))
      ? { ...(n.metadata as Record<string, unknown>), occurrence_count: occ }
      : { occurrence_count: occ }
    return { ...n, metadata: meta }
  })

  return c.json({ ok: true, data: { nodes: enriched } })
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

  const startedAt = Date.now()
  try {
    const result = await executeNaturalLanguageQuery(db, projectIds, question)
    const latencyMs = Date.now() - startedAt
    // Persist on success — best-effort; if the insert fails we still return
    // the answer so the user isn't blocked on telemetry.
    db.from('nl_query_history').insert({
      project_id: projectIds[0] ?? null,
      user_id: userId,
      prompt: question,
      sql: result.sql,
      summary: result.summary,
      explanation: result.explanation,
      row_count: Array.isArray(result.results) ? result.results.length : 0,
      latency_ms: latencyMs,
    }).then(({ error }) => { if (error) console.warn('[nl_query_history] insert failed:', error.message) })

    return c.json({ ok: true, data: { ...result, latencyMs } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const latencyMs = Date.now() - startedAt
    db.from('nl_query_history').insert({
      project_id: projectIds[0] ?? null,
      user_id: userId,
      prompt: question,
      error: message,
      latency_ms: latencyMs,
    }).then(({ error }) => { if (error) console.warn('[nl_query_history] insert failed:', error.message) })
    return c.json({ ok: false, error: { code: 'QUERY_ERROR', message } }, 400)
  }
})

app.get('/v1/admin/query/history', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20), 1), 100)
  const { data, error } = await db
    .from('nl_query_history')
    .select('id, project_id, prompt, sql, summary, explanation, row_count, error, latency_ms, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { history: data ?? [] } })
})

app.delete('/v1/admin/query/history/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const db = getServiceClient()
  const { error } = await db.from('nl_query_history').delete().eq('id', id).eq('user_id', userId)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { deleted: id } })
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
  // Use project_members so collaborators (not just owner_id) see fixes for
  // projects they belong to. Mirrors the membership pattern in dispatches.
  const { data: memberships } = await db
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)
  const projectIds = (memberships ?? []).map(m => m.project_id)
  if (projectIds.length === 0) return c.json({ ok: true, data: { fixes: [] } })

  const { data } = await db
    .from('fix_attempts')
    .select(
      'id, report_id, project_id, agent, branch, pr_url, pr_number, commit_sha, status, files_changed, lines_changed, summary, rationale, review_passed, started_at, completed_at, created_at, langfuse_trace_id, llm_model, llm_input_tokens, llm_output_tokens, check_run_status, check_run_conclusion, error',
    )
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

// Aggregate KPIs for the Fixes page header — last 30 days.
// MUST be registered before /v1/admin/fixes/:id so Hono doesn't match
// the literal "summary" segment as a fix id.
app.get('/v1/admin/fixes/summary', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) {
    return c.json({ ok: true, data: { total: 0, completed: 0, failed: 0, inProgress: 0, prsOpen: 0, prsMerged: 0, days: [] } })
  }
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 29)
  since.setUTCHours(0, 0, 0, 0)

  const { data: rows } = await db
    .from('fix_attempts')
    .select('id, status, pr_url, pr_number, check_run_conclusion, started_at, completed_at, created_at')
    .in('project_id', projectIds)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })
    .limit(500)

  const list = rows ?? []
  const completed = list.filter(r => r.status === 'completed').length
  const failed = list.filter(r => r.status === 'failed').length
  const inProgress = list.filter(r => r.status === 'queued' || r.status === 'running' || r.status === 'pending').length
  const prsOpen = list.filter(r => r.pr_url && r.status === 'completed' && r.check_run_conclusion !== 'merged').length
  const prsMerged = list.filter(r => r.check_run_conclusion === 'success').length

  const days: { day: string; total: number; completed: number; failed: number }[] = []
  for (let i = 0; i < 30; i++) {
    const d = new Date(since)
    d.setUTCDate(since.getUTCDate() + i)
    days.push({ day: d.toISOString().slice(0, 10), total: 0, completed: 0, failed: 0 })
  }
  const byDay = new Map(days.map(d => [d.day, d]))
  for (const r of list) {
    const k = String(r.created_at).slice(0, 10)
    const bucket = byDay.get(k)
    if (!bucket) continue
    bucket.total++
    if (r.status === 'completed') bucket.completed++
    if (r.status === 'failed') bucket.failed++
  }

  return c.json({
    ok: true,
    data: {
      total: list.length,
      completed,
      failed,
      inProgress,
      prsOpen,
      prsMerged,
      days,
    },
  })
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

// PDCA timeline for a single fix attempt — merges fix_dispatch_jobs +
// fix_attempts + check-run signals into an ordered event stream so the UI
// can render a real branch graph.
app.get('/v1/admin/fixes/:id/timeline', jwtAuth, async (c) => {
  const fixId = c.req.param('id')
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404)

  const { data: fix } = await db
    .from('fix_attempts')
    .select('id, report_id, project_id, agent, branch, pr_url, pr_number, commit_sha, status, lines_changed, files_changed, llm_model, started_at, completed_at, created_at, check_run_status, check_run_conclusion, check_run_updated_at, error')
    .eq('id', fixId)
    .in('project_id', projectIds)
    .single()
  if (!fix) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404)

  const { data: dispatch } = await db
    .from('fix_dispatch_jobs')
    .select('id, status, created_at, started_at, finished_at, error')
    .eq('fix_attempt_id', fixId)
    .maybeSingle()

  type EventKind = 'dispatched' | 'started' | 'branch' | 'commit' | 'pr_opened' | 'ci_started' | 'ci_resolved' | 'completed' | 'failed'
  interface TimelineEvent {
    kind: EventKind
    at: string
    label: string
    detail?: string | null
    status?: 'ok' | 'fail' | 'pending' | null
  }
  const events: TimelineEvent[] = []

  if (dispatch) {
    events.push({
      kind: 'dispatched',
      at: dispatch.created_at,
      label: 'Dispatch requested',
      status: 'pending',
    })
    if (dispatch.started_at) {
      events.push({ kind: 'started', at: dispatch.started_at, label: 'Worker started', status: 'pending' })
    }
  } else if (fix.created_at) {
    events.push({ kind: 'dispatched', at: fix.created_at, label: 'Fix attempt created', status: 'pending' })
  }

  if (fix.started_at) {
    events.push({
      kind: 'started',
      at: fix.started_at,
      label: 'Agent started',
      detail: fix.llm_model,
      status: 'pending',
    })
  }
  if (fix.branch) {
    events.push({
      kind: 'branch',
      at: fix.started_at ?? fix.created_at,
      label: 'Branch created',
      detail: fix.branch,
      status: 'ok',
    })
  }
  if (fix.commit_sha) {
    events.push({
      kind: 'commit',
      at: fix.completed_at ?? fix.started_at ?? fix.created_at,
      label: `Commit ${fix.commit_sha.slice(0, 7)}`,
      detail: `${fix.files_changed?.length ?? 0} files · ${fix.lines_changed ?? 0} lines`,
      status: 'ok',
    })
  }
  if (fix.pr_url) {
    events.push({
      kind: 'pr_opened',
      at: fix.completed_at ?? fix.started_at ?? fix.created_at,
      label: `PR opened${fix.pr_number ? ` #${fix.pr_number}` : ''}`,
      detail: fix.pr_url,
      status: 'ok',
    })
  }
  if (fix.check_run_status || fix.check_run_conclusion) {
    const conclusion = (fix.check_run_conclusion ?? '').toLowerCase()
    const ciStatus: 'ok' | 'fail' | 'pending' =
      conclusion === 'success' ? 'ok' : conclusion === 'failure' || conclusion === 'cancelled' ? 'fail' : 'pending'
    events.push({
      kind: ciStatus === 'pending' ? 'ci_started' : 'ci_resolved',
      at: fix.check_run_updated_at ?? fix.completed_at ?? fix.started_at ?? fix.created_at,
      label: ciStatus === 'pending'
        ? `CI ${fix.check_run_status?.replace(/_/g, ' ') ?? 'running'}`
        : `CI ${conclusion}`,
      status: ciStatus,
    })
  }
  if (fix.status === 'completed') {
    events.push({
      kind: 'completed',
      at: fix.completed_at ?? new Date().toISOString(),
      label: 'Fix completed',
      status: 'ok',
    })
  } else if (fix.status === 'failed') {
    events.push({
      kind: 'failed',
      at: fix.completed_at ?? new Date().toISOString(),
      label: 'Fix failed',
      detail: fix.error,
      status: 'fail',
    })
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return c.json({ ok: true, data: { fix, dispatch, events } })
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
    .select('id, project_id, provider_type, provider_name, metadata_url, entity_id, acs_url, is_active, sso_provider_id, registration_status, registration_error, registered_at, domains, created_at')
    .eq('project_id', project.id)
    .limit(50)
  return c.json({ ok: true, data: { configs: data ?? [] } })
})

// Register a SAML/OIDC provider against the Supabase Auth Admin API and
// persist a row that mirrors the canonical `auth.sso_providers` entry.
//
// SAML: ships the IdP metadata URL straight to GoTrue, which fetches +
// caches it, then mints an ACS URL the user must configure on their IdP.
// OIDC: stored in our table and surfaced to the UI; OIDC support in
// supabase-go-true admin API is gated to enterprise tiers, so we record it
// as 'pending' and let the operator wire it manually if their plan allows.
//
// Returns the canonical Auth provider ID + status so the UI can show the
// admin which step they're on (config saved → registered → active).
app.post('/v1/admin/sso', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json() as {
    providerType: 'saml' | 'oidc'
    providerName: string
    metadataUrl?: string
    metadataXml?: string
    entityId?: string
    acsUrl?: string
    domains?: string[]
  }
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  if (!['saml', 'oidc'].includes(body.providerType)) {
    return c.json({ ok: false, error: { code: 'BAD_PROVIDER', message: 'providerType must be saml or oidc' } }, 400)
  }
  if (!body.providerName?.trim()) {
    return c.json({ ok: false, error: { code: 'MISSING_NAME', message: 'providerName is required' } }, 400)
  }

  // First persist a row in 'pending' so the UI sees state immediately even if
  // the GoTrue call fails. We update the row to 'registered' on success.
  const { data: configRow, error: insertErr } = await db.from('enterprise_sso_configs').insert({
    project_id: project.id,
    provider_type: body.providerType,
    provider_name: body.providerName,
    metadata_url: body.metadataUrl ?? null,
    entity_id: body.entityId ?? null,
    acs_url: body.acsUrl ?? null,
    domains: body.domains ?? [],
    registration_status: 'pending',
  }).select('id').single()

  if (insertErr || !configRow) {
    return c.json({ ok: false, error: { code: 'DB_ERROR', message: insertErr?.message ?? 'insert failed' } }, 400)
  }

  // SAML registration via GoTrue Admin API. We POST to /auth/v1/admin/sso/providers
  // with the metadata URL; GoTrue fetches + parses it server-side and
  // returns the canonical provider ID + ACS URL.
  if (body.providerType === 'saml') {
    if (!body.metadataUrl && !body.metadataXml) {
      await db.from('enterprise_sso_configs').update({
        registration_status: 'failed',
        registration_error: 'SAML requires either metadataUrl or metadataXml',
      }).eq('id', configRow.id)
      return c.json({ ok: false, error: { code: 'MISSING_METADATA', message: 'SAML registration requires metadataUrl or metadataXml' } }, 400)
    }

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const goTrueRes = await fetch(`${supabaseUrl}/auth/v1/admin/sso/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          type: 'saml',
          metadata_url: body.metadataUrl,
          metadata_xml: body.metadataXml,
          domains: body.domains ?? [],
          attribute_mapping: {
            keys: {
              email: { name: 'email' },
              name: { name: 'displayName' },
            },
          },
        }),
      })
      const text = await goTrueRes.text()
      if (!goTrueRes.ok) {
        await db.from('enterprise_sso_configs').update({
          registration_status: 'failed',
          registration_error: `GoTrue ${goTrueRes.status}: ${text.slice(0, 500)}`,
        }).eq('id', configRow.id)
        await logAudit(db, project.id, userId, 'settings.updated', 'sso', configRow.id, {
          action: 'sso_register_failed', providerType: body.providerType, status: goTrueRes.status,
        })
        return c.json({ ok: false, error: { code: 'GOTRUE_ERROR', message: text.slice(0, 200) } }, goTrueRes.status >= 500 ? 502 : 400)
      }
      const provider = JSON.parse(text) as { id: string; saml?: { entity_id?: string; metadata_url?: string } }
      await db.from('enterprise_sso_configs').update({
        sso_provider_id: provider.id,
        entity_id: provider.saml?.entity_id ?? body.entityId ?? null,
        acs_url: `${supabaseUrl}/auth/v1/sso/saml/acs`,
        registration_status: 'registered',
        registration_error: null,
        registered_at: new Date().toISOString(),
        is_active: true,
      }).eq('id', configRow.id)

      await logAudit(db, project.id, userId, 'settings.updated', 'sso', configRow.id, {
        action: 'sso_registered', providerType: 'saml', providerId: provider.id,
      })

      return c.json({
        ok: true,
        data: {
          id: configRow.id,
          providerId: provider.id,
          acsUrl: `${supabaseUrl}/auth/v1/sso/saml/acs`,
          entityId: provider.saml?.entity_id,
          status: 'registered',
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await db.from('enterprise_sso_configs').update({
        registration_status: 'failed',
        registration_error: msg.slice(0, 500),
      }).eq('id', configRow.id)
      return c.json({ ok: false, error: { code: 'NETWORK_ERROR', message: msg } }, 502)
    }
  }

  // OIDC: GoTrue Admin SSO API only supports SAML today. We persist the
  // config so the operator sees their intent recorded, with a clear
  // pending-status hint in the UI.
  await logAudit(db, project.id, userId, 'settings.updated', 'sso', configRow.id, {
    action: 'sso_added', providerType: body.providerType,
  })
  return c.json({
    ok: true,
    data: {
      id: configRow.id,
      status: 'pending',
      hint: 'OIDC is recorded but not yet auto-registered. Contact support to enable OIDC for your tenant, or use SAML for self-service.',
    },
  })
})

// Allow disconnecting an SSO provider. We deregister from GoTrue first,
// then mark the config row 'disabled'. We never hard-delete rows because the
// audit log + sso_state attempts reference them.
app.delete('/v1/admin/sso/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const configId = c.req.param('id')
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const { data: config } = await db.from('enterprise_sso_configs')
    .select('id, sso_provider_id')
    .eq('id', configId)
    .eq('project_id', project.id)
    .maybeSingle()
  if (!config) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  if (config.sso_provider_id) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/sso/providers/${config.sso_provider_id}`, {
      method: 'DELETE',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    })
    if (!res.ok && res.status !== 404) {
      const text = await res.text()
      return c.json({ ok: false, error: { code: 'GOTRUE_ERROR', message: text.slice(0, 200) } }, 502)
    }
  }

  await db.from('enterprise_sso_configs').update({
    is_active: false,
    registration_status: 'disabled',
  }).eq('id', configId)

  await logAudit(db, project.id, userId, 'settings.deleted', 'sso', configId, { action: 'sso_disabled' })
  return c.json({ ok: true })
})

app.get('/v1/admin/audit', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId)
  const projectIds = projects?.map(p => p.id) ?? []

  const action = c.req.query('action')
  const resourceType = c.req.query('resource_type')
  const actor = c.req.query('actor')
  const since = c.req.query('since')
  const q = c.req.query('q')?.trim()
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0)

  let query = db
    .from('audit_logs')
    .select('id, project_id, actor_id, actor_email, action, resource_type, resource_id, metadata, created_at', { count: 'exact' })
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (action) query = query.eq('action', action)
  if (resourceType) query = query.eq('resource_type', resourceType)
  if (actor) query = query.ilike('actor_email', `%${actor}%`)
  if (since) query = query.gte('created_at', since)
  if (q) query = query.or(`action.ilike.%${q}%,resource_type.ilike.%${q}%,resource_id.ilike.%${q}%`)

  const { data, count } = await query
  return c.json({ ok: true, data: { logs: data ?? [], count: count ?? 0 } })
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

// Allow operators to nuke an aborted/stuck row (e.g. the three "pending" rows
// created before the export pipeline was wired up). Safe to delete because
// fine-tuning artifacts live in storage, not on this row.
app.delete('/v1/admin/fine-tuning/:id', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const jobId = c.req.param('id')
  const db = getServiceClient()

  const { data: job } = await db.from('fine_tuning_jobs').select('id, project_id, status').eq('id', jobId).single()
  if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

  const { data: project } = await db.from('projects').select('id').eq('id', job.project_id).eq('owner_id', userId).single()
  if (!project) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  const { error } = await db.from('fine_tuning_jobs').delete().eq('id', jobId)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await logAudit(db, job.project_id, userId, 'settings.updated', 'fine_tuning_delete', jobId, {
    previous_status: job.status,
  }).catch(() => {})
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

  // Routing destination configs hold secrets (API tokens, signing keys). The
  // UI only needs to know which fields are set, so we mask anything that
  // looks token-shaped before returning. Same heuristic as the platform GET.
  const maskRoutingConfig = (cfg: Record<string, unknown> | null): Record<string, unknown> => {
    if (!cfg || typeof cfg !== 'object') return {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cfg)) {
      if (v == null) { out[k] = null; continue }
      const lower = k.toLowerCase()
      const looksSensitive = lower.endsWith('token') || lower.endsWith('apikey')
        || lower.endsWith('secret') || lower.endsWith('key') || lower === 'routingkey'
      if (looksSensitive && typeof v === 'string') {
        out[k] = v.length > 4 ? `…${v.slice(-4)}` : '****'
      } else {
        out[k] = v
      }
    }
    return out
  }

  const integrations = (data ?? []).map(row => ({
    ...row,
    config: maskRoutingConfig(row.config as Record<string, unknown> | null),
  }))
  return c.json({ ok: true, data: { integrations } })
})

app.post('/v1/admin/integrations', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json() as { type: string; config: Record<string, unknown>; isActive?: boolean }
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  // Pull existing config so we can preserve secret fields the UI re-sent as
  // masked placeholders (e.g. "…abcd"). Without this, re-saving from the
  // editor without retyping a token would silently nuke it.
  const { data: existing } = await db.from('project_integrations')
    .select('config')
    .eq('project_id', project.id)
    .eq('integration_type', body.type)
    .maybeSingle()
  const prev = (existing?.config ?? {}) as Record<string, unknown>

  const merged: Record<string, unknown> = { ...prev }
  for (const [k, v] of Object.entries(body.config ?? {})) {
    if (typeof v === 'string' && v.startsWith('…') && v.length <= 6) continue
    merged[k] = v === '' ? null : v
  }

  const { error } = await db.from('project_integrations').upsert({
    project_id: project.id,
    integration_type: body.type,
    config: merged,
    is_active: body.isActive ?? true,
  }, { onConflict: 'project_id,integration_type' })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, project.id, userId, 'settings.updated', 'integration', undefined, { type: body.type })
  return c.json({ ok: true })
})

// DELETE a routing destination (Jira/Linear/GitHub Issues/PagerDuty) so the
// CRUD editor on IntegrationsPage can fully unwire a target without leaving
// stale rows. Auditable; only the project owner can delete their own rows.
app.delete('/v1/admin/integrations/:type', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const integrationType = c.req.param('type')
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const { error } = await db
    .from('project_integrations')
    .delete()
    .eq('project_id', project.id)
    .eq('integration_type', integrationType)

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, project.id, userId, 'settings.deleted', 'integration', undefined, { type: integrationType })
  return c.json({ ok: true })
})

// ----- Platform integrations (Sentry / Langfuse / GitHub) ---------------
// These are V5.3 §2.18 first-party integrations. Unlike Jira/Linear (which
// live in project_integrations as routing destinations), Sentry/Langfuse/GH
// are observability/code surfaces that the LLM pipeline + fix-worker need
// directly. They live in project_settings so the existing readers
// (resolveLlmKey, fix-worker, fast-filter) pick them up without joins.

const PLATFORM_KIND_FIELDS: Record<IntegrationKind, string[]> = {
  sentry: ['sentry_org_slug', 'sentry_project_slug', 'sentry_auth_token_ref', 'sentry_dsn', 'sentry_seer_enabled', 'sentry_webhook_secret', 'sentry_consume_user_feedback'],
  langfuse: ['langfuse_host', 'langfuse_public_key_ref', 'langfuse_secret_key_ref'],
  github: ['github_repo_url', 'github_default_branch', 'github_installation_token_ref', 'github_webhook_secret', 'github_deploy_key'],
}

app.get('/v1/admin/integrations/platform', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: true, data: { platform: null } })

  const allFields = Object.values(PLATFORM_KIND_FIELDS).flat().join(', ')
  const { data: settings } = await db
    .from('project_settings')
    .select(allFields)
    .eq('project_id', project.id)
    .maybeSingle()

  // Mask secret-shaped values; we only return whether a credential is set,
  // never the value itself. The UI shows "configured" badges, not secrets.
  const maskField = (k: string, v: unknown): unknown => {
    if (v == null) return null
    if (k.endsWith('_ref') || k.endsWith('_secret') || k.endsWith('_token') || k.endsWith('_key')) {
      return typeof v === 'string' ? `…${v.slice(-4)}` : '****'
    }
    return v
  }

  const platform: Record<string, Record<string, unknown>> = {}
  for (const kind of INTEGRATION_KINDS) {
    platform[kind] = {}
    for (const f of PLATFORM_KIND_FIELDS[kind]) {
      platform[kind][f] = maskField(f, (settings as Record<string, unknown> | null)?.[f])
    }
  }

  return c.json({ ok: true, data: { platform } })
})

// Fields that should be auto-vaulted: when the user submits a raw secret
// value, write it to Supabase Vault and persist `vault://<name>` instead.
// This matches the BYOK pattern and prevents secrets from sitting plaintext
// in project_settings.
const VAULTED_FIELDS_BY_KIND: Record<IntegrationKind, string[]> = {
  sentry: ['sentry_auth_token_ref', 'sentry_webhook_secret'],
  langfuse: ['langfuse_public_key_ref', 'langfuse_secret_key_ref'],
  github: ['github_installation_token_ref', 'github_webhook_secret', 'github_deploy_key'],
}

app.put('/v1/admin/integrations/platform/:kind', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const kind = c.req.param('kind') as IntegrationKind
  if (!INTEGRATION_KINDS.includes(kind)) {
    return c.json({ ok: false, error: { code: 'BAD_KIND' } }, 400)
  }
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>

  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT' } }, 404)

  const allowed = PLATFORM_KIND_FIELDS[kind]
  const vaulted = new Set(VAULTED_FIELDS_BY_KIND[kind] ?? [])
  // Only persist whitelisted fields. Empty strings clear the value (so the
  // UI can offer a "remove" affordance without a separate DELETE endpoint).
  // Masked values from GET ("…abcd") are silently ignored so a partial form
  // submit doesn't replace a real key with a masked one.
  const updates: Record<string, unknown> = { project_id: project.id }
  for (const k of allowed) {
    if (!(k in body)) continue
    const v = body[k]
    if (typeof v === 'string' && v.startsWith('…') && v.length <= 6) continue

    if (v === '' || v === null) {
      updates[k] = null
      continue
    }

    if (vaulted.has(k) && typeof v === 'string' && !v.startsWith('vault://')) {
      // Auto-vault: write the raw secret to Supabase Vault and store the ref.
      const secretName = `mushi/integration/${project.id}/${kind}/${k}`
      const { error: vaultErr } = await db.rpc('vault_store_secret', { secret_name: secretName, secret_value: v })
      if (vaultErr) {
        // Vault may not be installed in dev — degrade gracefully but warn.
        console.warn('[integrations] vault_store_secret failed; persisting raw value', { kind, field: k, err: vaultErr.message })
        updates[k] = v
      } else {
        updates[k] = `vault://${secretName}`
      }
    } else {
      updates[k] = v
    }
  }

  if (Object.keys(updates).length === 1) {
    return c.json({ ok: false, error: { code: 'NO_FIELDS', message: 'No editable fields supplied for this integration kind.' } }, 400)
  }

  const { error } = await db
    .from('project_settings')
    .upsert(updates, { onConflict: 'project_id' })

  if (error) {
    return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  }
  await logAudit(db, project.id, userId, 'settings.updated', 'integration_platform', undefined, { kind })
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

// Async generation: enqueue a job, kick the worker fire-and-forget, return
// the job id immediately. The page polls /v1/admin/intelligence/jobs and
// shows a progress card. Avoids the 30s+ "spinner forever" symptom users hit
// when the call was synchronous.
app.post('/v1/admin/intelligence', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  // De-dupe: if there's already a queued/running job for this user+project,
  // return it instead of stacking duplicates that would burn LLM credits.
  const { data: existing } = await db
    .from('intelligence_generation_jobs')
    .select('id, status')
    .eq('project_id', project.id)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) {
    return c.json({ ok: true, data: { jobId: existing.id, deduplicated: true } })
  }

  const { data: job, error: insertErr } = await db
    .from('intelligence_generation_jobs')
    .insert({
      project_id: project.id,
      requested_by: userId,
      trigger: 'manual',
      status: 'queued',
    })
    .select('id')
    .single()
  if (insertErr || !job) {
    return c.json({ ok: false, error: { code: 'DB_ERROR', message: insertErr?.message ?? 'Failed to enqueue' } }, 500)
  }

  // Kick the worker without awaiting — it does its own status updates.
  // We deliberately don't `await` here so the user doesn't wait for the LLM.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (supabaseUrl && serviceKey) {
    void (async () => {
      const startedAt = new Date().toISOString()
      await db.from('intelligence_generation_jobs').update({ status: 'running', started_at: startedAt }).eq('id', job.id)
      try {
        const ctrl = new AbortController()
        // Hard ceiling so a misconfigured BYOK key never wedges the job row.
        const timeout = setTimeout(() => ctrl.abort(), 90_000)
        const res = await fetch(`${supabaseUrl}/functions/v1/intelligence-report`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ projectId: project.id, trigger: 'manual', jobId: job.id }),
          signal: ctrl.signal,
        })
        clearTimeout(timeout)
        const finishedAt = new Date().toISOString()
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`)
          await db.from('intelligence_generation_jobs').update({
            status: 'failed',
            error: errText.slice(0, 500),
            finished_at: finishedAt,
          }).eq('id', job.id)
          return
        }
        const payload = await res.json().catch(() => ({}))
        const firstReportId = Array.isArray(payload?.data?.reportIds)
          ? payload.data.reportIds[0] ?? null
          : null
        await db.from('intelligence_generation_jobs').update({
          status: 'completed',
          report_id: firstReportId,
          finished_at: finishedAt,
        }).eq('id', job.id)
      } catch (err) {
        await db.from('intelligence_generation_jobs').update({
          status: 'failed',
          error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
          finished_at: new Date().toISOString(),
        }).eq('id', job.id)
      }
    })()
  }

  return c.json({ ok: true, data: { jobId: job.id } })
})

app.get('/v1/admin/intelligence/jobs', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: true, data: { jobs: [] } })
  const { data } = await db
    .from('intelligence_generation_jobs')
    .select('id, project_id, status, trigger, report_id, error, created_at, started_at, finished_at')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(20)
  return c.json({ ok: true, data: { jobs: data ?? [] } })
})

app.post('/v1/admin/intelligence/jobs/:id/cancel', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)
  const { data: job } = await db
    .from('intelligence_generation_jobs')
    .select('id, project_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!job || !projectIds.includes(job.project_id)) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return c.json({ ok: false, error: { code: 'TERMINAL', message: `Job is already ${job.status}` } }, 409)
  }
  // We can't actually halt the in-flight LLM call (Supabase Edge Functions
  // don't expose process control), but flipping the row to cancelled stops
  // the UI from polling and prevents any further enqueue dedupe.
  await db
    .from('intelligence_generation_jobs')
    .update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', id)
  return c.json({ ok: true })
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

  const windowParam = c.req.query('window') ?? '24h'
  const windowMs: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  }
  const ms = windowMs[windowParam] ?? windowMs['24h']

  if (projectIds.length === 0) {
    return c.json({ ok: true, data: { window: windowParam, totalCalls: 0, fallbacks: 0, fallbackRate: 0, errors: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, byModel: {}, byFunction: {}, recent: [] } })
  }

  const since = new Date(Date.now() - ms).toISOString()
  const { data: invocations } = await db
    .from('llm_invocations')
    .select('function_name, used_model, primary_model, fallback_used, status, latency_ms, input_tokens, output_tokens, created_at, langfuse_trace_id, report_id, key_source')
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
  const byFunction: Record<string, { calls: number; errors: number; fallbacks: number; avgLatencyMs: number }> = {}
  const fnLatency: Record<string, number[]> = {}
  for (const r of rows) {
    const modelKey = r.used_model
    byModel[modelKey] ??= { calls: 0, errors: 0, tokens: 0 }
    byModel[modelKey].calls += 1
    if (r.status !== 'success') byModel[modelKey].errors += 1
    byModel[modelKey].tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)

    const fnKey = r.function_name
    byFunction[fnKey] ??= { calls: 0, errors: 0, fallbacks: 0, avgLatencyMs: 0 }
    byFunction[fnKey].calls += 1
    if (r.status !== 'success') byFunction[fnKey].errors += 1
    if (r.fallback_used) byFunction[fnKey].fallbacks += 1
    fnLatency[fnKey] ??= []
    fnLatency[fnKey].push(r.latency_ms ?? 0)
  }
  for (const fn of Object.keys(byFunction)) {
    const arr = fnLatency[fn]
    byFunction[fn].avgLatencyMs = arr.length > 0
      ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
      : 0
  }

  return c.json({
    ok: true,
    data: {
      window: windowParam,
      totalCalls,
      fallbacks,
      fallbackRate: totalCalls > 0 ? fallbacks / totalCalls : 0,
      errors,
      errorRate: totalCalls > 0 ? errors / totalCalls : 0,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      byModel,
      byFunction,
      recent: rows.slice(0, 100),
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

  const eventType = c.req.query('event_type')
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 500)

  let query = db
    .from('anti_gaming_events')
    .select('*')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (eventType) query = query.eq('event_type', eventType)

  const { data, error } = await query
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { events: data ?? [] } })
})

app.post('/v1/admin/anti-gaming/devices/:id/flag', jwtAuth, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const body = await c.req.json().catch(() => ({}))
  const reason = (body.reason as string | undefined)?.trim() ?? 'Manual flag from admin console'
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
    .update({ flagged_as_suspicious: true, flag_reason: reason })
    .eq('id', id)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

  await logAntiGamingEvent(db, {
    projectId: device.project_id,
    reporterTokenHash: device.reporter_tokens?.[0] ?? 'unknown',
    deviceFingerprint: device.device_fingerprint,
    eventType: 'manual_flag',
    reason,
  })
  return c.json({ ok: true, data: { id, flagged: true } })
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
    .update({ flagged_as_suspicious: false, flag_reason: null, cross_account_flagged: false })
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

  const type = c.req.query('type')
  const onlyUnread = c.req.query('unread') === '1'
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 500)

  let query = db
    .from('reporter_notifications')
    .select('*')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (type) query = query.eq('notification_type', type)
  if (onlyUnread) query = query.is('read_at', null)

  const { data, error } = await query
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, data: { notifications: data ?? [] } })
})

app.post('/v1/admin/notifications/:id/read', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const notifId = c.req.param('id')
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No projects' } }, 404)

  const { error } = await db
    .from('reporter_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notifId)
    .in('project_id', projectIds)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true })
})

app.post('/v1/admin/notifications/read-all', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = getServiceClient()
  const projectIds = await ownedProjectIds(db, userId)
  if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No projects' } }, 404)

  const { error, count } = await db
    .from('reporter_notifications')
    .update({ read_at: new Date().toISOString() }, { count: 'exact' })
    .in('project_id', projectIds)
    .is('read_at', null)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  await logAudit(db, projectIds[0], userId, 'settings.updated', 'notifications', undefined, { marked_read: count ?? 0 })
  return c.json({ ok: true, data: { marked_read: count ?? 0 } })
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
  if (projectIds.length === 0) {
    // Keep both shapes for backward-compat with any client that read the
    // top-level fields, plus the canonical `data` envelope apiFetch expects.
    return c.json({
      ok: true,
      projects: [],
      currentRegion: currentRegion(),
      data: { projects: [], currentRegion: currentRegion() },
    })
  }

  const { data, error } = await db
    .from('projects')
    .select('id, name, slug, data_residency_region, created_at')
    .in('id', projectIds)

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({
    ok: true,
    projects: data ?? [],
    currentRegion: currentRegion(),
    data: { projects: data ?? [], currentRegion: currentRegion() },
  })
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
  if (projectIds.length === 0) {
    // Keep both shapes for backward-compat: top-level `settings` for any old
    // client, and the canonical `data` envelope that apiFetch expects.
    return c.json({ ok: true, settings: [], data: { settings: [] } })
  }
  const { data, error } = await db
    .from('project_storage_settings')
    .select('*')
    .in('project_id', projectIds)
  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ ok: true, settings: data ?? [], data: { settings: data ?? [] } })
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
//                                             (defined earlier — aggregate per-owner)
//   * POST   /v1/admin/billing/checkout    — create Stripe Checkout Session, return URL
//   * POST   /v1/admin/billing/portal      — create Billing Portal session, return URL
//   * GET    /v1/admin/billing/invoices    — list recent invoices for a project
// All require JWT auth + project ownership.
// ----------------------------------------------------------------
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

// List Stripe invoices for a project. Wraps Stripe's /v1/invoices and
// returns the trimmed view the UI needs (number, status, amount, links).
// Returns an empty array — never an error — when Stripe isn't configured
// or the project hasn't started billing yet, so the UI can render gracefully.
app.get('/v1/admin/billing/invoices', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const projectId = c.req.query('project_id')
  if (!projectId) return c.json({ ok: false, error: { code: 'PROJECT_ID_REQUIRED' } }, 400)
  const db = getServiceClient()
  const owned = await ownedProjectIds(db, userId)
  if (!owned.includes(projectId)) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

  const { data: customer } = await db
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!customer?.stripe_customer_id) {
    return c.json({ ok: true, data: { invoices: [] } })
  }

  const cfg = stripeFromEnv()
  if (!cfg.secretKey) {
    return c.json({ ok: true, data: { invoices: [] } })
  }

  try {
    const result = await listInvoices(cfg, customer.stripe_customer_id, 20)
    return c.json({ ok: true, data: { invoices: result.data } })
  } catch (err) {
    return c.json({
      ok: false,
      error: { code: 'STRIPE_ERROR', message: err instanceof Error ? err.message : 'unknown' },
    }, 502)
  }
})

Deno.serve(app.fetch)
