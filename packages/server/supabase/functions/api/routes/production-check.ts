/**
 * FILE: packages/server/supabase/functions/api/routes/production-check.ts
 * PURPOSE: The free Production Check (docs site /check), served by api-ext.
 *
 *   POST /v1/public/production-check      { url, email?, src? } → 202 { id, status }
 *   GET  /v1/public/production-check/:id  the report (never the email, IP hash or src)
 *
 * What it checks is in `_shared/production-check.ts`: public pages only, on
 * Mushi's own Firecrawl key (the self project's key from `resolveFirecrawl`,
 * never a visitor's; no key = 503). Caps, in the order they are spent:
 *   1. the address must be public (`checkPublicUrl` + DNS), re-checked on
 *      every redirect inside the check;
 *   2. one check per origin per 24 h: a repeat gets the earlier report and
 *      spends nothing (`production_check_begin` claims the origin under a
 *      lock, so two POSTs at once cannot both run);
 *   3. 5 new checks per IP per hour and 100 per day overall
 *      (`scoped_rate_limit_claim`; the IP only as an HMAC; fail closed);
 *   4. 4 Firecrawl credits per check (home page + 3 pages), 25 s overall.
 * The check runs after the response; the page polls the GET. With an email,
 * one plain-text email with the report link goes out and the address is
 * cleared. Events: production_check_started / production_check_finished.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { runInBackground } from '../../_shared/background.ts'
import { resolveFirecrawl } from '../../_shared/firecrawl.ts'
import { emitProductEvent } from '../../_shared/product-events.ts'
import { sendTransactionalEmail } from '../../_shared/email.ts'
import { renderEmailHtml, renderEmailText, type EmailDoc } from '../../_shared/email-layout.ts'
import { hmacSha256Hex } from '../../_shared/connectors/jwt.ts'
import { clientIpOf, verifiedClientIp } from '../../_shared/edge-proxy.ts'
import { checkPublicUrl, resolvesPublic, runtimeResolver } from '../../_shared/public-url-guard.ts'
import { runProductionCheck, severityCounts, type CheckResult } from '../../_shared/production-check.ts'

const plog = log.child('production-check')

export const CHECKS_PER_IP_PER_HOUR = 5
export const CHECKS_PER_DAY = 100
/** A running check older than this is treated as failed (its isolate died). */
export const RUNNING_STALE_MS = 2 * 60_000
const REPORT_PAGE = 'https://kensaur.us/mushi-mushi/docs/check'
const SIGNUP_FROM_EMAIL = 'https://kensaur.us/mushi-mushi/admin/signup?src=check-email'
/** Findings shown in the email itself; the rest are in the report. */
export const EMAIL_MAX_FINDINGS = 5
/** Fixed actor for the global daily budget in scoped_rate_limits. */
const GLOBAL_ACTOR = '00000000-0000-4000-8000-0000000c4ec0'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i

type Db = ReturnType<typeof getServiceClient>

export function reportUrl(id: string): string {
  return `${REPORT_PAGE}?id=${id}`
}

/**
 * The visitor's IP: the one `api` signed when it forwarded the request
 * (`edge-proxy.ts`; this function's own Cloudflare header may be `api`'s
 * address), else Cloudflare's header, else the rightmost X-Forwarded-For hop.
 */
export async function callerIp(header: (name: string) => string | undefined, secret: string | undefined): Promise<string> {
  return (await verifiedClientIp(header, secret)) ?? clientIpOf(header) ?? 'unknown'
}

/** HMAC of the IP: stored and used as the rate-limit actor; the IP itself never is. */
export async function hashIp(ip: string, secret: string): Promise<string> {
  return hmacSha256Hex(secret, `production-check-ip:${ip}`)
}

