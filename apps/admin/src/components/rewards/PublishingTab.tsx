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

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
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
  daily_cap?: number | null
  lifetime_cap_per_tester?: number | null
}

interface TargetingConfig {
  country_codes: string[]
  languages: string[]
  expertise_tags: string[]
  reputation_min: number
  min_age: number | null
}

interface MarketplaceSettings {
  marketplace_monthly_budget_usd: number
  marketplace_max_testers: number
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
  { action: 'bug_critical', label: 'Critical bug',        pts: 2500, color: 'text-danger' },
  { action: 'bug_high',     label: 'High severity bug',   pts: 1000, color: 'text-warn' },
  { action: 'bug_medium',   label: 'Medium severity bug', pts: 500,  color: 'text-warn/70' },
  { action: 'bug_low',      label: 'Low severity bug',    pts: 100,  color: 'text-fg-muted' },
  { action: 'enhancement',  label: 'Enhancement',         pts: 50,   color: 'text-info' },
]

function statusBadge(visibility: PublishedApp['visibility']) {
  if (visibility === 'public')  return <Badge tone="okSubtle">Live</Badge>
  if (visibility === 'paused')  return <Badge tone="warnSubtle">Paused</Badge>
  return <Badge className="bg-surface-overlay text-fg-muted">Draft</Badge>
}

// ─── Main component ──────────────────────────────────────────

