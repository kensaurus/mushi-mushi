/**
 * FILE: apps/admin/src/components/credits/FirecrawlLevers.tsx
 * PURPOSE: /credits, Firecrawl half: the balance and when it resets, what the
 *          site watches will use before then, and one row per app to turn its
 *          live-site watch (ADR 0024) on or off or widen it to the most pages
 *          a check allows. The full card, with the broken pages it found,
 *          stays under Inventory → Discovery.
 */

import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Btn, Input, ResultChip, Toggle } from '../ui'
import { LINK_ACCENT } from '../../lib/chipTone'
import { ConfirmDialog } from '../ConfirmDialog'
import { apiFetch } from '../../lib/supabase'
import { expiryLabel, firecrawlPace, paceLine, type WatchCost } from '../../lib/creditPlan'
import { SiteAuditControl, type AuditRow } from './SiteAuditControl'
import { SearchRankControl, type RankKeyword } from './SearchRankControl'

/** The most pages one check may read (PUT /v1/admin/projects/:id/site-watch). */
const SITE_WATCH_MAX_PAGES = 100

export interface FirecrawlBalance {
  remaining: number | null
  limit: number | null
  periodEnd: string | null
}

interface WatchRow extends WatchCost {
  base_url: string
}

interface AppWatch {
  projectId: string
  name: string
  watch: WatchRow | null
  suggestedUrl: string | null
  firecrawlReady: boolean
  audit: AuditRow | null
  auditFindings: number
  ranks: RankKeyword[]
  rankTarget: string | null
  error?: string
}

interface Props {
  balance: FirecrawlBalance | null
  /** null while the project list is still loading. */
  projects: Array<{ id: string; name: string }> | null
  now: Date
}

