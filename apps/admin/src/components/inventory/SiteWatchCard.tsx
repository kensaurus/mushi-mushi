/**
 * FILE: apps/admin/src/components/inventory/SiteWatchCard.tsx
 * PURPOSE: "Watch your live site" (ADR 0024). Turns a daily Firecrawl crawl
 *          of the app's live site on or off. A page that errors, 404s from
 *          the app's own links, fails to load or turns blank becomes a bug
 *          report before a user finds it. Billed to the project's Firecrawl
 *          key; lists the pages that are broken right now.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card, Input } from '../ui'
import { SignalChip } from '../report-detail/ReportSurface'
import { apiFetch } from '../../lib/supabase'
import { CHIP_TONE } from '../../lib/chipTone'
import { useToast } from '../../lib/toast'
import { usePageData } from '../../lib/usePageData'
import { relativeTime } from '../../lib/setupGuideSteps'

interface SiteWatch {
  id: string
  base_url: string
  page_limit: number
  status: 'active' | 'paused' | 'error'
  last_checked_at: string | null
  last_summary: { totalPages?: number; broken?: number; actualCredits?: number | null } | null
  last_error: string | null
  estimated_credits_per_month: number | null
}

interface OpenPage {
  id: string
  url: string
  problem: 'http_error' | 'load_error' | 'judged_broken'
  status_code: number | null
  detail: string | null
  last_seen_at: string
  report_id: string | null
}

interface SiteWatchResponse {
  watch: SiteWatch | null
  openPages: OpenPage[]
  suggestedUrl: string | null
  firecrawlReady: boolean
}

/** About one credit per page per daily check. */
function monthlyCredits(pages: number): number {
  return pages * 30
}

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}` || '/'
  } catch {
    return url
  }
}

export function SiteWatchCard({ projectId }: { projectId: string }) {
  const toast = useToast()
  const state = usePageData<SiteWatchResponse>(`/v1/admin/projects/${projectId}/site-watch`, { deps: [projectId] })
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState('')
  const [pages, setPages] = useState(25)
  const [busy, setBusy] = useState<null | 'save' | 'run' | 'off'>(null)

  const data = state.data
  const watch = data?.watch ?? null

  function openForm() {
    setUrl(watch?.base_url ?? data?.suggestedUrl ?? '')
    setPages(watch?.page_limit ?? 25)
    setEditing(true)
  }

  async function save() {
    setBusy('save')
    const res = await apiFetch<{ estimatedCreditsPerMonth: number | null }>(`/v1/admin/projects/${projectId}/site-watch`, {
      method: 'PUT',
      body: JSON.stringify({ baseUrl: url.trim(), pageLimit: pages }),
    })
    setBusy(null)
    if (!res.ok) {
      toast.error('The watch was not saved', res.error?.message ?? 'Retry in a moment.')
      return
    }
    toast.success(
      watch ? 'Watch updated' : 'Watching your live site',
      'The first full check runs tonight at 01:30 UTC. Press "Check now" to run one sooner.',
    )
    setEditing(false)
    state.reload()
  }

  async function runNow() {
    setBusy('run')
    const res = await apiFetch(`/v1/admin/projects/${projectId}/site-watch/run`, { method: 'POST' })
    setBusy(null)
    if (!res.ok) {
      toast.error('The check did not start', res.error?.message ?? 'Retry in a moment.')
      return
    }
    toast.success('Check started', 'Results show here in 1–3 minutes; broken pages become reports.')
    window.setTimeout(() => state.reload(), 75_000)
    window.setTimeout(() => state.reload(), 155_000)
  }

  async function turnOff() {
    setBusy('off')
    const res = await apiFetch(`/v1/admin/projects/${projectId}/site-watch`, { method: 'DELETE' })
    setBusy(null)
    if (!res.ok) {
      toast.error('The watch was not turned off', res.error?.message ?? 'Retry in a moment.')
      return
    }
    toast.success('Watch turned off', 'Firecrawl no longer crawls this site. Existing reports stay.')
    state.reload()
  }

  const lastChecked = relativeTime(watch?.last_checked_at)
  const summary = watch?.last_summary

  return (
    <Card className="p-4 space-y-3" data-testid="mushi-site-watch-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-fg">Watch your live site</span>
            <SignalChip tone={watch ? 'ok' : 'info'} className="text-3xs uppercase tracking-wider">
              {watch ? 'on · daily' : 'off'}
            </SignalChip>
          </div>
          <p className="text-2xs text-fg-muted mt-0.5">
            Firecrawl checks your live pages once a day. A page that errors, 404s from your own links, fails to load or
            turns blank becomes a bug report before a user finds it.
          </p>
        </div>
        {data?.firecrawlReady && !editing && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {watch ? (
              <>
                <Btn type="button" size="sm" variant="primary" loading={busy === 'run'} onClick={() => void runNow()}>
                  Check now
                </Btn>
                <Btn type="button" size="sm" variant="ghost" onClick={openForm}>
                  Change
                </Btn>
                <Btn type="button" size="sm" variant="ghost" loading={busy === 'off'} onClick={() => void turnOff()}>
                  Turn off
                </Btn>
              </>
            ) : (
              <Btn type="button" size="sm" variant="primary" onClick={openForm}>
                Turn on
              </Btn>
            )}
          </div>
        )}
      </div>

      {state.error && <p className="text-2xs text-danger">Couldn't load the watch: {state.error}</p>}

      {data && !data.firecrawlReady && (
        <p className={`rounded-md ${CHIP_TONE.infoSubtle} px-3 py-2 text-2xs`}>
          Needs a Firecrawl key.{' '}
          <Link to="/settings?tab=byok" className="underline">
            Add one in Settings → AI keys
          </Link>
          ; a key shared with all your apps works too.
        </p>
      )}

      {watch && !editing && (
        <div className="text-2xs text-fg-muted space-y-1">
          <p>
            Watching <span className="font-mono text-fg-secondary">{watch.base_url}</span> · up to {watch.page_limit} pages
            a day · about {(watch.estimated_credits_per_month ?? monthlyCredits(watch.page_limit)).toLocaleString()}{' '}
            Firecrawl credits a month
          </p>
          <p>
            {lastChecked
              ? `Last check ${lastChecked}: ${summary?.totalPages ?? 0} pages, ${summary?.broken ?? 0} broken.`
              : 'No check read yet. The first one runs tonight at 01:30 UTC, or press Check now.'}
          </p>
          {watch.last_error && <p className="text-warning-foreground">{watch.last_error}</p>}
        </div>
      )}

      {editing && (
        <form
          className="space-y-3 border-t border-edge/50 pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-3">
            <Input
              label="Live site address"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.com"
              autoFocus
            />
            </div>
            <Input
              label="Pages per check"
              type="number"
              min={1}
              max={100}
              value={String(pages)}
              onChange={(e) => setPages(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            />
          </div>
          <p className="text-2xs text-fg-muted">
            Firecrawl follows your site's own links from this address. About {monthlyCredits(pages).toLocaleString()}{' '}
            credits a month on your Firecrawl key, plus one per changed page it checks for breakage.
          </p>
          <div className="flex items-center gap-2">
            <Btn type="submit" size="sm" loading={busy === 'save'} disabled={!url.trim()}>
              {watch ? 'Save' : 'Turn on'}
            </Btn>
            <Btn type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Btn>
          </div>
        </form>
      )}

      {(data?.openPages.length ?? 0) > 0 && (
        <div className="border-t border-edge/50 pt-3 space-y-1.5">
          <p className="text-2xs font-semibold text-fg">Broken right now</p>
          <ul className="space-y-1.5">
            {data!.openPages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 text-2xs min-w-0">
                <span className="min-w-0">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-mono text-fg hover:underline wrap-break-word">
                    {pathOf(p.url)}
                  </a>
                  <span className="text-fg-muted"> · {p.detail ?? p.problem}</span>
                </span>
                {p.report_id && (
                  <Link to={`/reports/${p.report_id}`} className="shrink-0 text-fg-secondary hover:underline">
                    Open report →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
