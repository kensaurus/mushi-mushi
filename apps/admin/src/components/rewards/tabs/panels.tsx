/**
 * FILE: panels.tsx
 * PURPOSE: Rewards tab panel implementations extracted from RewardsPage.
 */

import { useState, useCallback, useMemo, useRef } from 'react'
import { apiFetch } from '../../../lib/supabase'
import { useRealtimeReload } from '../../../lib/realtime'
import { usePageData } from '../../../lib/usePageData'
import { useToast } from '../../../lib/toast'
import { useEntitlements } from '../../../lib/useEntitlements'
import {
  Card,
  Section,
  Badge,
  Btn,
  Input,
  EmptyState,
  ErrorAlert,
  SelectField,
  StatCard,
  RelativeTime,
  SegmentedControl,
  DetailRows,
  type DetailRowItem,
} from '../../ui'
import {
  IconRewards,
  IconUser,
  IconShield,
  IconGauge,
  IconIntegrations,
  IconQuery,
  IconDashboard,
  IconChevronRight,
  IconChevronDown,
  IconChevronUp,
} from '../../icons'
import { Drawer } from '../../Drawer'
import { TableSkeleton } from '../../skeletons/TableSkeleton'
import { MetricStrip } from '../../MetricStrip'
import {
  overviewContributorsTooltip,
  overviewContributorsDetail,
  overviewPointsTooltip,
  overviewPointsDetail,
  overviewTierHoldersTooltip,
  overviewTierHoldersDetail,
  overviewPendingLiabilityTooltip,
  overviewPendingLiabilityDetail,
} from '../../../lib/statTooltips/rewards'

// ─── Types ────────────────────────────────────────────────────

interface OverviewData {
  active_contributors_30d: number
  points_awarded_30d: number
  tier_distribution: Record<string, number>
  pending_payout_liability_usd: number
}

interface RewardRule {
  id: string
  action: string
  base_points: number
  max_per_day: number | null
  max_per_user_lifetime: number | null
  multiplier_eligible: boolean
  enabled: boolean
  project_id: string | null
  organization_id: string
}

interface RewardTier {
  id: string
  slug: string
  display_name: string
  display_order: number
  points_threshold: number
  perks: Record<string, unknown>
  host_credit_payload: Record<string, unknown> | null
  monetary_reward_usd: number | null
  enabled: boolean
}

interface Contributor {
  end_user_id: string
  total_points: number
  points_30d: number
  end_users: {
    external_user_id: string
    display_name: string | null
    anti_fraud_flags: string[]
    last_seen_at: string
  }
  reward_tiers: { slug: string; display_name: string } | null
}

interface WebhookRow {
  id: string
  url: string
  events: string[]
  enabled: boolean
  last_delivered_at: string | null
  last_status: number | null
}

interface IdentityProvider {
  id: string
  project_id: string
  provider: 'apple' | 'google' | 'supabase' | 'custom'
  jwks_url: string
  audience: string | null
  issuer: string | null
  enabled: boolean
  created_at: string
}

interface ProjectOption {
  id: string
  name: string
}

// ─── Design tokens ───────────────────────────────────────────

const TIER_BADGE: Record<string, string> = {
  free:        'bg-surface-overlay text-fg-secondary',
  explorer:    'bg-info-muted text-info',
  contributor: 'bg-brand/15 text-brand',
  champion:    'bg-warn-muted text-warn',
}

// ─── Overview tab ────────────────────────────────────────────

interface ActivityEvent24h {
  id: string
  action: string
  points_awarded: number | null
  rejected_reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  end_users: { external_user_id: string; display_name: string | null } | null
}

interface ActivityFeed {
  events: ActivityEvent24h[]
  stats_24h: {
    total: number
    accepted: number
    rejected: number
    points_awarded: number
    rejection_rate_pct: number
    top_actions: { action: string; count: number }[]
  }
}