export function FirecrawlLevers({ balance, projects, now }: Props) {
  const [apps, setApps] = useState<AppWatch[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [confirmOff, setConfirmOff] = useState<AppWatch | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)
  const ids = projects?.map((p) => p.id).join(',') ?? null

  useEffect(() => {
    if (projects == null) return
    let live = true
    void Promise.all(
      projects.map(async (p): Promise<AppWatch> => {
        const [res, audit, ranks] = await Promise.all([
          apiFetch<{ watch: WatchRow | null; suggestedUrl: string | null; firecrawlReady: boolean }>(`/v1/admin/projects/${p.id}/site-watch`),
          apiFetch<{ audit: AuditRow | null; findings: unknown[] }>(`/v1/admin/projects/${p.id}/site-audit`),
          apiFetch<{ keywords: RankKeyword[]; target: string | null }>(`/v1/admin/projects/${p.id}/search-ranks`),
        ])
        const auditPart = {
          audit: audit.ok ? (audit.data?.audit ?? null) : null,
          auditFindings: audit.ok ? (audit.data?.findings?.length ?? 0) : 0,
          ranks: ranks.ok ? (ranks.data?.keywords ?? []) : [],
          rankTarget: ranks.ok ? (ranks.data?.target ?? null) : null,
        }
        if (!res.ok || !res.data) return { projectId: p.id, name: p.name, watch: null, suggestedUrl: null, firecrawlReady: false, error: 'Could not read', ...auditPart }
        return { projectId: p.id, name: p.name, ...res.data, ...auditPart }
      }),
    ).then((rows) => {
      if (live) setApps(rows)
    })
    return () => {
      live = false
    }
    // `ids` stands for the project list (a new array each render); reloadKey re-reads after a change.
  }, [ids, reloadKey])

  async function put(app: AppWatch, baseUrl: string, pageLimit: number, done: string) {
    setBusy(app.projectId)
    const res = await apiFetch(`/v1/admin/projects/${app.projectId}/site-watch`, {
      method: 'PUT',
      body: JSON.stringify({ baseUrl, pageLimit }),
    })
    setBusy(null)
    setNotice(res.ok ? { ok: true, message: done } : { ok: false, message: res.error?.message ?? 'Not saved. Retry in a moment.' })
    if (res.ok) setReloadKey((n) => n + 1)
  }

  async function turnOff(app: AppWatch) {
    setConfirmOff(null)
    setBusy(app.projectId)
    const res = await apiFetch(`/v1/admin/projects/${app.projectId}/site-watch`, { method: 'DELETE' })
    setBusy(null)
    setNotice(res.ok ? { ok: true, message: `Stopped watching ${app.name}.` } : { ok: false, message: res.error?.message ?? 'Not stopped. Retry in a moment.' })
    if (res.ok) setReloadKey((n) => n + 1)
  }

  const watches = (apps ?? []).map((a) => a.watch).filter((w): w is WatchRow => w != null)
  const audits = (apps ?? []).map((a) => a.audit).filter((x): x is AuditRow => x != null)
  const rankKeywords = (apps ?? []).reduce((n, a) => n + a.ranks.length, 0)
  const pace = firecrawlPace({ remaining: balance?.remaining ?? null, periodEnd: balance?.periodEnd ?? null, watches, audits, rankKeywords, now })
  const resets = expiryLabel(balance?.periodEnd, now, 'resets')

  return (
    <div className="space-y-3">
      {balance ? (
        <p className="text-sm text-fg">
          <span className="tabular-nums">{balance.remaining?.toLocaleString() ?? '?'}</span>
          {balance.limit != null && <span className="text-fg-muted"> of {balance.limit.toLocaleString()}</span>} credits left
          {resets && <span className="text-fg-muted"> · {resets}; unused credits do not roll over</span>}
        </p>
      ) : (
        <p className="text-sm text-fg-muted">
          No Firecrawl key yet.{' '}
          <Link className={LINK_ACCENT} to="/settings?tab=tools">Add one in Settings → Web tools</Link>.
        </p>
      )}
      {apps && <p className="text-xs text-fg-secondary tabular-nums">{paceLine(pace, balance?.periodEnd ?? null)}</p>}

      {!apps && <p className="text-xs text-fg-muted">Reading each app&apos;s site watch…</p>}
      {apps && (
        <ul className="divide-y divide-edge-subtle" aria-label="Site watch per app">
          {apps.map((a) => {
            const w = a.watch
            const url = urls[a.projectId] ?? w?.base_url ?? a.suggestedUrl ?? ''
            return (
              <li key={a.projectId} className="space-y-1.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-fg">{a.name}</p>
                  <Toggle
                    label="Watch the live site daily"
                    checked={w != null}
                    disabled={busy === a.projectId || !a.firecrawlReady || (!w && !/^https:\/\//i.test(url))}
                    onChange={(v) => (v ? void put(a, url, 25, `Watching ${a.name}.`) : setConfirmOff(a))}
                  />
                </div>
                {w ? (
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-secondary">
                    <span className="font-mono">{w.base_url}</span>
                    <span>· up to {w.page_limit} pages a day</span>
                    {w.estimated_credits_per_month != null && <span>· about {w.estimated_credits_per_month.toLocaleString()} credits a month</span>}
                    {w.page_limit < SITE_WATCH_MAX_PAGES && (
                      <Btn size="sm" variant="ghost" type="button" loading={busy === a.projectId} onClick={() => void put(a, w.base_url, SITE_WATCH_MAX_PAGES, `${a.name}: watching up to ${SITE_WATCH_MAX_PAGES} pages.`)}>
                        Watch up to {SITE_WATCH_MAX_PAGES} pages
                      </Btn>
                    )}
                  </p>
                ) : !a.firecrawlReady ? (
                  <p className="text-xs text-fg-muted">
                    This app has no Firecrawl key it can use. Add one, or share yours with all your apps, in{' '}
                    <Link className={LINK_ACCENT} to="/settings?tab=tools">Settings → Web tools</Link>.
                  </p>
                ) : (
                  <div className="max-w-md">
                    <Input
                      label="Live site address"
                      type="url"
                      placeholder="https://your-app.example"
                      value={url}
                      onChange={(e) => setUrls({ ...urls, [a.projectId]: e.target.value })}
                    />
                  </div>
                )}
                {a.error && <p className="text-xs text-warn">{a.error} this app&apos;s site watch.</p>}
                <SiteAuditControl
                  projectId={a.projectId}
                  name={a.name}
                  audit={a.audit}
                  openFindings={a.auditFindings}
                  url={url}
                  firecrawlReady={a.firecrawlReady}
                  onChanged={(m) => {
                    setNotice(m)
                    if (m.ok) setReloadKey((n) => n + 1)
                  }}
                />
                <SearchRankControl
                  projectId={a.projectId}
                  name={a.name}
                  keywords={a.ranks}
                  target={a.rankTarget}
                  firecrawlReady={a.firecrawlReady}
                  onChanged={(m) => {
                    setNotice(m)
                    if (m.ok) setReloadKey((n) => n + 1)
                  }}
                />
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-fg-muted">
        The watch checks pages daily for errors, 404s and blank screens; a broken page becomes a bug report after a second check
        confirms it. The audit reads every page on a schedule and files one report per failing rule. Spend-down can send both to
        Cursor. Broken pages per app: Inventory → Discovery.
      </p>
      {notice && <ResultChip tone={notice.ok ? 'success' : 'error'}>{notice.message}</ResultChip>}
      {confirmOff && (
        <ConfirmDialog
          title={`Stop watching ${confirmOff.name}?`}
          body="The daily check stops and its Firecrawl monitor is deleted. Reports it already filed stay."
          confirmLabel="Stop watching"
          tone="danger"
          onConfirm={() => turnOff(confirmOff)}
          onCancel={() => setConfirmOff(null)}
        />
      )}
    </div>
  )
}
