/**
 * FILE: apps/admin/src/components/rewards/PublishingTab.tsx
 * PURPOSE: Wave 2 — Publishing tab on the Rewards page. Lets dev/PM publish
 *   their project's app to the Mushi Bounties tester marketplace.
 *   Gated by the `marketplace_publish` entitlement (Pro+ plans, cloud-only).
 */

import { useState, useCallback } from 'react'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { useEntitlements } from '../../lib/useEntitlements'
import {
  Card,
  Section,
  Btn,
  Input,
  EmptyState,
  ErrorAlert,
  Badge,
} from '../ui'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PublishedApp {
  id: string
  project_id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  hero_url: string | null
  screenshots_urls: string[]
  app_store_url: string | null
  play_store_url: string | null
  web_url: string | null
  platforms: string[]
  sentry_dsn: string | null
  auto_seer_analyze: boolean
  visibility: 'draft' | 'public' | 'invite_only' | 'paused'
  published_at: string | null
  paused_at: string | null
}

interface AppTargeting {
  country_codes: string[]
  languages: string[]
  expertise_tags: string[]
  reputation_min: number
}

interface AppBounty {
  id: string
  action: string
  points_per_event: number
  daily_cap: number | null
  lifetime_cap_per_tester: number | null
  enabled: boolean
}

