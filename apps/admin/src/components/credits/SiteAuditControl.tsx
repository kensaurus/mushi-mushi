/**
 * FILE: apps/admin/src/components/credits/SiteAuditControl.tsx
 * PURPOSE: /credits, one app's site audit (ADR 0040): on/off, how often it
 *          runs, how many pages it reads, Run now, and what the last run
 *          checked and filed. The audit crawls the live site on that schedule
 *          and files one report per failing rule (dead links and images,
 *          missing page metadata, another locale's text or links, images
 *          without alt). One Firecrawl credit per page.
 */

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Btn, FILTER_SELECT_CLASS, SegmentedControl, Toggle } from '../ui'
import { apiFetch, type ApiResult } from '../../lib/supabase'
import { relativeTime } from '../../lib/setupGuideSteps'
import type { AuditCost } from '../../lib/creditPlan'

/** Cadence choices the credits page offers. The API accepts 1–30 days. */
const CADENCE_PRESETS = [
  { days: 1, label: 'Daily' },
  { days: 3, label: 'Every 3 days' },
  { days: 7, label: 'Weekly' },
] as const

/** Page caps, same idea as the site watch's "up to N pages" on this page. The API allows 1–500. */
const PAGE_PRESETS = [50, 100, 200, 500]

export interface AuditRow extends AuditCost {
  id: string
  base_url: string
  next_run_at: string | null
  batch_id: string | null
  last_run_at: string | null
  last_error: string | null
  last_summary?: { credits?: number | null; pages?: number; reportsFiled?: number; findings?: Record<string, number> } | null
}

interface Props {
  projectId: string
  name: string
  audit: AuditRow | null
  openFindings: number
  /** Address to start from: the audit's, else the watch's or the app's suggested one. */
  url: string
  firecrawlReady: boolean
  onChanged: (message: { ok: boolean; message: string }) => void
}

function cadenceOptions(days: number): Array<{ id: string; label: string }> {
  const presets = CADENCE_PRESETS.map((c) => ({ id: String(c.days), label: c.label }))
  if (CADENCE_PRESETS.some((c) => c.days === days)) return presets
  return [...presets, { id: String(days), label: `Every ${days} days` }]
}

function cadencePhrase(days: number): string {
  return CADENCE_PRESETS.find((c) => c.days === days)?.label.toLowerCase() ?? `every ${days} days`
}

function pageChoices(current: number): number[] {
  return [...new Set([...PAGE_PRESETS, current])].filter((n) => n >= 1 && n <= 500).sort((a, b) => a - b)
}

/** "Last run 2 days ago: 139 pages, 4 rules failing, 4 reports filed." */
function auditLine(a: AuditRow, openFindings: number): string {
  if (a.batch_id) return 'Running now: Firecrawl is reading the pages.'
  if (!a.last_run_at) return a.enabled ? 'First run starts within the hour.' : 'Never run.'
  const s = a.last_summary ?? {}
  const parts = [`Last run ${relativeTime(a.last_run_at) ?? 'recently'}: ${s.pages ?? '?'} pages`]
  parts.push(openFindings ? `${openFindings} rule${openFindings === 1 ? '' : 's'} failing` : 'every rule passed')
  if (s.reportsFiled) parts.push(`${s.reportsFiled} report${s.reportsFiled === 1 ? '' : 's'} filed`)
  return `${parts.join(', ')}.`
}

export function SiteAuditControl({ projectId, name, audit, openFindings, url, firecrawlReady, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  async function send(request: () => Promise<ApiResult<unknown>>, done: string) {
    setBusy(true)
    const res = await request()
    setBusy(false)
    onChanged(res.ok ? { ok: true, message: done } : { ok: false, message: res.error?.message ?? 'Not saved. Retry in a moment.' })
  }

  function save(patch: { enabled: boolean; cadenceDays?: number; pageLimit?: number }, done: string) {
    const body: { enabled: boolean; baseUrl: string; cadenceDays?: number; pageLimit?: number } = {
      enabled: patch.enabled,
      baseUrl: audit?.base_url ?? url,
    }
    if (patch.cadenceDays !== undefined) body.cadenceDays = patch.cadenceDays
    if (patch.pageLimit !== undefined) body.pageLimit = patch.pageLimit
    void send(
      () => apiFetch(`/v1/admin/projects/${projectId}/site-audit`, { method: 'PUT', body: JSON.stringify(body) }),
      done,
    )
  }

  const on = audit?.enabled === true
  const canStart = firecrawlReady && /^https:\/\//i.test(audit?.base_url ?? url)
  return (
    <div className="space-y-1 pl-3 border-l border-edge-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle
            label={
              !on
                ? `Audit links, accessibility and translations ${cadencePhrase(audit?.cadence_days ?? 7)}`
                : 'Audit links, accessibility and translations'
            }
            checked={on}
            disabled={busy || (!on && !canStart)}
            onChange={(v) =>
              save(
                { enabled: v },
                v ? `${name}: site audit on; the first run starts within the hour.` : `${name}: site audit off.`,
              )
            }
          />
          {on && audit && (
            <SegmentedControl
              size="sm"
              ariaLabel="How often to audit"
              value={String(audit.cadence_days)}
              options={cadenceOptions(audit.cadence_days)}
              disabled={busy}
              onChange={(id) => {
                const days = Number(id)
                if (busy || days === audit.cadence_days) return
                save({ enabled: true, cadenceDays: days }, `${name}: auditing ${cadencePhrase(days)}.`)
              }}
            />
          )}
        </div>
        {on && !audit?.batch_id && (
          <Btn size="sm" variant="ghost" type="button" loading={busy} onClick={() => void send(() => apiFetch(`/v1/admin/projects/${projectId}/site-audit/run`, { method: 'POST' }), `${name}: site audit started.`)}>
            Run now
          </Btn>
        )}
      </div>
      {on && audit && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-secondary">
          <select
            aria-label="Pages per audit"
            className={FILTER_SELECT_CLASS}
            disabled={busy}
            value={String(audit.page_limit)}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (n === audit.page_limit) return
              save({ enabled: true, pageLimit: n }, `${name}: auditing up to ${n} pages.`)
            }}
          >
            {pageChoices(audit.page_limit).map((n) => (
              <option key={n} value={n}>
                Up to {n} pages
              </option>
            ))}
          </select>
          <span className="tabular-nums">Up to {audit.page_limit.toLocaleString()} credits a run, one per page.</span>
        </p>
      )}
      {audit && <p className="text-xs text-fg-secondary">{auditLine(audit, openFindings)}</p>}
      {audit?.last_error && <p className="text-xs text-warn">{audit.last_error}</p>}
      {on && openFindings > 0 && (
        <p className="text-xs text-fg-muted">
          Its reports are on <Link className="text-brand hover:underline" to="/reports">Reports</Link>; spend-down sends them to Cursor.
        </p>
      )}
    </div>
  )
}