export function OverviewTab() {
  const { data, loading, error, reload, lastFetchedAt, isValidating } = usePageData<OverviewData>(
    `/v1/admin/rewards/overview`,
  )
  const { data: feedData, reload: reloadFeed, lastFetchedAt: feedFetchedAt, isValidating: feedValidating } = usePageData<ActivityFeed>(
    `/v1/admin/rewards/activity`,
  )

  useRealtimeReload(
    ['end_user_activity', 'end_user_points'],
    () => { reload(); reloadFeed() },
    { debounceMs: 2_000 },
  )

  if (loading) return <TableSkeleton rows={3} />
  if (error) return <ErrorAlert message={error} />

  const tierEntries = Object.entries(data?.tier_distribution ?? {})
    .sort((a, b) => b[1] - a[1])

  const totalHolders = tierEntries.reduce((s, [, n]) => s + n, 0)
  const pendingLiability = data?.pending_payout_liability_usd ?? 0

  return (
    <div className="space-y-4">
      <MetricStrip cols={4} ariaLabel="Rewards overview metrics">
        <StatCard
          label="Active contributors (30d)"
          value={data?.active_contributors_30d ?? 0}
          tooltip={overviewContributorsTooltip(data?.active_contributors_30d ?? 0)}
          detail={overviewContributorsDetail()}
        />
        <StatCard
          label="Points awarded (30d)"
          value={(data?.points_awarded_30d ?? 0).toLocaleString()}
          tooltip={overviewPointsTooltip(data?.points_awarded_30d ?? 0)}
          detail={overviewPointsDetail()}
        />
        <StatCard
          label="Tier holders"
          value={totalHolders}
          tooltip={overviewTierHoldersTooltip(totalHolders)}
          detail={overviewTierHoldersDetail()}
        />
        <StatCard
          label="Pending liability"
          value={`$${pendingLiability.toFixed(2)}`}
          accent={pendingLiability > 0 ? 'text-warn' : undefined}
          tooltip={overviewPendingLiabilityTooltip(pendingLiability)}
          detail={overviewPendingLiabilityDetail()}
        />
      </MetricStrip>

      <Section
        title="Tier distribution"
        icon={<IconRewards />}
        freshness={{ at: lastFetchedAt, isValidating }}
      >
        {tierEntries.length === 0 ? (
          <EmptyState title="No contributors yet" description="Enable rewards on a project to start tracking users." />
        ) : (
          <div className="space-y-2">
            {tierEntries.map(([slug, count]) => {
              const pct = totalHolders > 0 ? Math.round((count / totalHolders) * 100) : 0
              const badgeCls = TIER_BADGE[slug.toLowerCase()] ?? 'bg-surface-overlay text-fg-secondary'
              return (
                <div key={slug} className="flex items-center gap-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold capitalize shrink-0 w-28 ${badgeCls}`}>
                    {slug}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${TIER_BAR[slug.toLowerCase()] ?? 'bg-fg-faint'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-mono text-fg-muted tabular-nums shrink-0 w-12 text-right">
                    {count} ({pct}%)
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {pendingLiability > 0 && (
        <div className="rounded-xl border border-warn/20 bg-warn/5 p-3 text-xs text-warn">
          <strong>${pendingLiability.toFixed(2)} USD</strong> in payouts are queued for the next
          monthly aggregator run. Stripe Connect KYC must be complete before funds transfer.
        </div>
      )}

      {/* ── Debug: 24h activity feed ── */}
      <Section
        title="Activity feed (last 24 h)"
        icon={<IconGauge />}
        freshness={{ at: feedFetchedAt, isValidating: feedValidating }}
      >
        {feedData && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-surface-overlay p-2 text-center">
              <div className="text-lg font-semibold tabular-nums text-fg">{feedData.stats_24h.total}</div>
              <div className="text-2xs text-fg-muted mt-0.5">total events</div>
            </div>
            <div className="rounded-lg bg-surface-overlay p-2 text-center">
              <div className="text-lg font-semibold tabular-nums text-ok">{feedData.stats_24h.accepted}</div>
              <div className="text-2xs text-fg-muted mt-0.5">accepted</div>
            </div>
            <div className={`rounded-lg bg-surface-overlay p-2 text-center ${feedData.stats_24h.rejected > 0 ? 'ring-1 ring-danger/30' : ''}`}>
              <div className={`text-lg font-semibold tabular-nums ${feedData.stats_24h.rejected > 0 ? 'text-danger' : 'text-fg-muted'}`}>
                {feedData.stats_24h.rejected}
              </div>
              <div className="text-2xs text-fg-muted mt-0.5">
                rejected{feedData.stats_24h.rejection_rate_pct > 0 ? ` (${feedData.stats_24h.rejection_rate_pct}%)` : ''}
              </div>
            </div>
            <div className="rounded-lg bg-surface-overlay p-2 text-center">
              <div className="text-lg font-semibold tabular-nums text-brand">+{feedData.stats_24h.points_awarded.toLocaleString()}</div>
              <div className="text-2xs text-fg-muted mt-0.5">pts awarded</div>
            </div>
          </div>
        )}

        {feedData && feedData.stats_24h.top_actions.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {feedData.stats_24h.top_actions.map(({ action, count }) => (
              <span key={action} className="inline-flex items-center gap-1 rounded bg-surface-overlay px-2 py-0.5 text-2xs text-fg-muted">
                <span className="font-mono text-fg">{action.replace(/_/g, ' ')}</span>
                <span className="text-fg-faint">×{count}</span>
              </span>
            ))}
          </div>
        )}

        {!feedData || feedData.events.length === 0 ? (
          <EmptyState title="No events in last 24 hours" description="Activity events will appear here as SDK clients send data." />
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-edge-subtle text-xs">
            {feedData.events.map((ev) => {
              const rejected = !!ev.rejected_reason
              return (
                <div key={ev.id} className={`py-1.5 flex items-start gap-2 ${rejected ? 'opacity-50' : ''}`}>
                  <span className={`shrink-0 inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-mono mt-0.5 ${rejected ? 'bg-surface-overlay text-fg-faint' : 'bg-ok-muted text-ok'}`}>
                    {ev.action.replace(/_/g, ' ')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 justify-between">
                      <span className="text-fg-muted truncate max-w-[150px]">
                        {ev.end_users?.display_name ?? ev.end_users?.external_user_id ?? 'anonymous'}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {!rejected && ev.points_awarded != null && (
                          <span className="font-mono font-semibold text-ok tabular-nums">+{ev.points_awarded}</span>
                        )}
                        {rejected && ev.rejected_reason && (
                          <span className="text-fg-faint text-2xs truncate max-w-[100px]">{ev.rejected_reason}</span>
                        )}
                        <span className="text-fg-faint text-2xs">
                          <RelativeTime value={ev.created_at} />
                        </span>
                      </div>
                    </div>
                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <div className="text-2xs font-mono text-fg-faint mt-0.5 truncate">
                        {JSON.stringify(ev.metadata)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

const TIER_BAR: Record<string, string> = {
  free:        'bg-fg-faint',
  explorer:    'bg-info',
  contributor: 'bg-brand',
  champion:    'bg-warn',
}

// ─── Activity rules tab ──────────────────────────────────────

export function ActivityRulesTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const { data: rules, loading, error, reload, lastFetchedAt, isValidating } = usePageData<RewardRule[]>(
    `/v1/admin/rewards/rules`,
  )

  const [saving, setSaving] = useState(false)
  const [edited, setEdited] = useState<Record<string, Partial<RewardRule>>>({})

  const patch = (id: string, key: keyof RewardRule, value: unknown) => {
    setEdited((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
  }

  const saveAll = useCallback(async () => {
    if (!canEdit) return
    setSaving(true)
    const payload = (rules ?? []).map((r) => ({ ...r, ...(edited[r.id] ?? {}) }))
    const res = await apiFetch('/v1/admin/rewards/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) { toast.success('Rules saved'); setEdited({}); reload() }
    else toast.error('Save failed')
  }, [rules, edited, canEdit, reload, toast])

  // One-click "enable rewards with recommended defaults" (Workstream D4).
  const applyPresets = useCallback(async () => {
    if (!canEdit) return
    setSaving(true)
    const res = await apiFetch('/v1/admin/rewards/presets/apply', { method: 'POST' })
    setSaving(false)
    if (res.ok) { toast.success('Recommended rewards enabled'); reload() }
    else toast.error('Could not apply presets')
  }, [canEdit, reload, toast])

  if (loading) return <TableSkeleton rows={8} />
  if (error) return <ErrorAlert message={error} />

  const allRules = rules ?? []

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="rounded-xl border border-warn/20 bg-warn/5 p-3 text-xs text-warn">
          Upgrade to Starter or higher to configure activity rules.
        </div>
      )}

      <Section
        title="Point rules"
        icon={<IconGauge />}
        freshness={{ at: lastFetchedAt, isValidating }}
        action={
          canEdit ? (
            <Btn
              variant="primary"
              size="sm"
              loading={saving}
              onClick={saveAll}
              disabled={Object.keys(edited).length === 0}
            >
              Save rules
            </Btn>
          ) : undefined
        }
      >
        {allRules.length === 0 ? (
          <EmptyState
            title="No custom rules yet"
            description="Enable rewards with recommended defaults (report points + a 4-tier ladder), then fine-tune anytime. Everything is preset and ready to go."
            action={
              canEdit ? (
                <Btn variant="primary" size="sm" loading={saving} onClick={applyPresets}>
                  Use recommended defaults
                </Btn>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-edge-subtle text-left text-fg-muted uppercase tracking-wider">
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Base pts</th>
                  <th className="py-2 pr-4">Daily cap</th>
                  <th className="py-2 pr-4">Lifetime cap</th>
                  <th className="py-2">Enabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-subtle">
                {allRules.map((rule) => {
                  const e = edited[rule.id] ?? {}
                  const cur = { ...rule, ...e }
                  return (
                    <tr key={rule.id}>
                      <td className="py-2 pr-4 font-mono text-fg-secondary">{rule.action}</td>
                      <td className="py-2 pr-4">
                        <Input
                          type="number"
                          value={String(cur.base_points)}
                          onChange={(ev) => patch(rule.id, 'base_points', parseInt(ev.target.value, 10))}
                          disabled={!canEdit}
                          className="w-20"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <Input
                          type="number"
                          placeholder="∞"
                          value={cur.max_per_day != null ? String(cur.max_per_day) : ''}
                          onChange={(ev) => patch(rule.id, 'max_per_day', ev.target.value ? parseInt(ev.target.value, 10) : null)}
                          disabled={!canEdit}
                          className="w-20"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <Input
                          type="number"
                          placeholder="∞"
                          value={cur.max_per_user_lifetime != null ? String(cur.max_per_user_lifetime) : ''}
                          onChange={(ev) => patch(rule.id, 'max_per_user_lifetime', ev.target.value ? parseInt(ev.target.value, 10) : null)}
                          disabled={!canEdit}
                          className="w-20"
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={Boolean(cur.enabled)}
                          onChange={(e) => patch(rule.id, 'enabled', e.target.checked)}
                          disabled={!canEdit}
                          className="h-3.5 w-3.5 rounded border-edge text-brand focus:ring-brand/50"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

// ─── Tier ladder tab ──────────────────────────────────────────

export function TierLadderTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const { data: tiers, loading, error, reload, lastFetchedAt, isValidating } = usePageData<RewardTier[]>(
    `/v1/admin/rewards/tiers`,
  )
  const [saving, setSaving] = useState(false)
  const [edited, setEdited] = useState<Record<string, Partial<RewardTier>>>({})

  const patch = (id: string, key: keyof RewardTier, value: unknown) => {
    setEdited((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
  }

  const saveAll = useCallback(async () => {
    if (!canEdit) return
    setSaving(true)
    const payload = (tiers ?? []).map((t) => ({ ...t, ...(edited[t.id] ?? {}) }))
    const res = await apiFetch('/v1/admin/rewards/tiers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) { toast.success('Tiers saved'); setEdited({}); reload() }
    else toast.error('Save failed')
  }, [tiers, edited, canEdit, reload, toast])

  if (loading) return <TableSkeleton rows={4} />
  if (error) return <ErrorAlert message={error} />

  const allTiers = (tiers ?? []).sort((a, b) => a.points_threshold - b.points_threshold)

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="rounded-xl border border-warn/20 bg-warn/5 p-3 text-xs text-warn">
          Upgrade to Starter or higher to edit tier thresholds.
        </div>
      )}

      <Section
        title="Tier ladder"
        icon={<IconRewards />}
        freshness={{ at: lastFetchedAt, isValidating }}
        action={
          canEdit ? (
            <Btn
              variant="primary"
              size="sm"
              loading={saving}
              onClick={saveAll}
              disabled={Object.keys(edited).length === 0}
            >
              Save tiers
            </Btn>
          ) : undefined
        }
      >
        {allTiers.length === 0 ? (
          <EmptyState
            title="Using default tiers"
            description="Free → Explorer (100 pts) → Contributor (500 pts) → Champion (2 000 pts)"
          />
        ) : (
          <div className="space-y-2">
            {allTiers.map((tier) => {
              const e = edited[tier.id] ?? {}
              const cur = { ...tier, ...e }
              const badgeCls = TIER_BADGE[tier.slug.toLowerCase()] ?? 'bg-surface-overlay text-fg-secondary'
              return (
                <Card key={tier.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-2xs font-semibold capitalize mt-0.5 shrink-0 ${badgeCls}`}>
                      {cur.display_name}
                    </span>
                    <div className="flex-1 grid grid-cols-2 gap-2.5 text-xs">
                      <label className="flex flex-col gap-1">
                        <span className="text-fg-muted text-2xs">Points threshold</span>
                        <Input
                          type="number"
                          value={String(cur.points_threshold)}
                          onChange={(ev) => patch(tier.id, 'points_threshold', parseInt(ev.target.value, 10))}
                          disabled={!canEdit}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-fg-muted text-2xs">Display name</span>
                        <Input
                          value={cur.display_name}
                          onChange={(ev) => patch(tier.id, 'display_name', ev.target.value)}
                          disabled={!canEdit}
                        />
                      </label>
                      {cur.monetary_reward_usd != null && (
                        <label className="flex flex-col gap-1">
                          <span className="text-fg-muted text-2xs">Monetary reward (USD)</span>
                          <Input
                            type="number"
                            step="0.01"
                            value={String(cur.monetary_reward_usd)}
                            onChange={(ev) => patch(tier.id, 'monetary_reward_usd', parseFloat(ev.target.value))}
                            disabled={!canEdit}
                          />
                        </label>
                      )}
                    </div>
                    <label className="flex items-center gap-1.5 text-2xs text-fg-muted shrink-0 mt-1">
                      <input
                        type="checkbox"
                        checked={Boolean(cur.enabled)}
                        onChange={(ev) => patch(tier.id, 'enabled', ev.target.checked)}
                        disabled={!canEdit}
                        className="h-3.5 w-3.5 rounded border-edge text-brand focus:ring-brand/50"
                      />
                      Enabled
                    </label>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

// ─── Contributor detail types ────────────────────────────────

interface ContributorActivityEvent {
  action: string
  points_awarded: number | null
  rejected_reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface ContributorProfile {
  id: string
  external_user_id: string
  display_name: string | null
  anti_fraud_flags: string[]
  first_seen_at: string | null
  last_seen_at: string | null
  organization_id: string
  project_id: string | null
  metadata: Record<string, unknown> | null
}

interface ContributorDetail {
  profile: ContributorProfile
  points: {
    total_points: number
    current_tier_id: string | null
    reward_tiers: { slug: string; display_name: string; points_threshold: number } | null
  } | null
  activity: ContributorActivityEvent[]
}

// ─── Contributor detail drawer ───────────────────────────────

export function ContributorDrawer({
  endUserId,
  displayName,
  onClose,
  onDataChange,
}: {
  endUserId: string
  displayName: string | null
  onClose: () => void
  onDataChange?: () => void
}) {
  const toast = useToast()
  const { data: tiers } = usePageData<RewardTier[]>('/v1/admin/rewards/tiers')
  const { data: detail, loading, error, reload: reloadDetail } = usePageData<ContributorDetail>(
    endUserId ? `/v1/admin/rewards/contributors/${endUserId}` : null,
    { deps: [endUserId] },
  )

  const [bonusPoints, setBonusPoints]   = useState('')
  const [bonusReason, setBonusReason]   = useState('')
  const [awardingBonus, setAwardingBonus] = useState(false)
  const [overrideTier, setOverrideTier] = useState('')
  const [tierReason, setTierReason]     = useState('')
  const [settingTier, setSettingTier]   = useState(false)
  const [showActions, setShowActions]   = useState(false)

  const awardBonus = useCallback(async () => {
    const pts = parseInt(bonusPoints, 10)
    if (!pts || pts < 1) { toast.error('Enter a positive point amount'); return }
    if (!bonusReason.trim()) { toast.error('Reason is required'); return }
    setAwardingBonus(true)
    const res = await apiFetch('/v1/admin/rewards/bonus-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ end_user_id: endUserId, points: pts, reason: bonusReason.trim() }),
    })
    setAwardingBonus(false)
    if (res.ok) {
      toast.success(`+${pts} pts awarded`)
      setBonusPoints('')
      setBonusReason('')
      reloadDetail()
      onDataChange?.()
    } else {
      toast.error('Failed to award bonus')
    }
  }, [bonusPoints, bonusReason, endUserId, reloadDetail, onDataChange, toast])

  const setTier = useCallback(async () => {
    if (!overrideTier) { toast.error('Select a tier'); return }
    setSettingTier(true)
    const res = await apiFetch('/v1/admin/rewards/set-tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ end_user_id: endUserId, tier_slug: overrideTier, reason: tierReason.trim() || undefined }),
    })
    setSettingTier(false)
    if (res.ok) {
      toast.success('Tier updated')
      setOverrideTier('')
      setTierReason('')
      reloadDetail()
      onDataChange?.()
    } else {
      toast.error('Failed to update tier')
    }
  }, [overrideTier, tierReason, endUserId, reloadDetail, onDataChange, toast])

  const ACTION_TONE: Record<string, string> = {
    report_submit:                 'bg-ok-muted text-ok',
    screen_view_unique_per_day:    'bg-info-muted text-info',
    session_minute:                'bg-brand/15 text-brand',
    comment_posted:                'bg-ok-muted text-ok',
    app_launch:                    'bg-surface-overlay text-fg-secondary',
    quest_completed:               'bg-warn-muted text-warn',
  }

  const profileRows: DetailRowItem[] = detail?.profile
    ? [
        { label: 'External ID',  value: detail.profile.external_user_id, mono: true },
        { label: 'Internal ID',  value: detail.profile.id, mono: true },
        { label: 'First seen',   value: detail.profile.first_seen_at
          ? new Date(detail.profile.first_seen_at).toLocaleString()
          : '—' },
        { label: 'Last seen',    value: detail.profile.last_seen_at
          ? new Date(detail.profile.last_seen_at).toLocaleString()
          : '—' },
        ...(detail.profile.project_id
          ? [{ label: 'Project', value: detail.profile.project_id, mono: true }] as DetailRowItem[]
          : []),
        ...(detail.profile.metadata
          ? [{ label: 'Custom metadata', value: JSON.stringify(detail.profile.metadata), mono: true }] as DetailRowItem[]
          : []),
      ]
    : []

  const tierBadge = detail?.points?.reward_tiers
    ? (TIER_BADGE[detail.points.reward_tiers.slug.toLowerCase()] ?? 'bg-surface-overlay text-fg-secondary')
    : null

  return (
    <Drawer
      open={!!endUserId}
      onClose={onClose}
      width="md"
      title={
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-fg truncate">
            {displayName ?? endUserId.slice(0, 12)}
          </span>
          {tierBadge && detail?.points?.reward_tiers && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold capitalize shrink-0 ${tierBadge}`}>
              {detail.points.reward_tiers.display_name}
            </span>
          )}
        </div>
      }
      headerAction={
        <button
          onClick={() => setShowActions((v) => !v)}
          className={`text-2xs font-medium px-2 py-0.5 rounded transition-colors ${showActions ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-overlay'}`}
        >
          Admin actions
        </button>
      }
    >
      {loading && <TableSkeleton rows={6} />}
      {error && <div className="p-4 text-xs text-danger">{error}</div>}

      {detail && (
        <div className="p-4 space-y-5 overflow-y-auto">

          {/* ── Admin action panel ─── */}
          {showActions && (
            <div className="rounded-xl border border-brand/20 bg-brand/5 p-3 space-y-3">
              <div className="text-2xs font-semibold text-fg uppercase tracking-wider">Admin actions</div>

              {/* Award bonus points */}
              <div className="space-y-1.5">
                <div className="text-2xs text-fg-secondary font-medium">Award bonus points</div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="pts"
                    min={1}
                    max={50000}
                    value={bonusPoints}
                    onChange={(e) => setBonusPoints(e.target.value)}
                    className="w-24"
                  />
                  <Input
                    placeholder="Reason (e.g. beta participation)"
                    value={bonusReason}
                    onChange={(e) => setBonusReason(e.target.value)}
                    className="flex-1"
                  />
                  <Btn variant="success" size="sm" loading={awardingBonus} onClick={awardBonus}>
                    Award
                  </Btn>
                </div>
              </div>

              {/* Override tier */}
              <div className="space-y-1.5 border-t border-brand/15 pt-2.5">
                <div className="text-2xs text-fg-secondary font-medium">Override tier</div>
                <div className="flex gap-2">
                  <SelectField
                    value={overrideTier}
                    onChange={(e) => setOverrideTier(e.target.value)}
                    className="flex-1"
                  >
                    <option value="">— select tier —</option>
                    {(tiers ?? []).map((t) => (
                      <option key={t.id} value={t.slug}>{t.display_name}</option>
                    ))}
                  </SelectField>
                  <Input
                    placeholder="Reason (optional)"
                    value={tierReason}
                    onChange={(e) => setTierReason(e.target.value)}
                    className="flex-1"
                  />
                  <Btn variant="ghost" size="sm" loading={settingTier} onClick={setTier}>
                    Set
                  </Btn>
                </div>
              </div>
            </div>
          )}

          {/* ── KPI strip ─── */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Lifetime points"
              value={(detail.points?.total_points ?? 0).toLocaleString()}
              hint="Total points earned since first activity."
            />
            <StatCard
              label="Activity events"
              value={detail.activity.length}
              hint="Last 100 activity events on record."
            />
          </div>

          {/* ── Anti-fraud flags ─── */}
          {(detail.profile.anti_fraud_flags ?? []).length > 0 && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs">
              <div className="font-semibold text-danger mb-1">Anti-fraud flags</div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {detail.profile.anti_fraud_flags.map((f) => (
                  <Badge key={f} className="bg-danger-muted text-danger text-2xs">{f}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* ── Profile metadata ─── */}
          <Section title="Profile" icon={<IconUser />}>
            <DetailRows items={profileRows} dense />
          </Section>

          {/* ── Activity log ─── */}
          <Section title={`Activity log (${detail.activity.length} events)`} icon={<IconGauge />}>
            {detail.activity.length === 0 ? (
              <EmptyState title="No activity recorded" description="Activity events appear here as the user interacts with the SDK." />
            ) : (
              <div className="divide-y divide-edge-subtle text-xs max-h-[420px] overflow-y-auto">
                {detail.activity.map((ev, i) => {
                  const tone = ACTION_TONE[ev.action] ?? 'bg-surface-overlay text-fg-secondary'
                  const rejected = !!ev.rejected_reason
                  const hasMeta = ev.metadata && Object.keys(ev.metadata).length > 0
                  return (
                    <ActivityEventRow
                      key={i}
                      event={ev}
                      tone={tone}
                      rejected={rejected}
                      hasMeta={hasMeta}
                    />
                  )
                })}
              </div>
            )}
          </Section>

        </div>
      )}
    </Drawer>
  )
}

export function ActivityEventRow({
  event,
  tone,
  rejected,
  hasMeta,
}: {
  event: ContributorActivityEvent
  tone: string
  rejected: boolean
  hasMeta: boolean | null
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`py-2 ${rejected ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-mono shrink-0 mt-0.5 ${tone}`}>
          {event.action.replace(/_/g, ' ')}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {event.points_awarded != null && !rejected && (
                <span className="font-semibold text-fg tabular-nums font-mono">+{event.points_awarded} pts</span>
              )}
              {rejected && (
                <Badge className="bg-surface-overlay text-fg-faint text-2xs">rejected</Badge>
              )}
              {rejected && event.rejected_reason && (
                <span className="text-fg-faint text-2xs truncate max-w-[150px]">{event.rejected_reason}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-fg-faint">
                <RelativeTime value={event.created_at} />
              </span>
              {hasMeta && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-fg-faint hover:text-fg transition-colors"
                  aria-label="Toggle metadata"
                >
                  {expanded
                    ? <IconChevronUp className="h-3 w-3" />
                    : <IconChevronDown className="h-3 w-3" />
                  }
                </button>
              )}
            </div>
          </div>
          {expanded && hasMeta && (
            <pre className="mt-1 text-2xs font-mono text-fg-muted bg-surface-overlay rounded p-1.5 overflow-auto max-h-24 break-all whitespace-pre-wrap">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Contributors tab ────────────────────────────────────────

type ContributorRange = '30d' | 'all'
type ContributorView  = 'ranked' | 'grouped'

interface LeaderboardMeta { range: string; limit: number; offset: number; total: number }
interface LeaderboardPage { data: Contributor[]; meta: LeaderboardMeta }

const PAGE_SIZE = 25

export function ContributorsTab() {
  const { data: tiers } = usePageData<RewardTier[]>('/v1/admin/rewards/tiers')

  const [range,   setRange]   = useState<ContributorRange>('30d')
  const [view,    setView]    = useState<ContributorView>('ranked')
  const [search,  setSearch]  = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('') // '' = all
  const [page,    setPage]    = useState(0)

  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)

  // Debounce search by 300ms
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchChange = useCallback((v: string) => {
    setSearch(v)
    setPage(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 300)
  }, [])

  const params = new URLSearchParams({
    range,
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  })
  if (debouncedSearch) params.set('search', debouncedSearch)
  if (tierFilter)      params.set('tier', tierFilter)

  const { data: page_data, loading, error, reload, lastFetchedAt, isValidating } =
    usePageData<LeaderboardPage>(`/v1/admin/rewards/leaderboard?${params.toString()}`, {
      deps: [range, debouncedSearch, tierFilter, page],
    })

  useRealtimeReload(['end_user_points'], reload, { debounceMs: 3_000 })

  const contributors = page_data?.data ?? []
  const total        = page_data?.meta?.total ?? 0
  const totalPages   = Math.ceil(total / PAGE_SIZE)

  // Group by tier for the "grouped" view
  const grouped = useMemo(() => {
    if (view !== 'grouped') return null
    const map = new Map<string, { label: string; slug: string; items: Contributor[] }>()
    for (const c of contributors) {
      const key = c.reward_tiers?.slug ?? 'none'
      if (!map.has(key)) {
        map.set(key, { label: c.reward_tiers?.display_name ?? 'No tier', slug: key, items: [] })
      }
      map.get(key)!.items.push(c)
    }
    return [...map.entries()].sort(([a], [b]) => {
      const order = ['champion', 'contributor', 'explorer', 'none']
      return order.indexOf(a) - order.indexOf(b)
    })
  }, [contributors, view])

  const tierOptions = useMemo(() => {
    const opts = [{ id: '', label: 'All tiers' }]
    for (const t of tiers ?? []) opts.push({ id: t.slug, label: t.display_name })
    opts.push({ id: 'none', label: 'No tier' })
    return opts
  }, [tiers])

  const openDrawer = useCallback((c: Contributor) => {
    setSelectedId(c.end_user_id)
    setSelectedName((c.end_users as { display_name?: string | null })?.display_name ?? (c.end_users as { external_user_id?: string })?.external_user_id ?? null)
  }, [])

  const renderRow = useCallback((c: Contributor, rank: number) => {
    const flags   = c.end_users?.anti_fraud_flags ?? []
    const hasFlag = flags.length > 0
    const tierBadge = c.reward_tiers
      ? (TIER_BADGE[c.reward_tiers.slug.toLowerCase()] ?? 'bg-surface-overlay text-fg-secondary')
      : null
    const lastSeen   = c.end_users?.last_seen_at ? new Date(c.end_users.last_seen_at) : null
    const atRisk     = lastSeen ? (Date.now() - lastSeen.getTime()) > 7 * 24 * 60 * 60 * 1000 : false
    const pts        = range === '30d' ? c.points_30d : c.total_points

    return (
      <tr
        key={c.end_user_id}
        className={`cursor-pointer transition-colors ${hasFlag ? 'bg-danger/5 hover:bg-danger/8' : 'hover:bg-surface-overlay/50'}`}
        onClick={() => openDrawer(c)}
      >
        <td className="py-2.5 pr-3 text-fg-faint tabular-nums w-8">{rank}</td>
        <td className="py-2.5 pr-4 max-w-0 w-[35%]">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="min-w-0">
              <div className="font-medium text-fg truncate flex items-center gap-1">
                {c.end_users?.display_name ?? c.end_users?.external_user_id ?? '—'}
                {atRisk && (
                  <span title="No activity in 7+ days" className="inline-block w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                )}
              </div>
              <div className="text-fg-faint font-mono truncate text-2xs">
                {c.end_users?.external_user_id}
              </div>
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-4">
          {tierBadge && c.reward_tiers ? (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold capitalize ${tierBadge}`}>
              {c.reward_tiers.display_name}
            </span>
          ) : <span className="text-fg-faint">—</span>}
        </td>
        <td className="py-2.5 pr-4 tabular-nums font-mono font-semibold text-fg text-right">
          {pts.toLocaleString()}
        </td>
        <td className="py-2.5 pr-4 text-fg-muted">
          {lastSeen ? <RelativeTime value={lastSeen.toISOString()} /> : '—'}
        </td>
        <td className="py-2.5 pr-2">
          {hasFlag
            ? <Badge className="bg-danger-muted text-danger text-2xs">{flags[0]}{flags.length > 1 ? ` +${flags.length - 1}` : ''}</Badge>
            : <span className="text-fg-faint">—</span>
          }
        </td>
        <td className="py-2.5 text-fg-faint w-6">
          <IconChevronRight className="h-3 w-3" />
        </td>
      </tr>
    )
  }, [range, openDrawer])

  return (
    <>
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <Input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by name or ID…"
          className="w-52"
        />
        <SegmentedControl
          value={tierFilter}
          options={tierOptions}
          onChange={(v) => { setTierFilter(v); setPage(0) }}
          ariaLabel="Filter by tier"
          size="sm"
        />
        <div className="flex-1" />
        <SegmentedControl
          value={range}
          options={[
            { id: '30d', label: '30 days' },
            { id: 'all', label: 'All time' },
          ]}
          onChange={(v) => { setRange(v as ContributorRange); setPage(0) }}
          ariaLabel="Time range"
          size="sm"
        />
        <SegmentedControl
          value={view}
          options={[
            { id: 'ranked', label: 'Ranked' },
            { id: 'grouped', label: 'By tier' },
          ]}
          onChange={(v) => setView(v as ContributorView)}
          ariaLabel="View mode"
          size="sm"
        />
      </div>

      <Section
        title={total > 0 ? `${total.toLocaleString()} contributors` : 'Contributors'}
        icon={<IconUser />}
        freshness={{ at: lastFetchedAt, isValidating }}
      >
        {loading && <TableSkeleton rows={PAGE_SIZE} />}
        {error && <ErrorAlert message={error} />}

        {!loading && !error && contributors.length === 0 && (
          <EmptyState
            title={debouncedSearch || tierFilter ? 'No matches' : 'No contributors yet'}
            description={debouncedSearch || tierFilter
              ? 'Try adjusting your search or filter.'
              : 'Enable rewards on a project and identify users via the SDK.'}
          />
        )}

        {!loading && !error && contributors.length > 0 && (
          <>
            {/* ── Ranked flat view ── */}
            {view === 'ranked' && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-edge-subtle text-left text-fg-muted uppercase tracking-wider text-2xs">
                      <th className="py-2 pr-3 w-8">#</th>
                      <th className="py-2 pr-4">User</th>
                      <th className="py-2 pr-4">Tier</th>
                      <th className="py-2 pr-4 text-right">{range === '30d' ? 'Pts (30d)' : 'Pts (all)'}</th>
                      <th className="py-2 pr-4">Last seen</th>
                      <th className="py-2 pr-2">Flags</th>
                      <th className="py-2 w-6" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge-subtle">
                    {contributors.map((c, i) => renderRow(c, page * PAGE_SIZE + i + 1))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Grouped by tier view ── */}
            {view === 'grouped' && grouped && (
              <div className="space-y-4">
                {grouped.map(([slug, group]) => {
                  const badgeCls = TIER_BADGE[slug.toLowerCase()] ?? 'bg-surface-overlay text-fg-secondary'
                  const groupPts = group.items.reduce((s, c) => s + (range === '30d' ? c.points_30d : c.total_points), 0)
                  return (
                    <div key={slug}>
                      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-edge-subtle">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold capitalize ${badgeCls}`}>
                          {group.label}
                        </span>
                        <span className="text-xs text-fg-muted">{group.items.length} users</span>
                        <span className="text-xs font-mono text-fg-muted">
                          · {groupPts.toLocaleString()} pts total
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <tbody className="divide-y divide-edge-subtle">
                            {group.items.map((c, i) => renderRow(c, i + 1))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t border-edge-subtle text-xs">
                <span className="text-fg-muted">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                </span>
                <div className="flex gap-1.5">
                  <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    ← Prev
                  </Btn>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const p = totalPages <= 7 ? i : i === 0 ? 0 : i === 6 ? totalPages - 1 : page - 2 + i
                    if (p < 0 || p >= totalPages) return null
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${p === page ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-overlay'}`}
                      >
                        {p + 1}
                      </button>
                    )
                  })}
                  <Btn variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                    Next →
                  </Btn>
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── At-risk legend ── */}
      {contributors.some((c) => {
        const ls = c.end_users?.last_seen_at ? new Date(c.end_users.last_seen_at) : null
        return ls && (Date.now() - ls.getTime()) > 7 * 24 * 60 * 60 * 1000
      }) && (
        <p className="text-2xs text-fg-faint mt-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn mr-1" />
          Orange dot = no activity in 7+ days — consider a re-engagement campaign.
        </p>
      )}

      {selectedId && (
        <ContributorDrawer
          endUserId={selectedId}
          displayName={selectedName}
          onClose={() => { setSelectedId(null); setSelectedName(null) }}
          onDataChange={reload}
        />
      )}
    </>
  )
}

// ─── Identity providers section ──────────────────────────────

const PROVIDER_DEFAULTS: Record<string, { jwks_url: string; issuer: string; label: string }> = {
  apple:    { label: 'Apple Sign In',  jwks_url: 'https://appleid.apple.com/auth/keys', issuer: 'https://appleid.apple.com' },
  google:   { label: 'Google Sign In', jwks_url: 'https://www.googleapis.com/oauth2/v3/certs', issuer: 'https://accounts.google.com' },
  supabase: { label: 'Supabase Auth',  jwks_url: '', issuer: '' },
  custom:   { label: 'Custom OIDC',    jwks_url: '', issuer: '' },
}

export function IdentityProvidersSection({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const { data: providers, loading, error, reload: reloadProviders } = usePageData<IdentityProvider[]>('/v1/admin/rewards/identity-providers')
  const { data: projects } = usePageData<ProjectOption[]>('/v1/admin/projects')

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    project_id: '',
    provider: 'supabase' as IdentityProvider['provider'],
    jwks_url: PROVIDER_DEFAULTS.supabase.jwks_url,
    audience: '',
    issuer: PROVIDER_DEFAULTS.supabase.issuer,
  })

  const setProvider = useCallback((p: IdentityProvider['provider']) => {
    const defaults = PROVIDER_DEFAULTS[p]
    setForm((prev) => ({ ...prev, provider: p, jwks_url: defaults.jwks_url, issuer: defaults.issuer }))
  }, [])

  const saveProvider = useCallback(async () => {
    if (!form.project_id || !form.jwks_url) { toast.error('Project and JWKS URL are required'); return }
    setSaving(true)
    const res = await apiFetch('/v1/admin/rewards/identity-providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: form.project_id, provider: form.provider, jwks_url: form.jwks_url, audience: form.audience || null, issuer: form.issuer || null }),
    })
    setSaving(false)
    if (res.ok) { toast.success('Identity provider saved'); setShowForm(false); reloadProviders() }
    else toast.error('Failed to save identity provider')
  }, [form, reloadProviders, toast])

  const toggleProvider = useCallback(async (id: string, enabled: boolean) => {
    const res = await apiFetch(`/v1/admin/rewards/identity-providers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (res.ok) reloadProviders()
    else toast.error('Failed to update provider')
  }, [reloadProviders, toast])

  const deleteProvider = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/rewards/identity-providers/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Provider removed'); reloadProviders() }
    else toast.error('Failed to remove provider')
  }, [reloadProviders, toast])

  if (loading) return <TableSkeleton rows={2} />
  if (error) return <ErrorAlert message={error} />

  return (
    <Section
      title="Identity verification"
      icon={<IconShield />}
      action={
        canEdit ? (
          <Btn variant="ghost" size="sm" onClick={() => setShowForm(!showForm)}>
            Add provider
          </Btn>
        ) : undefined
      }
    >
      <p className="text-2xs text-fg-muted mb-3">
        Configure JWKS endpoints for Apple, Google, or Supabase sign-in. A verified JWT is{' '}
        <strong>required</strong> before any monetary payout is processed (KYC/AML gate).
      </p>

      {showForm && (
        <Card className="p-3 mb-3 space-y-2.5">
          <SelectField
            label="Project"
            value={form.project_id}
            onChange={(ev) => setForm((p) => ({ ...p, project_id: ev.target.value }))}
          >
            <option value="">— select project —</option>
            {(projects ?? []).map((proj) => (
              <option key={proj.id} value={proj.id}>{proj.name}</option>
            ))}
          </SelectField>
          <SelectField
            label="Provider"
            value={form.provider}
            onChange={(ev) => setProvider(ev.target.value as IdentityProvider['provider'])}
          >
            {Object.entries(PROVIDER_DEFAULTS).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </SelectField>
          <Input
            label="JWKS URL (HTTPS)"
            placeholder="https://…/.well-known/jwks.json"
            value={form.jwks_url}
            onChange={(ev) => setForm((p) => ({ ...p, jwks_url: ev.target.value }))}
          />
          <Input
            label="Audience (optional)"
            placeholder="e.g. com.yourapp.bundle"
            value={form.audience}
            onChange={(ev) => setForm((p) => ({ ...p, audience: ev.target.value }))}
          />
          <Input
            label="Issuer (optional)"
            placeholder="e.g. https://accounts.google.com"
            value={form.issuer}
            onChange={(ev) => setForm((p) => ({ ...p, issuer: ev.target.value }))}
          />
          <p className="text-2xs text-fg-faint">JWKS payloads are cached for 6 hours to avoid rate-limit issues.</p>
          <div className="flex gap-2 justify-end pt-1">
            <Btn variant="cancel" size="sm" onClick={() => setShowForm(false)}>Cancel</Btn>
            <Btn variant="primary" size="sm" loading={saving} onClick={saveProvider}>Save</Btn>
          </div>
        </Card>
      )}

      {(providers ?? []).length === 0 && !showForm && (
        <EmptyState
          title="No identity providers configured"
          description="Add an Apple, Google, or Supabase JWKS endpoint to unlock monetary payouts."
        />
      )}

      {(providers ?? []).map((p) => (
        <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-edge-subtle last:border-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-fg capitalize">{p.provider}</span>
              <Badge className={p.enabled ? 'bg-ok-muted text-ok text-2xs' : 'bg-surface-overlay text-fg-muted text-2xs'}>
                {p.enabled ? 'Active' : 'Disabled'}
              </Badge>
            </div>
            <div className="text-2xs text-fg-faint mt-0.5 truncate max-w-xs font-mono">{p.jwks_url}</div>
            {p.audience && <div className="text-2xs text-fg-faint">aud: {p.audience}</div>}
          </div>
          {canEdit && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Btn variant="ghost" size="sm" onClick={() => toggleProvider(p.id, !p.enabled)}>
                {p.enabled ? 'Disable' : 'Enable'}
              </Btn>
              <Btn variant="ghost" size="sm" onClick={() => deleteProvider(p.id)}>Remove</Btn>
            </div>
          )}
        </div>
      ))}
    </Section>
  )
}

// ─── Disputes section ────────────────────────────────────────

interface DisputeRow {
  id: string
  end_user_id: string
  payout_id: string | null
  reason: string
  status: string
  resolution_notes: string | null
  opened_at: string
  resolved_at: string | null
  end_users: { external_user_id: string; display_name: string | null } | null
}

const DISPUTE_BADGE: Record<string, string> = {
  open:         'bg-warn-muted text-warn',
  under_review: 'bg-info-muted text-info',
  approved:     'bg-ok-muted text-ok',
  denied:       'bg-danger-muted text-danger',
  withdrawn:    'bg-surface-overlay text-fg-muted',
}

export function DisputesSection() {
  const toast = useToast()
  const { data: disputes, loading, error, reload } = usePageData<DisputeRow[]>('/v1/admin/rewards/disputes')
  const [resolving, setResolving] = useState<string | null>(null)

  const resolve = useCallback(async (id: string, decision: 'approved' | 'denied') => {
    setResolving(id)
    const res = await apiFetch(`/v1/admin/rewards/disputes/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    setResolving(null)
    if (res.ok) { toast.success(`Dispute ${decision}`); reload() }
    else toast.error('Failed to resolve dispute')
  }, [reload, toast])

  if (loading) return <TableSkeleton rows={2} />
  if (error) {
    return (
      <Section title="Disputes" icon={<IconShield />}>
        <ErrorAlert message={error} onRetry={reload} />
      </Section>
    )
  }

  if ((disputes ?? []).length === 0) return null

  return (
    <Section title="Disputes" icon={<IconShield />}>
      <p className="text-2xs text-fg-muted mb-3">
        Review flagged rewards. Denied disputes cancel associated pending payouts and remain on the ledger.
      </p>
      <div className="divide-y divide-edge-subtle text-xs">
        {(disputes ?? []).map((d) => (
          <div key={d.id} className="py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-fg">
                    {d.end_users?.display_name ?? d.end_users?.external_user_id ?? d.end_user_id.slice(0, 8)}
                  </span>
                  <Badge className={`text-2xs ${DISPUTE_BADGE[d.status] ?? 'bg-surface-overlay text-fg-muted'}`}>
                    {d.status}
                  </Badge>
                </div>
                <p className="text-2xs text-fg-muted mt-0.5 break-words">{d.reason}</p>
                {d.resolution_notes && (
                  <p className="text-2xs text-fg-secondary mt-0.5">Resolution: {d.resolution_notes}</p>
                )}
                <p className="text-2xs text-fg-faint mt-0.5">
                  Opened <RelativeTime value={d.opened_at} />
                  {d.resolved_at && <> · Resolved <RelativeTime value={d.resolved_at} /></>}
                </p>
              </div>
              {(d.status === 'open' || d.status === 'under_review') && (
                <div className="flex gap-1.5 shrink-0">
                  <Btn variant="ghost" size="sm" loading={resolving === d.id} onClick={() => resolve(d.id, 'approved')}>Approve</Btn>
                  <Btn variant="ghost" size="sm" loading={resolving === d.id} onClick={() => resolve(d.id, 'denied')}>Deny</Btn>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Payout ledger ───────────────────────────────────────────

interface PayoutRow {
  id: string
  amount_usd: number
  currency: string
  status: string
  tier_slug: string | null
  requested_at: string
  paid_at: string | null
  end_user_id: string
}

const PAYOUT_BADGE: Record<string, string> = {
  paid:       'bg-ok-muted text-ok',
  pending:    'bg-warn-muted text-warn',
  processing: 'bg-info-muted text-info',
  failed:     'bg-danger-muted text-danger',
  withheld:   'bg-surface-overlay text-fg-muted',
  cancelled:  'bg-surface-overlay text-fg-muted',
}

export function PayoutLiabilitySection() {
  const { has } = useEntitlements()
  const { data: payouts, loading, error, reload } = usePageData<PayoutRow[]>('/v1/admin/rewards/payouts')
  if (!has('rewards_monetary')) return null
  if (loading) return <TableSkeleton rows={3} />
  if (error) {
    return (
      <Section title="Payout ledger" icon={<IconBilling />}>
        <ErrorAlert message={error} onRetry={reload} />
      </Section>
    )
  }

  return (
    <Section title="Payout ledger" icon={<IconBilling />}>
      <p className="text-2xs text-fg-muted mb-3">
        Monetary payouts via Stripe Connect Express. Aggregator runs on the 1st of each month.
        KYC must be complete and anti-fraud flags must be clear before funds transfer.
      </p>
      {(payouts ?? []).length === 0 ? (
        <EmptyState
          title="No payouts yet"
          description="Payouts are enqueued when a user reaches a tier with monetary_reward_usd configured."
        />
      ) : (
        <div className="divide-y divide-edge-subtle text-xs">
          {(payouts ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between py-2.5">
              <div>
                <span className="font-medium font-mono text-fg">${Number(p.amount_usd).toFixed(2)} {p.currency.toUpperCase()}</span>
                {p.tier_slug && <span className="text-fg-muted ml-2 capitalize">{p.tier_slug}</span>}
                <div className="text-2xs text-fg-faint mt-0.5">
                  <RelativeTime value={p.requested_at} />
                  {p.paid_at && <> → paid <RelativeTime value={p.paid_at} /></>}
                </div>
              </div>
              <Badge className={`text-2xs ${PAYOUT_BADGE[p.status] ?? 'bg-surface-overlay text-fg-muted'}`}>
                {p.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ─── Settings tab ────────────────────────────────────────────

export function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const { data: webhooks, loading, error, reload } = usePageData<WebhookRow[]>('/v1/admin/rewards/webhooks')
  const [showNewWebhook, setShowNewWebhook] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const createWebhook = useCallback(async () => {
    if (!webhookUrl || !webhookSecret) return
    setSaving(true)
    const res = await apiFetch('/v1/admin/rewards/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, secret: webhookSecret, events: ['reward.tier_changed'] }),
    })
    setSaving(false)
    if (res.ok) { toast.success('Webhook created'); setShowNewWebhook(false); setWebhookUrl(''); setWebhookSecret(''); reload() }
    else toast.error('Failed to create webhook')
  }, [webhookUrl, webhookSecret, reload, toast])

  const deleteWebhook = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/rewards/webhooks/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Webhook deleted'); reload() }
  }, [reload, toast])

  const testWebhooks = useCallback(async () => {
    setTesting(true)
    const res = await apiFetch('/v1/admin/rewards/webhooks/test', { method: 'POST' })
    setTesting(false)
    if (res.ok) toast.success('Test webhook delivered')
    else toast.error('Test webhook failed')
  }, [toast])

  if (loading) return <TableSkeleton rows={3} />
  if (error) return <ErrorAlert message={error} />

  return (
    <div className="space-y-4">
      <Section
        title="Host webhooks"
        icon={<IconIntegrations />}
        action={
          canEdit ? (
            <Btn variant="ghost" size="sm" onClick={() => setShowNewWebhook(!showNewWebhook)}>
              Add webhook
            </Btn>
          ) : undefined
        }
      >
        <p className="text-2xs text-fg-muted mb-3">
          Receive a signed POST when a user's tier changes. Use this to apply credits, badges, or Pro access in your app.
        </p>

        {showNewWebhook && (
          <Card className="p-3 mb-3 space-y-2.5">
            <Input
              label="Endpoint URL (HTTPS)"
              placeholder="https://yourapp.com/api/mushi/reward-webhook"
              value={webhookUrl}
              onChange={(ev) => setWebhookUrl(ev.target.value)}
            />
            <Input
              label="Signing secret (≥ 16 chars, optional)"
              type="password"
              placeholder="Leave blank to auto-generate — shown once after save"
              value={webhookSecret}
              onChange={(ev) => setWebhookSecret(ev.target.value)}
            />
            <p className="text-2xs text-fg-faint">
              Leave blank to auto-generate a secret. It is shown once after saving — copy it immediately.
              Wire it as <code className="font-mono text-fg-secondary">MUSHI_REWARD_WEBHOOK_SECRET</code> in your server environment to verify the HMAC signature.
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <Btn variant="cancel" size="sm" onClick={() => setShowNewWebhook(false)}>Cancel</Btn>
              <Btn variant="primary" size="sm" loading={saving} onClick={createWebhook}>Save</Btn>
            </div>
          </Card>
        )}

        {(webhooks ?? []).length === 0 && !showNewWebhook && (
          <EmptyState title="No webhooks yet" description="Add one to receive tier-change events in your app." />
        )}

        {(webhooks ?? []).map((w) => (
          <div key={w.id} className="flex items-center justify-between py-2.5 border-b border-edge-subtle last:border-0">
            <div className="min-w-0">
              <div className="text-xs font-medium text-fg truncate max-w-sm font-mono">{w.url}</div>
              <div className="text-2xs text-fg-faint mt-0.5">
                Events: {w.events.join(', ')} ·{' '}
                {w.last_status != null ? (
                  <span className={w.last_status >= 200 && w.last_status < 300 ? 'text-ok' : 'text-danger'}>
                    Last: {w.last_status}
                  </span>
                ) : 'Never delivered'}
              </div>
            </div>
            {canEdit && <Btn variant="ghost" size="sm" onClick={() => deleteWebhook(w.id)}>Remove</Btn>}
          </div>
        ))}

        {(webhooks ?? []).length > 0 && (
          <div className="flex justify-end pt-2">
            <Btn variant="ghost" size="sm" loading={testing} onClick={testWebhooks}>
              Send test event
            </Btn>
          </div>
        )}
      </Section>

      <IdentityProvidersSection canEdit={canEdit} />
      <PayoutLiabilitySection />
      <DisputesSection />
    </div>
  )
}

// ─── Quests tab ──────────────────────────────────────────────

interface QuestStep { action: string; label: string; metadata_match?: Record<string, unknown> | null }
interface QuestRow {
  id: string; name: string; description: string | null; steps: QuestStep[]
  completion_points: number; expires_after_days: number | null; enabled: boolean
  repeatable: boolean; project_id: string | null; created_at: string
}

export function QuestsTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const { data: quests, loading, error, reload } = usePageData<QuestRow[]>('/v1/admin/rewards/quests')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', description: '', completion_points: 50,
    expires_after_days: '' as string | number, repeatable: false,
    steps: [{ action: '', label: '' }] as QuestStep[],
  })

  const addStep = useCallback(() => setForm((f) => ({ ...f, steps: [...f.steps, { action: '', label: '' }] })), [])
  const removeStep = useCallback((i: number) => setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) })), [])
  const patchStep = useCallback((i: number, field: keyof QuestStep, value: string) =>
    setForm((f) => { const steps = [...f.steps]; steps[i] = { ...steps[i], [field]: value }; return { ...f, steps } }), [])

  const saveQuest = useCallback(async () => {
    if (!form.name || form.steps.some((s) => !s.action || !s.label)) { toast.error('Name and all step actions/labels are required'); return }
    setSaving(true)
    const res = await apiFetch('/v1/admin/rewards/quests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, expires_after_days: form.expires_after_days === '' ? null : Number(form.expires_after_days) }),
    })
    setSaving(false)
    if (res.ok) {
      toast.success('Quest saved'); setShowForm(false)
      setForm({ name: '', description: '', completion_points: 50, expires_after_days: '', repeatable: false, steps: [{ action: '', label: '' }] })
      reload()
    } else toast.error('Failed to save quest')
  }, [form, reload, toast])

  const deleteQuest = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/rewards/quests/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Quest deleted'); reload() }
    else toast.error('Failed to delete quest')
  }, [reload, toast])

  const toggleQuest = useCallback(async (quest: QuestRow) => {
    const res = await apiFetch('/v1/admin/rewards/quests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...quest, enabled: !quest.enabled }),
    })
    if (res.ok) reload()
    else toast.error('Failed to update quest')
  }, [reload, toast])

  if (loading) return <TableSkeleton rows={3} />
  if (error) return <ErrorAlert message={error} />

  return (
    <Section
      title="Quests"
      icon={<IconRewards />}
      action={
        canEdit ? (
          <Btn variant="ghost" size="sm" onClick={() => setShowForm(!showForm)}>New quest</Btn>
        ) : undefined
      }
    >
      <p className="text-2xs text-fg-muted mb-3">
        Multi-step goals users complete to earn bonus points. Each step matches an SDK activity action.
        When all steps complete in order the quest awards bonus points and fires a webhook.
      </p>

      {showForm && (
        <Card className="p-3 mb-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <Input
              label="Quest name"
              placeholder="Tour the app"
              value={form.name}
              onChange={(ev) => setForm((f) => ({ ...f, name: ev.target.value }))}
            />
            <Input
              label="Bonus points on completion"
              type="number"
              value={String(form.completion_points)}
              onChange={(ev) => setForm((f) => ({ ...f, completion_points: parseInt(ev.target.value, 10) || 0 }))}
            />
          </div>
          <Input
            label="Description (optional)"
            value={form.description}
            onChange={(ev) => setForm((f) => ({ ...f, description: ev.target.value }))}
          />
          <Input
            label="Expires after (days, optional)"
            type="number"
            placeholder="e.g. 7"
            value={String(form.expires_after_days)}
            onChange={(ev) => setForm((f) => ({ ...f, expires_after_days: ev.target.value }))}
          />
          <div>
            <div className="text-2xs font-medium text-fg-secondary mb-1.5">Steps (in order)</div>
            {form.steps.map((step, i) => (
              <div key={i} className="flex gap-2 items-end mb-1.5">
                <div className="flex-1">
                  <Input label={`Step ${i + 1} action`} placeholder="screen_view" value={step.action} onChange={(ev) => patchStep(i, 'action', ev.target.value)} />
                </div>
                <div className="flex-1">
                  <Input label="Label" placeholder="Visit /pricing" value={step.label} onChange={(ev) => patchStep(i, 'label', ev.target.value)} />
                </div>
                {form.steps.length > 1 && <Btn variant="ghost" size="sm" onClick={() => removeStep(i)}>×</Btn>}
              </div>
            ))}
            <Btn variant="ghost" size="sm" onClick={addStep}>+ Add step</Btn>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Btn variant="cancel" size="sm" onClick={() => setShowForm(false)}>Cancel</Btn>
            <Btn variant="primary" size="sm" loading={saving} onClick={saveQuest}>Save quest</Btn>
          </div>
        </Card>
      )}

      {(quests ?? []).length === 0 && !showForm ? (
        <EmptyState
          title="No quests yet"
          description="Create multi-step goals to guide users through key app flows and reward exploration."
        />
      ) : (
        <div className="space-y-1.5">
          {(quests ?? []).map((q) => (
            <Card key={q.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-xs text-fg">{q.name}</span>
                    <Badge className={q.enabled ? 'text-2xs bg-ok-muted text-ok' : 'text-2xs bg-surface-overlay text-fg-muted'}>
                      {q.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                    <Badge className="text-2xs bg-surface-overlay text-fg-secondary">+{q.completion_points} pts</Badge>
                    {q.repeatable && <Badge className="text-2xs bg-info-muted text-info">Repeatable</Badge>}
                  </div>
                  {q.description && <p className="text-2xs text-fg-muted mt-0.5">{q.description}</p>}
                  <div className="flex gap-1.5 flex-wrap mt-1.5">
                    {q.steps.map((s, i) => (
                      <span key={i} className="text-2xs bg-surface-overlay rounded px-1.5 py-0.5 text-fg-secondary">
                        {i + 1}. {s.label}
                      </span>
                    ))}
                  </div>
                  {q.expires_after_days && (
                    <p className="text-2xs text-fg-faint mt-0.5">Expires {q.expires_after_days}d after start</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex gap-1.5 shrink-0">
                    <Btn variant="ghost" size="sm" onClick={() => toggleQuest(q)}>{q.enabled ? 'Disable' : 'Enable'}</Btn>
                    <Btn variant="ghost" size="sm" onClick={() => deleteQuest(q.id)}>Delete</Btn>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Section>
  )
}

// ─── Retention analytics tab ─────────────────────────────────

interface RetentionData {
  top_tier: { slug: string; display_name: string; count: number; median_retention_days: number }
  all_others: { count: number; median_retention_days: number }
  lift_pct: number | null
}

export function RetentionAnalyticsTab() {
  const { data, loading, error, lastFetchedAt, isValidating } = usePageData<RetentionData>('/v1/admin/rewards/retention-impact')

  if (loading) return <TableSkeleton rows={3} />
  if (error) return <EmptyState title="Could not load retention data" description={String(error)} />

  return (
    <Section
      title="Retention impact"
      icon={<IconDashboard />}
      freshness={{ at: lastFetchedAt, isValidating }}
    >
      <p className="text-2xs text-fg-muted mb-4">
        Compares the median active span (first seen → last seen) for users who reached the highest tier
        vs everyone else. Higher lift = the rewards program drives retention.
      </p>

      {!data ? (
        <EmptyState title="No data yet" description="Retention analytics will appear once contributors earn points." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label={`${data.top_tier.display_name} median`}
              value={`${data.top_tier.median_retention_days}d`}
              hint={`Median active span for ${data.top_tier.count} top-tier user${data.top_tier.count !== 1 ? 's' : ''}.`}
            />
            <StatCard
              label="Others median"
              value={`${data.all_others.median_retention_days}d`}
              hint={`Median active span for the remaining ${data.all_others.count} users.`}
            />
            <StatCard
              label="Retention lift"
              value={data.lift_pct !== null ? `${data.lift_pct > 0 ? '+' : ''}${data.lift_pct}%` : 'n/a'}
              accent={
                data.lift_pct === null ? undefined
                  : data.lift_pct >= 20 ? 'text-ok'
                    : data.lift_pct < 0 ? 'text-danger'
                      : 'text-warn'
              }
              hint="Retention lift = top-tier median relative to the all-others median."
            />
          </div>

          {(data.lift_pct ?? 0) >= 50 && (
            <div className="rounded-xl border border-ok/20 bg-ok/5 p-3 text-xs text-ok">
              Top contributors retain <strong>{data.lift_pct}% longer</strong> than average — a strong
              signal to invest further in the rewards program.
            </div>
          )}
          {(data.lift_pct ?? 0) < 0 && (
            <div className="rounded-xl border border-warn/20 bg-warn/5 p-3 text-xs text-warn">
              Top contributors are retaining <strong>less</strong> than average. Consider adding
              recurring incentives or time-gated perks to retain power users after they hit the top tier.
            </div>
          )}

          <p className="text-2xs text-fg-faint">
            Computed from end_user first_seen_at → last_seen_at. Results update daily.
          </p>
        </div>
      )}
    </Section>
  )
}

// ─── Sandbox simulator tab ───────────────────────────────────

interface SimulationResult {
  total_points: number
  breakdown: Array<{ action: string; count: number; per_event: number; subtotal: number; capped: boolean; unknown: boolean }>
  reached_tier: { id: string; slug: string; display_name: string; host_credit_payload: unknown } | null
  next_tier: { id: string; slug: string; display_name: string; points_threshold: number } | null
}

export function SandboxSimulatorTab() {
  const toast = useToast()
  const [lines, setLines] = useState<Array<{ action: string; count: number }>>([
    { action: 'report_submit', count: 5 },
    { action: 'screen_view_unique_per_day', count: 20 },
    { action: 'session_minute', count: 60 },
    { action: 'comment_posted', count: 2 },
  ])
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [running, setRunning] = useState(false)

  const addLine = useCallback(() => setLines((prev) => [...prev, { action: '', count: 1 }]), [])
  const updateLine = useCallback((idx: number, field: 'action' | 'count', value: string | number) =>
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l)), [])
  const removeLine = useCallback((idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx)), [])

  const run = useCallback(async () => {
    const events = lines.filter((l) => l.action.trim() !== '')
    if (!events.length) { toast.error('Add at least one event'); return }
    setRunning(true)
    const res = await apiFetch<SimulationResult>('/v1/admin/rewards/simulate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }),
    })
    setRunning(false)
    if (res.ok && res.data) setResult(res.data)
    else toast.error('Simulation failed')
  }, [lines, toast])

  return (
    <Section title="Sandbox simulator" icon={<IconQuery />}>
      <p className="text-2xs text-fg-muted mb-4">
        Enter a hypothetical activity log and see how many points it would earn and which tier it would
        reach — without touching real user data. Use this to tune rules before going live.
      </p>

      <div className="space-y-1.5 mb-4">
        {lines.map((line, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                value={line.action}
                onChange={(e) => updateLine(i, 'action', e.target.value)}
                placeholder="action e.g. report_submit"
              />
            </div>
            <div className="w-24">
              <Input
                type="number"
                min={1}
                max={10000}
                value={String(line.count)}
                onChange={(e) => updateLine(i, 'count', parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <span className="text-2xs text-fg-faint pb-2.5">×</span>
            <Btn variant="ghost" size="sm" onClick={() => removeLine(i)}>✕</Btn>
          </div>
        ))}
        <div className="flex items-center gap-2.5 pt-1">
          <Btn variant="ghost" size="sm" onClick={addLine}>+ Add event</Btn>
          <Btn variant="primary" size="sm" loading={running} onClick={run}>Run simulation</Btn>
        </div>
      </div>

      {result && (
        <div className="space-y-4 pt-2 border-t border-edge-subtle">
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Total points" value={result.total_points.toLocaleString()} />
            <StatCard
              label="Reached tier"
              value={result.reached_tier?.display_name ?? '–'}
              accent={result.reached_tier ? 'text-ok' : undefined}
              delta={result.next_tier
                ? { value: `${(result.next_tier.points_threshold - result.total_points).toLocaleString()} to ${result.next_tier.display_name}`, positive: false }
                : undefined
              }
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-fg-secondary mb-1.5 uppercase tracking-wider">Breakdown</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg-muted border-b border-edge-subtle uppercase tracking-wider">
                  <th className="text-left py-1.5">Action</th>
                  <th className="text-right py-1.5">Count</th>
                  <th className="text-right py-1.5">Per event</th>
                  <th className="text-right py-1.5">Subtotal</th>
                  <th className="text-left py-1.5 pl-3">Note</th>
                </tr>
              </thead>
              <tbody>
                {result.breakdown.map((row, i) => (
                  <tr key={i} className="border-b border-edge-subtle">
                    <td className="py-1.5 font-mono text-fg">{row.action}</td>
                    <td className="text-right py-1.5 text-fg-muted tabular-nums">{row.count}</td>
                    <td className="text-right py-1.5 text-fg-muted tabular-nums">{row.unknown ? '–' : row.per_event}</td>
                    <td className="text-right py-1.5 font-semibold text-fg font-mono tabular-nums">
                      {row.unknown ? '–' : row.subtotal.toLocaleString()}
                    </td>
                    <td className="py-1.5 pl-3">
                      {row.unknown && <Badge className="bg-warn-muted text-warn text-2xs">unknown action</Badge>}
                      {row.capped && <Badge className="bg-info-muted text-info text-2xs">daily cap applied</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.reached_tier?.host_credit_payload != null && (
            <div className="rounded-xl bg-surface-overlay border border-edge-subtle p-3">
              <div className="text-2xs font-semibold text-fg-secondary mb-1.5 uppercase tracking-wider">
                Host credit payload that would fire
              </div>
              <pre className="text-2xs text-fg-muted overflow-auto font-mono">
                {JSON.stringify(result.reached_tier.host_credit_payload as Record<string, unknown>, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function IconBilling(p: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={p.className ?? 'h-3.5 w-3.5'} aria-hidden>
      <rect x="1" y="3" width="14" height="10" rx="1.5" />
      <path d="M1 6h14" />
    </svg>
  )
}

