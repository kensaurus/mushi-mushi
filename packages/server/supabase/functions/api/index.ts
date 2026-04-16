import { Hono } from 'npm:hono@4'
import { cors } from 'npm:hono@4/cors'
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { apiKeyAuth, jwtAuth } from '../_shared/auth.ts'
import { reportSubmissionSchema } from '../_shared/schemas.ts'
import { checkAntiGaming } from '../_shared/anti-gaming.ts'
import { logAntiGamingEvent } from '../_shared/telemetry.ts'
import { awardPoints, getReputation } from '../_shared/reputation.ts'
import { createNotification, buildNotificationMessage } from '../_shared/notifications.ts'
import { getBlastRadius } from '../_shared/knowledge-graph.ts'
import { logAudit } from '../_shared/audit.ts'
import { createExternalIssue } from '../_shared/integrations.ts'
import { getActivePlugins } from '../_shared/plugins.ts'
import { getAvailableTags } from '../_shared/ontology.ts'
import { executeNaturalLanguageQuery } from '../_shared/nl-query.ts'

// basePath('/api') is required by Supabase Edge Functions: the function name
// is included in the request URL path (https://supabase.com/docs/guides/functions/routing).
const app = new Hono().basePath('/api')

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Mushi-Api-Key', 'X-Mushi-Project', 'X-Sentry-Hook-Signature'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))

app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0' }))

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
        const ext = mimeMatch?.[1] === 'image/png' ? 'png' : 'jpg'
        screenshotPath = `${projectId}/${crypto.randomUUID()}.${ext}`

        const { error: uploadError } = await db.storage
          .from('screenshots')
          .upload(screenshotPath, bytes, { contentType: mimeMatch?.[1] ?? 'image/jpeg', upsert: false })

        if (!uploadError) {
          const { data: urlData } = db.storage.from('screenshots').getPublicUrl(screenshotPath)
          screenshotUrl = urlData?.publicUrl ?? null
        }
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
    const { data: fix } = await db.from('fix_attempts').select('report_id').eq('id', fixId).in('project_id', projectIds).single()
    if (fix) {
      await db.from('reports').update({
        fix_branch: updates.branch as string,
        fix_pr_url: updates.pr_url as string,
        fix_commit_sha: updates.commit_sha as string,
      }).eq('id', fix.report_id).in('project_id', projectIds)
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
    .select('id, project_id, base_model, status, training_samples, fine_tuned_model_id, metrics, started_at, completed_at, created_at')
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  return c.json({ ok: true, data: { jobs: data ?? [] } })
})

app.post('/v1/admin/fine-tuning', jwtAuth, async (c) => {
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const db = getServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('owner_id', userId).limit(1).single()
  if (!project) return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project' } }, 404)

  const { data: job, error } = await db.from('fine_tuning_jobs').insert({
    project_id: project.id,
    base_model: body.baseModel ?? 'claude-sonnet-4-20250514',
    status: 'pending',
  }).select('id').single()

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  await logAudit(db, project.id, userId, 'settings.updated', 'fine_tuning', job!.id, { baseModel: body.baseModel })
  return c.json({ ok: true, data: { jobId: job!.id } })
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

  const { error } = await db.from('project_plugins').upsert({
    project_id: project.id,
    plugin_name: pluginName,
    plugin_version: pluginVersion,
    config: body.config,
    is_active: body.isActive ?? true,
    execution_order: body.executionOrder ?? 0,
  }, { onConflict: 'project_id,plugin_name' })

  if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400)
  await logAudit(db, project.id, userId, 'settings.updated', 'plugin', undefined, { plugin: pluginName })
  return c.json({ ok: true })
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
    body: JSON.stringify({ projectId: project.id }),
  })
  const result = await res.json()
  return c.json({ ok: true, data: result.data })
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

Deno.serve(app.fetch)
