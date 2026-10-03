/**
 * StoreReviewsPanel — store reviews as reports for one app (gap #23). Off by
 * default. When on, Mushi reads App Store and Google Play reviews through
 * this app's store connections every 6 hours and files each new review at or
 * under the star threshold (default 1–2 stars) as a report, once.
 *
 * Data: GET  /v1/admin/projects/:id/store/reviews
 *       PUT  /v1/admin/projects/:id/store/reviews/settings (owners and admins)
 *       POST /v1/admin/projects/:id/store/reviews/pull (1 per 10 min, not viewers)
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn, Callout, ErrorAlert, Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { pullSummary, ratingLabel, storeLabel, type StoreIntakeResult } from './storeReviewsView'

interface StoreReviewsData {
  settings: { enabled: boolean; maxRating: number; lastPulledAt: string | null; lastStatus: string | null; lastError: string | null }
  sources: Array<{ store: string; appId: string; connected: boolean }>
  recent: Array<{ store: string; reviewId: string; rating: number | null; reportId: string | null; reviewCreatedAt: string | null; seenAt: string }>
  /** Owners and admins switch the intake and set the threshold. */
  canManage: boolean
  /** Everyone but viewers can pull now. */
  canPull: boolean
}

const SELECT = 'rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs'

export function StoreReviewsPanel({ projectId }: { projectId: string }) {
  const path = `/v1/admin/projects/${projectId}/store/reviews`
  const { data, loading, error, reload } = usePageData<StoreReviewsData>(path)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)

  const save = async (patch: { enabled: boolean; maxRating?: number }) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate(`${path}/settings`, { method: 'PUT', body: JSON.stringify(patch) })
      if (!res.ok) setNotice({ tone: 'danger', text: res.error?.message ?? 'The setting could not be saved.' })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const pull = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<StoreIntakeResult>(`${path}/pull`, { method: 'POST', body: '{}' })
      if (!res.ok || !res.data) setNotice({ tone: 'danger', text: res.error?.message ?? 'The reviews could not be pulled.' })
      else setNotice({ tone: res.data.status === 'ok' ? 'info' : 'danger', text: pullSummary(res.data) })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const s = data?.settings
  return (
    <Section
      title="Store reviews as reports"
      action={(
        <Btn
          size="sm"
          variant="ghost"
          onClick={pull}
          loading={busy}
          disabled={busy || !s?.enabled || !data?.canPull}
          title={data && !data.canPull ? 'Viewers cannot pull store reviews.' : undefined}
        >
          Pull now
        </Btn>
      )}
    >
      <p className="mb-3 text-xs text-fg-muted">
        Low-star App Store and Google Play reviews land in your reports queue, each once, with a diagnosis like any other report. Read-only toward the stores; reviewer names are never stored.
      </p>
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading the store review settings…" />}
      {data && s && (
        <div className="flex flex-col gap-3 text-sm">
          <fieldset className="flex flex-col gap-2" disabled={busy || !data.canManage}>
            <legend className="sr-only">Store reviews as reports</legend>
            {!data.canManage && <p className="text-xs text-fg-muted">Owners and admins only.</p>}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
              <span>File new store reviews as reports</span>
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-fg-muted">Only reviews of</span>
              <select className={SELECT} value={s.maxRating} onChange={(e) => save({ enabled: s.enabled, maxRating: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{ratingLabel(n)}</option>)}
              </select>
            </label>
          </fieldset>
          {data.sources.length === 0 ? (
            <p className="text-xs text-fg-muted">
              No App Store Connect or Google Play source is bound to this app. Connect one under Portfolio → Connected sources and bind this app's Apple id or Android package.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {data.sources.map((src) => (
                <li key={`${src.store}:${src.appId}`}>
                  <Badge tone={src.connected ? 'okSubtle' : 'warnSubtle'} title={src.connected ? 'Key stored' : 'The key could not be read'}>
                    {storeLabel(src.store)} {src.appId}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-fg-muted">
            {s.lastPulledAt ? `Last pulled ${new Date(s.lastPulledAt).toLocaleString()} (${s.lastStatus ?? 'unknown'}).` : 'Not pulled yet.'}
            {s.lastError ? ` ${s.lastError}` : ''}
          </p>
          {data.recent.length > 0 && (
            <ul className="flex flex-col divide-y divide-edge-subtle text-xs">
              {data.recent.map((r) => (
                <li key={`${r.store}:${r.reviewId}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="text-fg-secondary">
                    {storeLabel(r.store)} · {r.rating === null ? 'no rating' : `${r.rating}★`}
                    {r.reviewCreatedAt ? ` · ${r.reviewCreatedAt.slice(0, 10)}` : ''}
                  </span>
                  {r.reportId ? (
                    <Link to={`/reports/${r.reportId}`} className="text-brand hover:underline">Open report</Link>
                  ) : (
                    <span className="text-fg-faint">Seen, not filed</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}