export function PublishingTab() {
  const projectId = getActiveProjectIdSnapshot()
  const toast = useToast()

  const { data, loading, error, reload } = usePageData<PublishedApp>(
    projectId ? `/v1/admin/published-apps/${projectId}` : null,
  )

  const { data: bounties, loading: bLoading, reload: reloadBounties } = usePageData<BountyTier[]>(
    projectId ? `/v1/admin/published-apps/${projectId}/bounties` : null,
  )

  const { data: stats, loading: sLoading, reload: reloadStats } = usePageData<BountyStats>(
    projectId ? `/v1/admin/published-apps/${projectId}/stats` : null,
  )

  const { data: targeting, loading: tLoading, reload: reloadTargeting } = usePageData<TargetingConfig | null>(
    projectId ? `/v1/admin/published-apps/${projectId}/targeting` : null,
  )

  const { data: marketplaceSettings, loading: mLoading, reload: reloadSettings } = usePageData<MarketplaceSettings>(
    projectId ? `/v1/admin/published-apps/${projectId}/marketplace-settings` : null,
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
  const [savingBounties, setSavingBounties] = useState(false)
  const [savingTargeting, setSavingTargeting] = useState(false)
  const [savingBudget, setSavingBudget] = useState(false)

  const [bountyDraft, setBountyDraft] = useState<Array<{
    action: string
    label: string
    color: string
    points_per_event: number
    enabled: boolean
    daily_cap: string
    lifetime_cap_per_tester: string
  }>>([])

  const [countryCodes, setCountryCodes] = useState('')
  const [languages, setLanguages] = useState('')
  const [expertiseTags, setExpertiseTags] = useState('')
  const [reputationMin, setReputationMin] = useState('0')
  const [minAge, setMinAge] = useState('')
  const [targetingReady, setTargetingReady] = useState(false)

  const [monthlyBudget, setMonthlyBudget] = useState('')
  const [maxTesters, setMaxTesters] = useState('')
  const [budgetReady, setBudgetReady] = useState(false)

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

  useEffect(() => {
    const rows = BOUNTY_ACTIONS.map(({ action, label, pts, color }) => {
      const override = (bounties ?? []).find(b => b.action === action)
      return {
        action,
        label,
        color,
        points_per_event: override?.points_per_event ?? pts,
        enabled: override?.enabled ?? true,
        daily_cap: override?.daily_cap != null ? String(override.daily_cap) : '',
        lifetime_cap_per_tester: override?.lifetime_cap_per_tester != null
          ? String(override.lifetime_cap_per_tester)
          : '',
      }
    })
    setBountyDraft(rows)
  }, [bounties])

  useEffect(() => {
    if (targetingReady || tLoading) return
    if (targeting === undefined) return
    setCountryCodes((targeting?.country_codes ?? []).join(', '))
    setLanguages((targeting?.languages ?? []).join(', '))
    setExpertiseTags((targeting?.expertise_tags ?? []).join(', '))
    setReputationMin(String(targeting?.reputation_min ?? 0))
    setMinAge(targeting?.min_age != null ? String(targeting.min_age) : '')
    setTargetingReady(true)
  }, [targeting, tLoading, targetingReady])

  useEffect(() => {
    if (budgetReady || mLoading) return
    if (!marketplaceSettings) return
    setMonthlyBudget(String(marketplaceSettings.marketplace_monthly_budget_usd ?? 0))
    setMaxTesters(String(marketplaceSettings.marketplace_max_testers ?? 0))
    setBudgetReady(true)
  }, [marketplaceSettings, mLoading, budgetReady])

  const parseCsv = (raw: string) =>
    raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)

  const pendingCountHint = useMemo(
    () => (stats?.submissions_30d ?? 0) > 0,
    [stats?.submissions_30d],
  )

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

  async function handleSaveBounties() {
    if (!projectId || bountyDraft.length === 0) return
    setSavingBounties(true)
    try {
      const payload = {
        bounties: bountyDraft.map(row => ({
          action: row.action,
          points_per_event: row.points_per_event,
          enabled: row.enabled,
          daily_cap: row.daily_cap ? Number(row.daily_cap) : null,
          lifetime_cap_per_tester: row.lifetime_cap_per_tester
            ? Number(row.lifetime_cap_per_tester)
            : null,
        })),
      }
      const res = await apiFetch(`/v1/admin/published-apps/${projectId}/bounties`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        toast.success('Bounty schedule saved.')
        reloadBounties()
        reloadStats()
      } else {
        toast.error(res.error?.message ?? 'Could not save bounties.')
      }
    } finally {
      setSavingBounties(false)
    }
  }

  async function handleSaveTargeting() {
    if (!projectId) return
    setSavingTargeting(true)
    try {
      const res = await apiFetch(`/v1/admin/published-apps/${projectId}/targeting`, {
        method: 'PUT',
        body: JSON.stringify({
          country_codes: parseCsv(countryCodes).map(c => c.toUpperCase()),
          languages: parseCsv(languages),
          expertise_tags: parseCsv(expertiseTags),
          reputation_min: Number(reputationMin) || 0,
          min_age: minAge ? Number(minAge) : null,
        }),
      })
      if (res.ok) {
        toast.success('Targeting rules saved.')
        setTargetingReady(false)
        reloadTargeting()
      } else {
        toast.error(res.error?.message ?? 'Could not save targeting.')
      }
    } finally {
      setSavingTargeting(false)
    }
  }

  async function handleSaveBudget() {
    if (!projectId) return
    setSavingBudget(true)
    try {
      const res = await apiFetch(`/v1/admin/published-apps/${projectId}/marketplace-settings`, {
        method: 'PUT',
        body: JSON.stringify({
          marketplace_monthly_budget_usd: Number(monthlyBudget) || 0,
          marketplace_max_testers: Number(maxTesters) || 0,
        }),
      })
      if (res.ok) {
        toast.success('Budget settings saved.')
        setBudgetReady(false)
        reloadSettings()
        reloadStats()
      } else {
        toast.error(res.error?.message ?? 'Could not save budget.')
      }
    } finally {
      setSavingBudget(false)
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
              className="text-xs text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors mt-1 inline-block"
            >
              {marketplaceUrl} ↗
            </a>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            to="/rewards/tester-review"
            className="inline-flex items-center rounded-md border border-edge-subtle px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg hover:border-fg-muted transition-colors"
          >
            Review submissions
          </Link>
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

      {/* ── Stats + budget ── */}
      {!sLoading && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Testers" value={stats.active_testers} />
          <StatCard label="Submissions (30d)" value={stats.submissions_30d} />
          <StatCard label="Accepted (30d)" value={stats.accepted_30d} />
          <StatCard label="Points spent (30d)" value={stats.points_spent_30d.toLocaleString()} />
          <StatCard
            label="Budget used"
            value={`${Math.round(stats.monthly_budget_used_pct)}%`}
            hint={stats.monthly_budget_usd > 0 ? `$${stats.monthly_budget_usd} cap` : 'No cap set'}
          />
        </div>
      )}

      {!pendingCountHint && !sLoading && (
        <p className="text-xs text-fg-muted">
          Publish your listing, set bounties, then{' '}
          <Link to="/rewards/tester-review" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
            review submissions
          </Link>{' '}
          as testers join.
        </p>
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
                className="w-full rounded-md border border-edge-subtle bg-surface px-3 py-2 text-sm text-fg
                           placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60
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
                        : 'border-edge-subtle bg-transparent text-fg-muted hover:border-fg-muted'
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

      {/* ── Budget & caps ── */}
      <Section title="Payout budget">
        {mLoading ? (
          <TableSkeleton rows={2} />
        ) : (
          <Card>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Monthly gift-card budget (USD)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={monthlyBudget}
                  onChange={e => { setMonthlyBudget(e.target.value); setBudgetReady(false) }}
                  placeholder="0 = no cap"
                />
                <p className="mt-1 text-2xs text-fg-faint">
                  Mushi funds redemptions; this caps per-project Tremendous spend.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Max active testers
                </label>
                <Input
                  type="number"
                  min={0}
                  value={maxTesters}
                  onChange={e => { setMaxTesters(e.target.value); setBudgetReady(false) }}
                  placeholder="0 = unlimited"
                />
              </div>
            </div>
            <div className="flex justify-end border-t border-edge-subtle/40 px-4 py-3">
              <Btn variant="primary" size="sm" loading={savingBudget} onClick={handleSaveBudget}>
                Save budget
              </Btn>
            </div>
          </Card>
        )}
      </Section>

      {/* ── Bounty schedule ── */}
      <Section title="Bounty schedule">
        {bLoading || bountyDraft.length === 0 ? (
          <TableSkeleton rows={5} />
        ) : (
          <Card>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-edge-subtle">
                  <th className="px-4 py-2 text-left text-fg-muted font-medium uppercase tracking-wide">Severity</th>
                  <th className="px-4 py-2 text-right text-fg-muted font-medium uppercase tracking-wide">Points</th>
                  <th className="px-4 py-2 text-right text-fg-muted font-medium uppercase tracking-wide">Daily cap</th>
                  <th className="px-4 py-2 text-right text-fg-muted font-medium uppercase tracking-wide">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {bountyDraft.map((row, idx) => (
                  <tr key={row.action} className="border-t border-edge-subtle/40">
                    <td className={`px-4 py-2.5 font-medium ${row.color}`}>{row.label}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={10000}
                        className="ml-auto w-24 text-right font-mono"
                        value={row.points_per_event}
                        onChange={e => {
                          const v = Number(e.target.value)
                          setBountyDraft(prev => prev.map((r, i) =>
                            i === idx ? { ...r, points_per_event: Number.isFinite(v) ? v : 0 } : r,
                          ))
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Input
                        type="number"
                        min={1}
                        className="ml-auto w-20 text-right font-mono"
                        placeholder="—"
                        value={row.daily_cap}
                        onChange={e => {
                          setBountyDraft(prev => prev.map((r, i) =>
                            i === idx ? { ...r, daily_cap: e.target.value } : r,
                          ))
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setBountyDraft(prev => prev.map((r, i) =>
                            i === idx ? { ...r, enabled: !r.enabled } : r,
                          ))
                        }}
                        className="inline-flex"
                      >
                        {row.enabled ? (
                          <Badge tone="okSubtle">On</Badge>
                        ) : (
                          <Badge className="bg-surface-overlay text-fg-muted">Off</Badge>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle/40 px-4 py-3">
              <p className="text-xs text-fg-muted">
                1,000 pts ≈ $10 gift card or $13 Mushi Pro credit (1.3×). Points are stamped at submit time.
              </p>
              <Btn variant="primary" size="sm" loading={savingBounties} onClick={handleSaveBounties}>
                Save bounties
              </Btn>
            </div>
          </Card>
        )}
      </Section>

      {/* ── Targeting ── */}
      <Section title="Tester targeting">
        {tLoading ? (
          <TableSkeleton rows={4} />
        ) : (
          <Card>
            <div className="space-y-4 p-4">
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Country codes (ISO-2, comma-separated)
                </label>
                <Input
                  value={countryCodes}
                  onChange={e => { setCountryCodes(e.target.value); setTargetingReady(false) }}
                  placeholder="US, CA, GB — empty = all countries"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Languages (comma-separated)
                </label>
                <Input
                  value={languages}
                  onChange={e => { setLanguages(e.target.value); setTargetingReady(false) }}
                  placeholder="en, ja — empty = all languages"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                  Expertise tags (comma-separated)
                </label>
                <Input
                  value={expertiseTags}
                  onChange={e => { setExpertiseTags(e.target.value); setTargetingReady(false) }}
                  placeholder="mobile, accessibility — empty = open to all"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-fg-muted mb-1">
                    Minimum reputation
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={reputationMin}
                    onChange={e => { setReputationMin(e.target.value); setTargetingReady(false) }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-fg-muted mb-1">
                    Minimum age (optional)
                  </label>
                  <Input
                    type="number"
                    min={13}
                    max={100}
                    value={minAge}
                    onChange={e => { setMinAge(e.target.value); setTargetingReady(false) }}
                    placeholder="13+"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Btn variant="primary" size="sm" loading={savingTargeting} onClick={handleSaveTargeting}>
                  Save targeting
                </Btn>
              </div>
            </div>
          </Card>
        )}
      </Section>
    </div>
  )
}
