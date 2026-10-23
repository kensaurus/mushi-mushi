/**
 * FILE: apps/admin/src/components/credits/SiteAuditControl.tsx
 * PURPOSE: /credits, one app's site audit (ADR 0040): on/off, Run now, and
 *          what the last run checked and filed. The audit crawls the whole
 *          live site on a schedule and files one report per failing rule
 *          (dead links and images, missing page metadata, another locale's
 *          text or links, images without alt).
 */

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Btn, Toggle } from '../ui'
import { apiFetch, type ApiResult } from '../../lib/supabase'
import { relativeTime } from '../../lib/setupGuideSteps'
import type { AuditCost } from '../../lib/creditPlan'

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

  const on = audit?.enabled === true
  const canStart = firecrawlReady && /^https:\/\//i.test(audit?.base_url ?? url)
  return (
    <div className="space-y-1 pl-3 border-l border-edge-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggle
          label="Audit links, accessibility and translations weekly"
          checked={on}
          disabled={busy || (!on && !canStart)}
          onChange={(v) =>
            void send(
              () =>
                apiFetch(`/v1/admin/projects/${projectId}/site-audit`, {
                  method: 'PUT',
                  body: JSON.stringify({ enabled: v, baseUrl: audit?.base_url ?? url }),
                }),
              v ? `${name}: site audit on; the first run starts within the hour.` : `${name}: site audit off.`,
            )
          }
        />
        {on && !audit?.batch_id && (
          <Btn size="sm" variant="ghost" type="button" loading={busy} onClick={() => void send(() => apiFetch(`/v1/admin/projects/${projectId}/site-audit/run`, { method: 'POST' }), `${name}: site audit started.`)}>
            Run now
          </Btn>
        )}
      </div>
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