interface AppStats {
  submissions_30d: number
  accepted_30d: number
  active_testers: number
  points_spent_30d: number
  monthly_budget_usd: number
  monthly_budget_used_pct: number
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function VisibilityBadge({ visibility }: { visibility: PublishedApp['visibility'] }) {
  const map: Record<PublishedApp['visibility'], { label: string; cls: string }> = {
    draft:       { label: 'Draft',       cls: 'bg-surface-overlay text-fg-muted' },
    public:      { label: 'Live',        cls: 'bg-ok-muted text-ok' },
    invite_only: { label: 'Invite only', cls: 'bg-brand/15 text-brand' },
    paused:      { label: 'Paused',      cls: 'bg-warn/10 text-warn' },
  }
  const { label, cls } = map[visibility]
  return <Badge className={cls}>{label}</Badge>
}

function UpgradePrompt() {
  return (
    <EmptyState
      title="Mushi Bounties · Pro feature"
      description="Publish your app to the Mushi Bounties tester marketplace and reward testers with mushi-points. Upgrade to Pro to enable publishing and set a gift-card budget."
      action={
        <Btn
          href="/settings?tab=billing"
          size="sm"
          variant="primary"
        >
          Upgrade to Pro
        </Btn>
      }
    />
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PublishingTabProps {
  projectId: string | null
  canEdit: boolean
}

export function PublishingTab({ projectId, canEdit }: PublishingTabProps) {
  const { has } = useEntitlements()
  const toast = useToast()

  const hasMarketplace = has('marketplace_publish')
  const hasCashout = has('tester_cashout')
  const hasPriority = has('marketplace_priority_listing')

  // Fetch the published app for this project.
  const {
    data: app,
    loading,
    error,
    reload,
  } = usePageData<PublishedApp | null>(
    projectId && hasMarketplace ? `/v1/admin/published-apps/${projectId}` : null,
  )

  const { data: targeting } = usePageData<AppTargeting | null>(
    projectId && hasMarketplace && app?.id
      ? `/v1/admin/published-apps/${projectId}/targeting`
      : null,
  )

  const { data: bounties } = usePageData<AppBounty[] | null>(
    projectId && hasMarketplace && app?.id
      ? `/v1/admin/published-apps/${projectId}/bounties`
      : null,
  )

  const { data: stats } = usePageData<AppStats | null>(
    projectId && hasMarketplace && app?.id
      ? `/v1/admin/published-apps/${projectId}/stats`
      : null,
  )

  // Form state for the app listing
  const [form, setForm] = useState<Partial<PublishedApp>>({})
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)

  const handleSave = useCallback(async () => {
    if (!projectId || !canEdit) return
    setSaving(true)
    try {
      await apiFetch(`/v1/admin/published-apps/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...app, ...form }),
      })
      toast.success('Listing saved')
      setForm({})
      reload()
    } catch (e: unknown) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }, [projectId, canEdit, app, form, toast, reload])

  const handlePublish = useCallback(async () => {
    if (!projectId || !canEdit) return
    setPublishing(true)
    setConfirmPublish(false)
    try {
      await apiFetch(`/v1/admin/published-apps/${projectId}/publish`, { method: 'POST' })
      toast.success('App is now live on Mushi Bounties')
      reload()
    } catch (e: unknown) {
      toast.error(`Failed to publish: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setPublishing(false)
    }
  }, [projectId, canEdit, toast, reload])

  const handlePause = useCallback(async () => {
    if (!projectId || !canEdit) return
    setPausing(true)
    try {
      await apiFetch(`/v1/admin/published-apps/${projectId}/pause`, { method: 'POST' })
      toast.success('Listing paused — no new submissions accepted')
      reload()
    } catch (e: unknown) {
      toast.error(`Failed to pause: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setPausing(false)
    }
  }, [projectId, canEdit, toast, reload])

  // ── Entitlement gate ────────────────────────────────────────────────────────
  if (!hasMarketplace) return <UpgradePrompt />

  if (!projectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project from the header switcher to manage its Bounties listing."
      />
    )
  }

  if (loading) {
    return <div className="text-xs text-fg-muted py-6 text-center">Loading listing…</div>
  }

  if (error) {
    return <ErrorAlert message={`Failed to load listing: ${error}`} onRetry={reload} />
  }

  const live = app?.visibility === 'public'
  const hasDraft = !app

  // ── Empty state: no listing yet ─────────────────────────────────────────────
  if (hasDraft) {
    return (
      <Section title="MUSHI BOUNTIES — PUBLISH YOUR APP">
        <EmptyState
          title="No listing yet"
          description="Create a listing to publish your app to the Mushi Bounties tester marketplace. Testers earn mushi-points for accepted bug reports."
          action={
            <Btn
              size="sm"
              variant="primary"
              onClick={() =>
                apiFetch(`/v1/admin/published-apps/${projectId}`, {
                  method: 'PUT',
                  body: JSON.stringify({ name: 'My App', visibility: 'draft' }),
                }).then(reload)
              }
            >
              Create listing
            </Btn>
          }
        />
      </Section>
    )
  }

  // ── Main listing editor ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <VisibilityBadge visibility={app.visibility} />
        {hasPriority && <Badge className="bg-brand/15 text-brand">Priority listing</Badge>}
        {hasCashout && <Badge className="bg-ok-muted text-ok">Gift-card budget enabled</Badge>}
        {app.visibility === 'public' && (
          <Btn
            size="xs"
            variant="ghost"
            href={`https://kensaur.us/mushi-mushi/testers/apps/${app.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View live listing ↗
          </Btn>
        )}
      </div>

      {/* Card 1: App listing */}
      <Section title="APP LISTING">
        <Card className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="App name"
              value={form.name ?? app.name ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              disabled={!canEdit}
              maxLength={80}
            />
            <Input
              label="URL slug"
              value={form.slug ?? app.slug ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, slug: v }))}
              disabled={!canEdit}
              hint="Appears in the marketplace URL: /testers/apps/your-slug"
            />
          </div>
          <Input
            label="Tagline"
            value={form.tagline ?? app.tagline ?? ''}
            onChange={(v) => setForm((f) => ({ ...f, tagline: v }))}
            disabled={!canEdit}
            maxLength={140}
            hint="One sentence · 140 chars max"
          />
          <Input
            label="Description"
            value={form.description ?? app.description ?? ''}
            onChange={(v) => setForm((f) => ({ ...f, description: v }))}
            disabled={!canEdit}
            multiline
            rows={4}
            maxLength={4000}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Web URL"
              value={form.web_url ?? app.web_url ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, web_url: v }))}
              disabled={!canEdit}
              placeholder="https://your-app.com"
            />
            <Input
              label="App Store URL"
              value={form.app_store_url ?? app.app_store_url ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, app_store_url: v }))}
              disabled={!canEdit}
              placeholder="https://apps.apple.com/…"
            />
            <Input
              label="Play Store URL"
              value={form.play_store_url ?? app.play_store_url ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, play_store_url: v }))}
              disabled={!canEdit}
              placeholder="https://play.google.com/…"
            />
          </div>
          <div>
            <label className="text-2xs font-medium text-fg-muted uppercase tracking-wider">
              Sentry DSN (optional)
            </label>
            <Input
              value={form.sentry_dsn ?? app.sentry_dsn ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, sentry_dsn: v }))}
              disabled={!canEdit}
              placeholder="https://…@sentry.io/…"
              hint="Tester submissions will be tagged mushi_tester:true and routed to this Sentry project."
            />
          </div>
        </Card>
      </Section>

      {/* Card 2: Budget (cloud + cashout gate) */}
      {hasCashout && (
        <Section title="BUDGET">
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-fg mb-1">Monthly gift-card budget</div>
                <div className="text-2xs text-fg-muted mb-2">
                  Testers can redeem mushi-points for gift cards funded from this budget.
                  When exhausted, gift-card redemptions queue until next month.
                  Closed-loop Pro upgrades are always available regardless of this limit.
                </div>
                <Input
                  label="Budget ceiling (USD / month)"
                  value={String(stats?.monthly_budget_usd ?? 0)}
                  onChange={() => {
                    /* handled by separate API call */
                  }}
                  disabled={!canEdit}
                  type="number"
                  hint="0 = no gift-card cash-out for this project's testers"
                />
              </div>
              {stats && (
                <div>
                  <div className="text-xs font-medium text-fg mb-1">Usage this month</div>
                  <div className="flex items-end gap-1">
                    <span className="text-2xl font-semibold font-mono tabular-nums">
                      {stats.monthly_budget_used_pct}%
                    </span>
                    <span className="text-xs text-fg-muted pb-0.5">used</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div>
                      <div className="text-fg-faint">Submissions (30d)</div>
                      <div className="font-semibold">{stats.submissions_30d}</div>
                    </div>
                    <div>
                      <div className="text-fg-faint">Accepted</div>
                      <div className="font-semibold text-ok">{stats.accepted_30d}</div>
                    </div>
                    <div>
                      <div className="text-fg-faint">Active testers</div>
                      <div className="font-semibold">{stats.active_testers}</div>
                    </div>
                    <div>
                      <div className="text-fg-faint">Points spent (30d)</div>
                      <div className="font-semibold font-mono">{stats.points_spent_30d.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </Section>
      )}

      {/* Card 3: Bounties */}
      <Section title="BOUNTIES">
        <Card className="p-4">
          <p className="text-2xs text-fg-muted mb-3">
            Per-action point overrides for this app. Leave blank to inherit org-level rules.
            Changes take effect on the next submission.
          </p>
          {bounties && bounties.length > 0 ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg-faint border-b border-border text-left">
                  <th className="pb-1.5 font-medium">Action</th>
                  <th className="pb-1.5 font-medium text-right">Points</th>
                  <th className="pb-1.5 font-medium text-right">Daily cap</th>
                  <th className="pb-1.5 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {bounties.map((b) => (
                  <tr key={b.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 font-mono">{b.action}</td>
                    <td className="py-2 text-right font-semibold">{b.points_per_event}</td>
                    <td className="py-2 text-right text-fg-muted">{b.daily_cap ?? '–'}</td>
                    <td className="py-2 text-right">
                      <Badge className={b.enabled ? 'bg-ok-muted text-ok' : 'bg-surface-overlay text-fg-faint'}>
                        {b.enabled ? 'On' : 'Off'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-fg-muted">
              No bounty overrides — inheriting org-level reward rules. Add overrides via the API.
            </p>
          )}
        </Card>
      </Section>

      {/* Card 4: Targeting */}
      <Section title="TARGETING">
        <Card className="p-4 space-y-3">
          <p className="text-2xs text-fg-muted">
            Filters applied when a tester tries to join. Empty = unrestricted.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
            <div>
              <div className="text-fg-faint mb-1">Countries</div>
              <div className="font-mono">
                {targeting?.country_codes?.length
                  ? targeting.country_codes.join(', ')
                  : 'All countries'}
              </div>
            </div>
            <div>
              <div className="text-fg-faint mb-1">Languages</div>
              <div className="font-mono">
                {targeting?.languages?.length ? targeting.languages.join(', ') : 'All languages'}
              </div>
            </div>
            <div>
              <div className="text-fg-faint mb-1">Min reputation</div>
              <div className="font-semibold">{targeting?.reputation_min ?? 0}</div>
            </div>
          </div>
          <p className="text-2xs text-fg-faint">
            Advanced targeting (devices, expertise tags) is configurable via the published-apps API.
          </p>
        </Card>
      </Section>

      {/* Card 5: Visibility controls */}
      <Section title="VISIBILITY">
        <Card className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="text-xs font-medium text-fg mb-1">Current visibility</div>
              <VisibilityBadge visibility={app.visibility} />
              {live && (
                <p className="text-2xs text-fg-muted mt-1">
                  Your app is live. Pausing stops new submissions but keeps existing testers.
                </p>
              )}
              {app.visibility === 'draft' && (
                <p className="text-2xs text-fg-muted mt-1">
                  In draft. Only you can see it. Once published, anyone with the link can join.
                </p>
              )}
              {app.visibility === 'paused' && (
                <p className="text-2xs text-fg-muted mt-1">
                  Paused. Existing testers can still view, but new submissions are blocked.
                  Re-publish to re-open.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {!live && canEdit && (
                <>
                  {!confirmPublish ? (
                    <Btn
                      size="sm"
                      variant="primary"
                      onClick={() => setConfirmPublish(true)}
                    >
                      {app.visibility === 'paused' ? 'Re-publish' : 'Publish to Bounties'}
                    </Btn>
                  ) : (
                    <div className="border border-warn/30 rounded p-2 bg-warn/5 space-y-2 text-xs">
                      <p className="text-fg font-medium">Confirm publish?</p>
                      <p className="text-fg-muted">
                        Once live, testers can join and submit bugs. Pausing later stops new
                        submissions but keeps existing testers in your program.
                      </p>
                      <div className="flex gap-2">
                        <Btn size="xs" variant="primary" onClick={handlePublish} loading={publishing}>
                          Yes, publish
                        </Btn>
                        <Btn size="xs" variant="ghost" onClick={() => setConfirmPublish(false)}>
                          Cancel
                        </Btn>
                      </div>
                    </div>
                  )}
                </>
              )}
              {live && canEdit && (
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={handlePause}
                  loading={pausing}
                >
                  Pause
                </Btn>
              )}
            </div>
          </div>
        </Card>
      </Section>

      {/* Save bar */}
      {Object.keys(form).length > 0 && canEdit && (
        <div className="sticky bottom-4 flex justify-end">
          <div className="flex gap-2 bg-surface-raised border border-border rounded-lg shadow-md p-2">
            <Btn size="sm" variant="ghost" onClick={() => setForm({})}>
              Discard
            </Btn>
            <Btn size="sm" variant="primary" onClick={handleSave} loading={saving}>
              Save changes
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