function actorFromHash(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

/** 'ok', 'limited', or 'error' (the claim itself failed; callers fail closed). */
async function claim(db: Db, actor: string, scope: string, max: number, window: string): Promise<'ok' | 'limited' | 'error'> {
  const { error } = await db.rpc('scoped_rate_limit_claim', { p_user_id: actor, p_scope: scope, p_max_per_window: max, p_window: window })
  if (!error) return 'ok'
  if ((error.message ?? '').includes('rate_limit_exceeded')) return 'limited'
  plog.warn('rate limit claim failed; refusing the check', { scope, err: error.message })
  return 'error'
}

function isFresh(row: { status: string; created_at: string }, now: number): boolean {
  if (row.status === 'done') return true
  return row.status === 'running' && now - Date.parse(row.created_at) < RUNNING_STALE_MS
}

function cleanSrc(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(v) ? v : null
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** What passed, in plain words, for a report with nothing to fix. */
function passedChecks(summary: CheckResult['summary']): string[] {
  const out: string[] = []
  const ok = summary.pages.filter((p) => p.status !== null && p.status < 400).length
  if (summary.pages.length) out.push(`${plural(ok, 'page', 'pages')} of ${summary.pages.length} opened without an error`)
  const headers = Object.values(summary.headers)
  if (headers.length && headers.every(Boolean)) out.push(`All ${headers.length} security headers are sent`)
  if (summary.https === 'ok') out.push('http:// sends visitors to https://')
  if (summary.linksChecked) out.push(`${plural(summary.linksChecked, 'link', 'links')} checked, none broken`)
  if (summary.scriptsChecked && summary.scriptsWithSourceMaps === 0) out.push('No source maps published')
  return out
}

/**
 * The one report email: the findings themselves (worst first, at most
 * EMAIL_MAX_FINDINGS), or what passed, then one button to the full report.
 */
export function buildReportEmail(
  host: string,
  id: string,
  result: Pick<CheckResult, 'findings'> & { summary?: CheckResult['summary'] },
): { subject: string; text: string; html: string } {
  const c = severityCounts(result.findings)
  const n = result.findings.length
  const shown = [...result.findings]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, EMAIL_MAX_FINDINGS)
  const counts = [c.high && `${c.high} to fix first`, c.medium && `${c.medium} to fix soon`, c.low && `${c.low} nice to fix`]
    .filter(Boolean)
    .join(', ')
  const doc: EmailDoc = n
    ? {
        preheader: `${counts}. Each one comes with how to fix it.`,
        heading: `${plural(n, 'thing', 'things')} to fix on ${host}`,
        blocks: [
          { kind: 'p', text: `Mushi read the public pages of ${host} the way a first-time visitor sees them: ${counts}.` },
          {
            kind: 'findings',
            rows: shown.map((f) => ({ severity: f.severity, title: f.title, detail: `How to fix: ${f.fix}` })),
            ...(n > shown.length ? { more: `And ${n - shown.length} more in the full report.` } : {}),
          },
          { kind: 'button', label: 'Open the full report', url: reportUrl(id) },
          {
            kind: 'p',
            text: 'Want this caught before your users hit it? Mushi watches your live app, explains each bug in plain English and opens a reviewed fix. Free for one app:',
          },
          { kind: 'link', label: 'Set up Mushi', url: SIGNUP_FROM_EMAIL },
        ],
        footer: [
          'You asked for this email on the Mushi Production Check page. It is the only one you will get about this check: your address is not on any mailing list, and it was deleted after this email was sent.',
        ],
      }
    : {
        preheader: `Nothing to fix on the pages Mushi could read.`,
        heading: `${host} passed the Production Check`,
        blocks: [
          { kind: 'p', text: `Mushi read the public pages of ${host} the way a first-time visitor sees them and found nothing to fix.` },
          ...(result.summary ? [{ kind: 'checks' as const, items: passedChecks(result.summary) }] : []),
          { kind: 'button', label: 'Open the full report', url: reportUrl(id) },
          {
            kind: 'p',
            text: 'A clean first visit is half of it; the other half is the bugs your users hit after they sign in. Mushi turns their reports into plain-English diagnoses and reviewed fixes. Free for one app:',
          },
          { kind: 'link', label: 'Set up Mushi', url: SIGNUP_FROM_EMAIL },
        ],
        footer: [
          'You asked for this email on the Mushi Production Check page. It is the only one you will get about this check: your address is not on any mailing list, and it was deleted after this email was sent.',
        ],
      }
  return {
    subject: n ? `${host}: ${plural(n, 'thing', 'things')} to fix (Production Check)` : `${host} passed the Production Check`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
  }
}

export interface RunDeps {
  run?: typeof runProductionCheck
  send?: typeof sendTransactionalEmail
  emit?: typeof emitProductEvent
  selfProjectId: string
}

/** One report email; true only when the provider accepted it. */
async function sendReportEmail(
  to: string,
  url: string,
  id: string,
  result: Pick<CheckResult, 'findings'> & { summary?: CheckResult['summary'] },
  send: typeof sendTransactionalEmail = sendTransactionalEmail,
): Promise<boolean> {
  const mail = buildReportEmail(new URL(url).host, id, result)
  const sent = await send({ to, subject: mail.subject, text: mail.text, html: mail.html, tags: { kind: 'production_check' } })
  if (!sent.ok) plog.warn('report email not sent', { checkId: id, reason: sent.reason })
  return sent.ok
}

/** Run one check and store its outcome; then the email, then the event. */
export async function runAndStore(
  db: Db,
  row: { id: string; url: string; email: string | null; src: string | null },
  firecrawlKey: string,
  deps: RunDeps,
): Promise<void> {
  const run = deps.run ?? runProductionCheck
  let result: CheckResult | null = null
  let failure: string | null = null
  try {
    result = await run(row.url, { firecrawlKey, resolver: runtimeResolver() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    plog.warn('production check failed', { checkId: row.id, err: msg.slice(0, 200) })
    failure = /FIRECRAWL_(NO_CREDITS|HTTP_40[123]|HTTP_429)/.test(msg)
      ? 'The checker is out of capacity right now. Try again tomorrow.'
      : 'The check could not finish. Try again in a few minutes.'
  }
  const finishedAt = new Date().toISOString()
  const { error } = await db
    .from('production_checks')
    .update(
      result
        ? { status: 'done', findings: result.findings, summary: result.summary, finished_at: finishedAt }
        : { status: 'failed', error: failure, finished_at: finishedAt },
    )
    .eq('id', row.id)
  if (error) plog.warn('could not store the check', { checkId: row.id, err: error.message })

  let emailed = false
  if (result && row.email) {
    emailed = await sendReportEmail(row.email, row.url, row.id, result, deps.send)
  }
  if (row.email) {
    // One email only: the address is not kept after the attempt.
    await db.from('production_checks').update({ email: null, email_sent_at: emailed ? new Date().toISOString() : null }).eq('id', row.id)
  }

  const counts = result ? severityCounts(result.findings) : { high: 0, medium: 0, low: 0 }
  await (deps.emit ?? emitProductEvent)(db, {
    eventName: 'production_check_finished',
    surface: 'server',
    dedupKey: `production_check_finished:${row.id}`,
    properties: {
      project_id: deps.selfProjectId,
      outcome: result ? 'done' : 'failed',
      // false when Firecrawl could not render the home page (the report then
      // rests on the plain fetch only), so a broken key or API shows in the funnel.
      rendered: result ? result.summary.rendered : false,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      src: row.src,
    },
  })
}

export function registerProductionCheckRoutes(app: Hono<{ Variables: Variables }>) {
  app.post('/v1/public/production-check', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { url?: unknown; email?: unknown; src?: unknown } | null
    const checked = checkPublicUrl(body?.url)
    if (!checked.ok) return c.json({ ok: false, error: { code: checked.code, message: checked.message } }, 400)
    const dnsOk = await resolvesPublic(checked.url.hostname, runtimeResolver(), (err) =>
      plog.warn('DNS lookup failed; hostname rules only', { err: String(err).slice(0, 200) }),
    )
    if (!dnsOk) {
      return c.json({ ok: false, error: { code: 'NOT_PUBLIC', message: 'That address does not lead to a public website we can reach.' } }, 400)
    }
    let email: string | null = null
    if (typeof body?.email === 'string' && body.email.trim()) {
      email = body.email.trim().toLowerCase()
      if (email.length > 254 || !EMAIL_RE.test(email)) {
        return c.json({ ok: false, error: { code: 'INVALID_EMAIL', message: 'That email address does not look right. Leave it empty to skip the email.' } }, 400)
      }
    }
    const src = cleanSrc(body?.src)
    const origin = checked.origin
    const db = getServiceClient()

    // A report for this site from the last 24 h: hand it back, spend nothing.
    const { data: recent, error: recentErr } = await db
      .from('production_checks')
      .select('id, status, created_at')
      .eq('origin', origin)
      .gt('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5)
    if (recentErr) {
      plog.warn('recent-check read failed', { err: recentErr.message })
      return c.json({ ok: false, error: { code: 'UNAVAILABLE', message: 'The check is not available right now. Try again in a minute.' } }, 503)
    }
    const hit = (recent ?? []).find((r) => isFresh(r as { status: string; created_at: string }, Date.now())) as { id: string; status: string } | undefined

    // Keyed with a server secret every edge function has, so the stored hash
    // cannot be reversed by hashing the IPv4 space.
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined
    const visitorHash = async () => hashIp(await callerIp((n) => c.req.header(n), secret), secret ?? 'mushi-production-check')

    if (hit) {
      // The site was checked today: its report, and the email when asked for.
      // Sending spends the visitor's hourly budget, so a cached site cannot be
      // used to mail any number of addresses. A check still running has no
      // report to send yet (and its row must not take a second address).
      let emailed = false
      if (email && hit.status === 'done') {
        const spend = await claim(db, actorFromHash(await visitorHash()), 'production_check_ip', CHECKS_PER_IP_PER_HOUR, '1 hour')
        if (spend === 'ok') {
          const { data: done } = await db.from('production_checks').select('findings, summary').eq('id', hit.id).maybeSingle()
          if (done) {
            const row = done as { findings?: unknown; summary?: unknown }
            const findings = (row.findings ?? []) as CheckResult['findings']
            const summary = (row.summary && typeof row.summary === 'object' && Array.isArray((row.summary as CheckResult['summary']).pages)) ? row.summary as CheckResult['summary'] : undefined
            runInBackground(sendReportEmail(email, checked.url.href, hit.id, { findings, summary }), 'production-check-email')
            emailed = true
          }
        }
      }
      return c.json({ ok: true, data: { id: hit.id, status: hit.status, cached: true, emailed } })
    }

    const selfProjectId = Deno.env.get('MUSHI_SELF_PROJECT_ID') ?? ''
    const firecrawl = selfProjectId ? await resolveFirecrawl(db, selfProjectId) : null
    if (!firecrawl) {
      return c.json({ ok: false, error: { code: 'CHECK_UNAVAILABLE', message: 'The Production Check is switched off right now. Try again later.' } }, 503)
    }

    const ipHash = await visitorHash()
    const perIp = await claim(db, actorFromHash(ipHash), 'production_check_ip', CHECKS_PER_IP_PER_HOUR, '1 hour')
    if (perIp !== 'ok') {
      c.header('Retry-After', perIp === 'limited' ? '3600' : '60')
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: perIp === 'limited' ? `You can run ${CHECKS_PER_IP_PER_HOUR} checks an hour. Try again later.` : 'The check is not available right now. Try again in a minute.' } },
        perIp === 'limited' ? 429 : 503,
      )
    }
    const global = await claim(db, GLOBAL_ACTOR, 'production_check_global', CHECKS_PER_DAY, '1 day')
    if (global !== 'ok') {
      c.header('Retry-After', '3600')
      return c.json({ ok: false, error: { code: 'DAILY_LIMIT', message: 'Today\'s free checks are used up. Try again tomorrow.' } }, global === 'limited' ? 429 : 503)
    }

    const { data: begun, error: beginErr } = await db.rpc('production_check_begin', {
      p_origin: origin,
      p_url: checked.url.href,
      p_ip_hash: ipHash,
      p_email: email,
      p_src: src,
    })
    const row = (Array.isArray(begun) ? begun[0] : begun) as { check_id?: string; cached?: boolean } | null
    if (beginErr || !row?.check_id) {
      plog.warn('production_check_begin failed', { err: beginErr?.message })
      return c.json({ ok: false, error: { code: 'UNAVAILABLE', message: 'The check is not available right now. Try again in a minute.' } }, 503)
    }
    if (row.cached) return c.json({ ok: true, data: { id: row.check_id, status: 'running', cached: true, emailed: false } })

    void emitProductEvent(db, {
      eventName: 'production_check_started',
      surface: 'server',
      dedupKey: `production_check_started:${row.check_id}`,
      properties: { project_id: selfProjectId, src },
    })
    runInBackground(
      runAndStore(db, { id: row.check_id, url: checked.url.href, email, src }, firecrawl.key, { selfProjectId }),
      'production-check',
    )
    return c.json({ ok: true, data: { id: row.check_id, status: 'running', cached: false, emailed: email !== null } }, 202)
  })

  app.get('/v1/public/production-check/:id', async (c) => {
    const id = c.req.param('id') ?? ''
    if (!UUID_RE.test(id)) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No such check.' } }, 404)
    const db = getServiceClient()
    const { data, error } = await db
      .from('production_checks')
      .select('id, url, status, findings, summary, error, created_at, finished_at')
      .eq('id', id)
      .maybeSingle()
    if (error) return c.json({ ok: false, error: { code: 'UNAVAILABLE', message: 'Could not load the report. Try again in a minute.' } }, 503)
    if (!data) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No such check. Reports are kept for 90 days.' } }, 404)
    // Named fields only: the email, IP hash and src never leave, whatever the select returns.
    const d = data as Record<string, unknown>
    const row = {
      id: d.id as string,
      url: d.url as string,
      status: d.status as string,
      findings: d.findings,
      summary: d.summary,
      error: (d.error as string | null) ?? null,
      created_at: d.created_at as string,
      finished_at: (d.finished_at as string | null) ?? null,
    }
    if (row.status === 'running' && Date.now() - Date.parse(row.created_at) >= RUNNING_STALE_MS) {
      row.status = 'failed'
      row.error = 'The check ran out of time. Try again in a few minutes.'
      await db.from('production_checks').update({ status: 'failed', error: row.error, finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'running')
    }
    c.header('Cache-Control', row.status === 'running' ? 'no-store' : 'public, max-age=300')
    return c.json({ ok: true, data: row })
  })
}
