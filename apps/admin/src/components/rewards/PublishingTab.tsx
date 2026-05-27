/**
 * FILE: apps/admin/src/components/rewards/PublishingTab.tsx
 * PURPOSE: Dev/PM interface for managing a project's Mushi Bounties listing.
 *   Lets developers publish their app to the public tester marketplace,
 *   configure a bounty schedule, set targeting criteria, and monitor stats.
 *
 *   API surface: /v1/admin/published-apps/:projectId
 *   Entitlement: marketplace_publish (Pro+). Shows an upgrade prompt if the
 *   org doesn't have the entitlement.
 */

import { useState, useCallback } from 'react'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { getActiveProjectIdSnapshot } from '../../lib/activeProject'
import { useToast } from '../../lib/toast'
import {
  Card,
  Section,
  Badge,
  Btn,
  Input,
  EmptyState,
  ErrorAlert,
  StatCard,
} from '../ui'
import { TableSkeleton } from '../skeletons/TableSkeleton'

// ─── Types ────────────────────────────────────────────────────

interface BountyTier {
  action: string
  points_per_event: number
  enabled: boolean
}

interface PublishedApp {
  id: string
  project_id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  /** DB column is `visibility`; values: 'draft' | 'public' | 'paused' */
  visibility: 'draft' | 'public' | 'paused'
  platforms: string[]
  sentry_dsn: string | null
  published_at: string | null
  created_at: string
}

interface BountyStats {
  submissions_30d: number
  accepted_30d: number
  active_testers: number
  points_spent_30d: number
  monthly_budget_usd: number
  monthly_budget_used_pct: number
}

// ─── Bounty action labels + colours ──────────────────────────

const BOUNTY_ACTIONS = [
  { action: 'bug_critical', label: 'Critical bug',       pts: 2500, color: 'text-red-400' },
  { action: 'bug_high',     label: 'High severity bug',  pts: 1000, color: 'text-orange-400' },
  { action: 'bug_medium',   label: 'Medium severity bug', pts: 500, color: 'text-yellow-400' },
  { action: 'bug_low',      label: 'Low severity bug',   pts: 100,  color: 'text-gray-400' },
  { action: 'enhancement',  label: 'Enhancement',        pts: 50,   color: 'text-blue-400' },
]

function statusBadge(visibility: PublishedApp['visibility']) {
  if (visibility === 'public')  return <Badge className="bg-ok-muted text-ok">Live</Badge>
  if (visibility === 'paused')  return <Badge className="bg-warn-muted text-warn">Paused</Badge>
  return <Badge className="bg-surface-overlay text-fg-muted">Draft</Badge>
}

// ─── Main component ──────────────────────────────────────────

