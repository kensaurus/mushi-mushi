// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * site-audit — Supabase Edge Function (verify_jwt = false, internal)
 *
 * The site audit (ADR 0040). Hourly at :29 (pg_cron `mushi-site-audit`), for
 * at most two audits under a 10-minute lease:
 *
 *   1. due and idle: map the live site (Firecrawl /v2/map, 1 credit), keep
 *      the pages under the audit's base URL (at most `page_limit`), and start
 *      a batch scrape (html + links + markdown, fresh, 1 credit a page, the
 *      site watch's user agent). The batch id is stored; the tick ends.
 *   2. a batch in flight: when Firecrawl says completed, read every page,
 *      run the deterministic rules (`_shared/site-audit.ts`), test each link
 *      and image target (HEAD, then GET; a broken one is tested again), and
 *      file one report per failing rule (source 'site_audit'). A rule whose
 *      report is still open only updates its finding; a dismissed one is not
 *      filed again; one whose report was fixed files a new report. Rules
 *      that now pass are marked resolved. The next run is `cadence_days` on.
 *
 * Billed to the project's Firecrawl key (`resolveFirecrawl`, ADR 0023/0031).
 * Auth: `requireServiceRoleAuth`. `POST { auditId }` runs one audit now
 * (the console's "Run now" sets next_run_at and lets the cron pick it up).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveFirecrawl } from '../_shared/firecrawl.ts'
import { SITE_WATCH_USER_AGENT } from '../_shared/site-watch.ts'
import {
  isBrokenStatus,
  isDocumentUrl,
  isUnreadableRender,
  linkFindings,
  linkTargets,
  pageFindings,
  reportDrafts,
  SITE_AUDIT_RULES,
  type AuditPage,
  type PageFinding,
} from '../_shared/site-audit.ts'

const log = rootLog.child('site-audit')

const FIRECRAWL = 'https://api.firecrawl.dev/v2'
const PER_TICK = 2
const LEASE_MS = 10 * 60_000
/** A batch Firecrawl has not finished in this long is given up (results expire after 24 h). */
const BATCH_GIVE_UP_MS = 6 * 3_600_000
const TARGET_BUDGET_MS = 60_000
const TARGET_CONCURRENCY = 12
const CLOSED_STATUSES = new Set(['fixed', 'verified', 'resolved'])

export interface SiteAuditRow {
  id: string
  project_id: string
  enabled: boolean
  base_url: string
  page_limit: number
  cadence_days: number
  next_run_at: string | null
  batch_id: string | null
  batch_started_at: string | null
}

export interface SiteAuditDeps {
  now?: () => Date
  fetch?: typeof fetch
  resolveKey?: (db: SupabaseClient, projectId: string) => Promise<string | null>
}

async function fc(f: typeof fetch, key: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await f(path.startsWith('http') ? path : `${FIRECRAWL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`Firecrawl ${path.split('?')[0]} ${res.status}: ${String(body.error ?? '').slice(0, 200)}`)
  return body
}

/** The pages to scrape: under the base URL, readable documents, at most `limit`, base first. */
export function auditUrls(baseUrl: string, mapped: unknown[], limit: number): string[] {
  const prefix = baseUrl.replace(/\/$/, '')
  const urls = new Set<string>([prefix])
  for (const l of mapped) {
    const url = typeof l === 'string' ? l : (l as { url?: string } | null)?.url
    if (!url) continue
    const clean = url.split('#')[0].replace(/\/$/, '')
    if ((clean === prefix || clean.startsWith(`${prefix}/`)) && isDocumentUrl(clean)) urls.add(clean)
  }
  return [...urls].slice(0, limit)
}

function toPage(raw: Record<string, unknown>): AuditPage | null {
  const m = (raw.metadata ?? {}) as Record<string, unknown>
  const url = (m.sourceURL ?? m.url) as string | undefined
  if (!url) return null
  const str = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null)
  return {
    url: url.replace(/\/$/, ''),
    statusCode: typeof m.statusCode === 'number' ? m.statusCode : null,
    title: str(m.title),
    description: str(m.description),
    language: str(m.language),
    ogImage: str(m.ogImage) ?? str(m['og:image']),
    // Keep only what the rules read, so a 200-page batch of 500 KB pages fits
    // in the edge runtime: the <img> tags, and the lines of the body with kana.
    html: typeof raw.html === 'string' ? (raw.html.match(/<img\b[^>]*>/gi) ?? []).join('') : null,
    markdown:
      typeof raw.markdown === 'string'
        ? raw.markdown
            .split('\n')
            .filter((line) => /[\u3040-\u30FF]/.test(line))
            .join('\n')
        : null,
    links: Array.isArray(raw.links) ? (raw.links as unknown[]).filter((l): l is string => typeof l === 'string') : [],
  }
}

async function testTarget(f: typeof fetch, url: string): Promise<number> {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await f(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': SITE_WATCH_USER_AGENT } })
      // Some servers refuse HEAD; only a GET answer is final for those.
      if (method === 'HEAD' && [403, 404, 405, 501].includes(res.status)) continue
      return res.status
    } catch {
      if (method === 'GET') return -1
    }
  }
  return -1
}

/** Test targets under a time budget; broken ones are tested once more. Untested ones are skipped, never failed. */
export async function testTargets(
  f: typeof fetch,
  targets: Array<{ url: string; pages: string[]; image: boolean }>,
  now: () => Date,
): Promise<{ checked: Array<{ url: string; pages: string[]; image: boolean; status: number }>; skipped: number }> {
  const deadline = now().getTime() + TARGET_BUDGET_MS
  const checked: Array<{ url: string; pages: string[]; image: boolean; status: number }> = []
  let i = 0
  const worker = async () => {
    while (i < targets.length && now().getTime() < deadline) {
      const t = targets[i++]
      checked.push({ ...t, status: await testTarget(f, t.url) })
    }
  }
  await Promise.all(Array.from({ length: TARGET_CONCURRENCY }, worker))
  for (const c of checked) {
    if (isBrokenStatus(c.status) && now().getTime() < deadline) c.status = await testTarget(f, c.url)
  }
  return { checked, skipped: targets.length - checked.length }
}

async function startRun(db: SupabaseClient, d: Required<SiteAuditDeps>, a: SiteAuditRow, key: string): Promise<string> {
  const map = await fc(d.fetch, key, '/map', { method: 'POST', body: JSON.stringify({ url: a.base_url, limit: 1000, sitemap: 'include', includeSubdomains: false }) })
  const urls = auditUrls(a.base_url, (map.links as unknown[]) ?? [], a.page_limit)
  const batch = await fc(d.fetch, key, '/batch/scrape', {
    method: 'POST',
    body: JSON.stringify({
      urls,
      formats: ['html', 'links', 'markdown'],
      onlyMainContent: false,
      maxAge: 0,
      waitFor: 2500,
      timeout: 45_000,
      headers: { 'User-Agent': SITE_WATCH_USER_AGENT },
    }),
  })
  const id = typeof batch.id === 'string' ? batch.id : null
  if (!id) throw new Error('Firecrawl did not return a batch id')
  await db.from('site_audits').update({ batch_id: id, batch_started_at: d.now().toISOString(), last_error: null, claimed_until: null }).eq('id', a.id)
  return `started a batch of ${urls.length} pages`
}

async function readBatch(d: Required<SiteAuditDeps>, key: string, batchId: string): Promise<{ status: string; pages: AuditPage[]; credits: number | null }> {
  let next: string | null = `/batch/scrape/${batchId}`
  const pages: AuditPage[] = []
  let status = 'scraping'
  let credits: number | null = null
  while (next) {
    const body = await fc(d.fetch, key, next)
    status = String(body.status ?? status)
    if (status !== 'completed') return { status, pages: [], credits: null }
    credits = typeof body.creditsUsed === 'number' ? body.creditsUsed : credits
    for (const raw of (body.data as Array<Record<string, unknown>>) ?? []) {
      const p = toPage(raw)
      if (p) pages.push(p)
    }
    next = typeof body.next === 'string' ? body.next : null
  }
  return { status, pages, credits }
}

async function fileFindings(db: SupabaseClient, a: SiteAuditRow, appName: string, findings: PageFinding[], nowIso: string): Promise<number> {
  const drafts = reportDrafts(findings, { appName, baseUrl: a.base_url, checkedAt: nowIso })
  const { data: existing } = await db.from('site_audit_findings').select('id, rule, report_id').eq('audit_id', a.id)
  const byRule = new Map(((existing ?? []) as Array<{ id: string; rule: string; report_id: string | null }>).map((r) => [r.rule, r]))
  let filed = 0
  for (const draft of drafts) {
    const prior = byRule.get(draft.rule)
    let reportId = prior?.report_id ?? null
    if (reportId) {
      const { data: rep } = await db.from('reports').select('status').eq('id', reportId).maybeSingle()
      const status = (rep as { status?: string } | null)?.status ?? null
      // Still open, or dismissed by a person: keep it. Fixed and failing again,
      // or the report was deleted: file a new one.
      if (!status || CLOSED_STATUSES.has(status)) reportId = null
    }
    if (!reportId) {
      const id = crypto.randomUUID()
      const { error } = await db.from('reports').insert({
        id,
        project_id: a.project_id,
        title: draft.title.slice(0, 200),
        description: draft.description.slice(0, 10_000),
        category: 'bug',
        severity: draft.severity,
        status: 'new',
        source: 'site_audit',
        reporter_token_hash: 'site-audit',
        environment: { userAgent: 'site-audit', platform: 'web', language: '', url: a.base_url, referrer: '', timestamp: nowIso, timezone: 'UTC' },
        custom_metadata: { source: 'site_audit', rule: draft.rule, pages: draft.pages, auditId: a.id },
        synced_at: nowIso,
        created_at: nowIso,
      })
      if (error) {
        log.warn('site-audit report insert failed', { auditId: a.id, rule: draft.rule, err: error.message })
        continue
      }
      reportId = id
      filed++
    }
    const evidence = findings.filter((f) => f.rule === draft.rule).slice(0, 50)
    await db
      .from('site_audit_findings')
      .upsert(
        { audit_id: a.id, project_id: a.project_id, rule: draft.rule, pages: draft.pages, evidence, report_id: reportId, last_seen_at: nowIso, resolved_at: null },
        { onConflict: 'audit_id,rule' },
      )
  }
  const failing = new Set(drafts.map((d) => d.rule))
  const passing = SITE_AUDIT_RULES.filter((r) => !failing.has(r) && byRule.has(r))
  if (passing.length) {
    await db.from('site_audit_findings').update({ resolved_at: nowIso }).eq('audit_id', a.id).in('rule', passing).is('resolved_at', null)
  }
  return filed
}

async function finishRun(db: SupabaseClient, d: Required<SiteAuditDeps>, a: SiteAuditRow, key: string): Promise<string> {
  const now = d.now()
  const started = a.batch_started_at ? Date.parse(a.batch_started_at) : now.getTime()
  const batch = await readBatch(d, key, a.batch_id!)
  if (batch.status !== 'completed') {
    if (batch.status === 'failed' || now.getTime() - started > BATCH_GIVE_UP_MS) {
      await db.from('site_audits').update({ batch_id: null, batch_started_at: null, claimed_until: null, last_error: `Firecrawl batch ${batch.status}; the next run starts fresh.`, next_run_at: new Date(now.getTime() + 3_600_000).toISOString() }).eq('id', a.id)
      return `batch ${batch.status}, given up`
    }
    await db.from('site_audits').update({ claimed_until: null }).eq('id', a.id)
    return `batch ${batch.status}`
  }
  const siblings = new Set(batch.pages.map((p) => p.url))
  const findings: PageFinding[] = batch.pages.flatMap((p) => pageFindings(p, siblings))
  let origin = ''
  try {
    origin = new URL(a.base_url).origin
  } catch {
    // validated on write
  }
  const tested = await testTargets(d.fetch, linkTargets(batch.pages), d.now)
  findings.push(...linkFindings(tested.checked, new Set([origin])))
  const { data: project } = await db.from('projects').select('name').eq('id', a.project_id).maybeSingle()
  const nowIso = d.now().toISOString()
  const filed = await fileFindings(db, a, (project as { name?: string } | null)?.name ?? 'this app', findings, nowIso)
  const byRule: Record<string, number> = {}
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  const unreadable = batch.pages.filter((p) => isDocumentUrl(p.url) && isUnreadableRender(p)).length
  const summary = { pages: batch.pages.length, unreadable, targetsChecked: tested.checked.length, targetsSkipped: tested.skipped, findings: byRule, reportsFiled: filed, credits: batch.credits }
  await db
    .from('site_audits')
    .update({
      batch_id: null,
      batch_started_at: null,
      claimed_until: null,
      last_run_at: nowIso,
      last_summary: summary,
      last_error: null,
      next_run_at: new Date(now.getTime() + a.cadence_days * 86_400_000).toISOString(),
      updated_at: nowIso,
    })
    .eq('id', a.id)
  log.info('site-audit.done', { auditId: a.id, ...summary })
  return `audited ${batch.pages.length} pages, filed ${filed}`
}

export async function runSiteAudits(db: SupabaseClient, deps: SiteAuditDeps = {}, only?: string): Promise<Array<{ auditId: string; outcome: string }>> {
  const d: Required<SiteAuditDeps> = {
    now: deps.now ?? (() => new Date()),
    fetch: deps.fetch ?? fetch,
    resolveKey: deps.resolveKey ?? (async (c, pid) => (await resolveFirecrawl(c, pid))?.key ?? null),
  }
  const nowIso = d.now().toISOString()
  let q = db.from('site_audits').select('id, project_id, enabled, base_url, page_limit, cadence_days, next_run_at, batch_id, batch_started_at, claimed_until').eq('enabled', true)
  if (only) q = q.eq('id', only)
  const { data, error } = await q.order('next_run_at', { ascending: true, nullsFirst: true }).limit(50)
  if (error) throw new Error(`site-audit read failed: ${error.message}`)
  const due = ((data ?? []) as Array<SiteAuditRow & { claimed_until: string | null }>)
    .filter((a) => (!a.claimed_until || a.claimed_until < nowIso) && (a.batch_id || !a.next_run_at || a.next_run_at <= nowIso))
    .slice(0, PER_TICK)
  const out: Array<{ auditId: string; outcome: string }> = []
  for (const a of due) {
    const until = new Date(d.now().getTime() + LEASE_MS).toISOString()
    const { data: claimed } = await db
      .from('site_audits')
      .update({ claimed_until: until })
      .eq('id', a.id)
      .or(`claimed_until.is.null,claimed_until.lt.${nowIso}`)
      .select('id')
    if (!claimed || (claimed as unknown[]).length === 0) continue
    try {
      const key = await d.resolveKey(db, a.project_id)
      if (!key) {
        await db.from('site_audits').update({ claimed_until: null, last_error: 'No Firecrawl key this app can use.', next_run_at: new Date(d.now().getTime() + 86_400_000).toISOString() }).eq('id', a.id)
        out.push({ auditId: a.id, outcome: 'no key' })
        continue
      }
      out.push({ auditId: a.id, outcome: a.batch_id ? await finishRun(db, d, a, key) : await startRun(db, d, a, key) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('site-audit failed', { auditId: a.id, err: message })
      await db.from('site_audits').update({ claimed_until: null, last_error: message.slice(0, 500) }).eq('id', a.id)
      out.push({ auditId: a.id, outcome: `error: ${message.slice(0, 120)}` })
    }
  }
  return out
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405 })
  }
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized
  const body = (await req.json().catch(() => ({}))) as { auditId?: unknown }
  const only = typeof body.auditId === 'string' ? body.auditId : undefined
  const results = await runSiteAudits(getServiceClient(), {}, only)
  return new Response(JSON.stringify({ ok: true, data: { results } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('site-audit', handler))
}