export function PublishingTab() {
  const projectId = getActiveProjectIdSnapshot()
  const toast = useToast()

  const { data, loading, error, reload } = usePageData<PublishedApp>(
    projectId ? `/v1/admin/published-apps/${projectId}` : null,
  )

  const { data: bounties, loading: bLoading } = usePageData<BountyTier[]>(
    projectId ? `/v1/admin/published-apps/${projectId}/bounties` : null,
  )

  const { data: stats, loading: sLoading } = usePageData<BountyStats>(
    projectId ? `/v1/admin/published-apps/${projectId}/stats` : null,
  )

  // Form state — synced from API data on first load
  const [name, setName]           = useState('')
  const [tagline, setTagline]     = useState('')
  const [description, setDesc]    = useState('')
  const [platforms, setPlatforms] = useState<string[]>(['web'])
  const [sentryDsn, setSentryDsn] = useState('')
  const [saving, setSaving]       = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [formReady, setFormReady] = useState(false)

  // Populate form once data arrives
  const populateForm = useCallback((app: PublishedApp) => {
    setName(app.name)
    setTagline(app.tagline ?? '')
    setDesc(app.description ?? '')
    setPlatforms(app.platforms.length ? app.platforms : ['web'])
    setSentryDsn(app.sentry_dsn ?? '')
    setFormReady(true)
  }, [])

  if (!formReady && data) {
    populateForm(data)
  }

  // ── Mutations ──────────────────────────────────────────────

  async function handleSave() {
    if (!projectId) return
    setSaving(true)
    try {
      const res = await apiFetch<PublishedApp>(`/v1/admin/published-apps/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name, tagline, description, platforms,
          sentry_dsn: sentryDsn || null,
        }),
      })
      if (res.ok) {
        toast.success('Listing saved.')
        setFormReady(false) // allow re-population from refreshed data
        reload()
      } else {
        toast.error(res.error?.message ?? 'Save failed.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    if (!projectId) return
    setPublishing(true)
    try {
      const res = await apiFetch<PublishedApp>(
        `/v1/admin/published-apps/${projectId}/publish`,
        { method: 'POST' },
      )
      if (res.ok) {
        toast.success('App is now live on the marketplace!')
        setFormReady(false)
        reload()
      } else {
        toast.error(res.error?.message ?? 'Publish failed.')
      }
    } finally {
      setPublishing(false)
    }
  }

  async function handlePause() {
    if (!projectId) return
    setPublishing(true)
    try {
      const res = await apiFetch<PublishedApp>(
        `/v1/admin/published-apps/${projectId}/pause`,
        { method: 'POST' },
      )
      if (res.ok) {
        toast.success('Listing paused — hidden from the marketplace.')
        setFormReady(false)
        reload()
      } else {
        toast.error(res.error?.message ?? 'Pause failed.')
      }
    } finally {
      setPublishing(false)
    }
  }

  function togglePlatform(p: string) {
    setPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p],
    )
    setFormReady(false)
  }

  // ── Render ─────────────────────────────────────────────────

  if (!projectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project from the top bar to manage its marketplace listing."
      />
    )
  }

  if (loading) return <TableSkeleton rows={6} />

  if (error) {
    const isEntitlementError = error.includes('not_entitled') || error.includes('403') || error.includes('forbidden')
    if (isEntitlementError) {
      return (
        <EmptyState
          title="Marketplace publishing requires a Pro plan"
          description="Upgrade your workspace to publish apps to the Mushi Bounties marketplace and start rewarding testers."
          action={<Btn variant="primary" onClick={() => window.location.href = '/billing'}>Upgrade to Pro</Btn>}
        />
      )
    }
    return <ErrorAlert message={error} onRetry={reload} />
  }

  const app = data
  const visibility = app?.visibility ?? 'draft'
  const isLive = visibility === 'public'
  const marketplaceUrl = app
    ? `${window.location.origin}/mushi-mushi/testers/apps/${app.slug}/`
    : null

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Marketplace listing</h2>
            {app && statusBadge(visibility)}
          </div>
          <p className="text-sm text-fg-muted mt-0.5">
            Publish this project to the Mushi Bounties marketplace so public testers can find and test it.
          </p>
          {marketplaceUrl && isLive && (
            <a
              href={marketplaceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand hover:underline mt-1 inline-block"
            >
              {marketplaceUrl} ↗
            </a>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {isLive ? (
            <Btn variant="ghost" size="sm" loading={publishing} onClick={handlePause}>
              Pause
            </Btn>
          ) : (
            <Btn variant="primary" size="sm" loading={publishing} onClick={handlePublish}
              disabled={!app || !name.trim()}
            >
              {visibility === 'paused' ? 'Re-publish' : 'Publish'}
            </Btn>
          )}
        </div>
      </div>

      {/* ── Stats row (only when there are submissions) ── */}
      {!sLoading && stats && stats.submissions_30d > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Testers" value={stats.active_testers} />
          <StatCard label="Submissions (30d)" value={stats.submissions_30d} />
          <StatCard label="Accepted (30d)" value={stats.accepted_30d} />
          <StatCard label="Points spent (30d)" value={stats.points_spent_30d.toLocaleString()} />
          <StatCard label="Budget used" value={`${Math.round(stats.monthly_budget_used_pct)}%`} />
        </div>
      )}

      {/* ── Listing form ── */}
      <Section title="Listing details">
        <Card>
          <div className="space-y-4 p-4">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">App name *</label>
              <Input
                value={name}
                onChange={e => { setName(e.target.value); setFormReady(false) }}
                placeholder="e.g. Mushi Mushi"
                maxLength={80}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Tagline</label>
              <Input
                value={tagline}
                onChange={e => { setTagline(e.target.value); setFormReady(false) }}
                placeholder="One-line description shown on app cards (max 140 chars)"
                maxLength={140}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Description</label>
              <textarea
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg
                           placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-brand/60
                           min-h-[100px] resize-y"
                value={description}
                onChange={e => { setDesc(e.target.value); setFormReady(false) }}
                placeholder="Tell testers what the app does and what kind of bugs to look for."
                maxLength={4000}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Platforms</label>
              <div className="flex flex-wrap gap-2">
                {['web', 'ios', 'android', 'desktop'].map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      platforms.includes(p)
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-border bg-transparent text-fg-muted hover:border-fg-muted'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">
                Sentry DSN{' '}
                <span className="text-fg-faint font-normal">(optional — tester reports forward here)</span>
              </label>
              <Input
                value={sentryDsn}
                onChange={e => { setSentryDsn(e.target.value); setFormReady(false) }}
                placeholder="https://xxx@oXXX.ingest.sentry.io/XXX"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Btn variant="primary" size="sm" loading={saving} onClick={handleSave}
                disabled={!name.trim()}
              >
                Save draft
              </Btn>
            </div>
          </div>
        </Card>
      </Section>

      {/* ── Bounty schedule (read-only preview; editable via the Tier ladder tab) ── */}
      <Section title="Bounty schedule">
        {bLoading ? (
          <TableSkeleton rows={5} />
        ) : (
          <Card>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left text-fg-muted font-medium uppercase tracking-wide">Action</th>
                  <th className="px-4 py-2 text-right text-fg-muted font-medium uppercase tracking-wide">Points</th>
                  <th className="px-4 py-2 text-right text-fg-muted font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {BOUNTY_ACTIONS.map(({ action, label, pts, color }) => {
                  const override = (bounties ?? []).find(b => b.action === action)
                  const points = override?.points_per_event ?? pts
                  const enabled = override?.enabled ?? true
                  return (
                    <tr key={action} className="border-t border-border/40">
                      <td className={`px-4 py-2.5 font-medium ${color}`}>{label}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-fg">
                        {points.toLocaleString()} pts
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {enabled ? (
                          <Badge className="bg-ok-muted text-ok">Enabled</Badge>
                        ) : (
                          <Badge className="bg-surface-overlay text-fg-muted">Disabled</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="px-4 py-3 text-xs text-fg-muted border-t border-border/40">
              1,000 pts = $10 gift card (Tremendous) or $13 Mushi Pro credit (1.3× premium).
              Configure overrides in the Tier ladder tab.
            </p>
          </Card>
        )}
      </Section>
    </div>
  )
}
