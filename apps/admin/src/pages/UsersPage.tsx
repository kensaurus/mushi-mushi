/**
 * FILE: apps/admin/src/pages/UsersPage.tsx
 * PURPOSE: Operator-only signup directory.
 *
 *          Lists every signup with email, signup date, current plan,
 *          project count, and last-30d report activity. Sourced from
 *          GET /v1/super-admin/users which is gated by
 *          requireSuperAdmin in the gateway. The `useEntitlements()`
 *          hook (`isSuperAdmin`) decides whether to render this page;
 *          a non-super-admin who deep-links here sees the same opaque
 *          404 the gateway returns.
 *
 *          Layout intentionally minimal — this is an operator tool,
 *          not a customer-facing surface. Editorial typography lives
 *          in apps/cloud; the admin console stays in its existing
 *          dense Mushi-Admin language so it visually clusters with
 *          the rest of the operator surfaces (BillingPage, AuditPage).
 */

import { useEffect, useMemo, useState } from 'react'
import { useEntitlements } from '../lib/useEntitlements'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import {
  PageHeader,
  Section,
  Card,
  Badge,
  Btn,
  Input,
  SelectField,
  ErrorAlert,
  EmptyState,
  Loading,
  StatCard,
  RelativeTime,
  IdField,
} from '../components/ui'
import { EditorialErrorState } from '../components/EditorialErrorState'

interface SuperAdminUser {
  user_id: string
  email: string | null
  signed_up_at: string
  last_sign_in_at: string | null
  signup_plan: string | null
  role: string | null
  project_count: number | null
  current_plan: string | null
  reports_last_30d: number | null
  last_report_at: string | null
}

interface UserListResponse {
  users: SuperAdminUser[]
  next_cursor: string | null
  limit: number
}

interface SuperAdminMetrics {
  total_users: number
  paid_users: number
  mrr_usd: number
  signups_last_7d: number
  signups_last_30d: number
  churn_last_30d: number
}

interface UserDetail {
  user: SuperAdminUser
  projects: Array<{
    id: string
    name: string
    slug: string
    created_at: string
    plan_tier: string | null
    data_region: string | null
  }>
  subscriptions: Array<{
    id: string
    project_id: string
    plan_id: string
    status: string
    current_period_end: string
    cancel_at_period_end: boolean
    created_at: string
  }>
  recent_reports: Array<{
    id: string
    project_id: string
    category: string
    severity: string | null
    status: string
    created_at: string
  }>
}

const PLAN_FILTER_OPTIONS = [
  { value: '', label: 'All plans' },
  { value: 'paid', label: 'Paid (Starter+)' },
  { value: 'hobby', label: 'Hobby (no sub)' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
]

function planBadgeTone(plan: string | null): {
  bg: string
  fg: string
  label: string
} {
  if (!plan || plan === 'hobby') return { bg: 'bg-surface-raised', fg: 'text-fg-muted', label: 'Hobby' }
  if (plan === 'starter') return { bg: 'bg-info-muted', fg: 'text-info', label: 'Starter' }
  if (plan === 'pro') return { bg: 'bg-brand/15', fg: 'text-brand', label: 'Pro' }
  if (plan === 'enterprise') return { bg: 'bg-violet-500/15', fg: 'text-violet-400', label: 'Enterprise' }
  return { bg: 'bg-surface-raised', fg: 'text-fg-muted', label: plan }
}

export function UsersPage() {
  const { isSuperAdmin, loading: entitlementsLoading } = useEntitlements()

  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  // Debounce the search box → query string. 250ms feels responsive but
  // keeps per-keystroke server hits down on a wide directory.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' })
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (planFilter) params.set('plan', planFilter)
    return params.toString()
  }, [debouncedSearch, planFilter])

  const usersPath = isSuperAdmin
    ? `/v1/super-admin/users?${queryString}`
    : null
  const { data: usersData, loading: usersLoading, error: usersError, reload: reloadUsers } =
    usePageData<UserListResponse>(usersPath, { deps: [queryString] })

  const metricsPath = isSuperAdmin ? '/v1/super-admin/metrics' : null
  const { data: metrics } = usePageData<SuperAdminMetrics>(metricsPath)

  if (entitlementsLoading) {
    return <Loading text="Checking access…" />
  }
  if (!isSuperAdmin) {
    // Deliberate 404 obfuscation — see the file docstring. We don't want
    // to advertise that a privileged surface exists here, so the copy
    // matches what an unknown route would render. Visual treatment uses
    // the same EditorialErrorState as App.tsx's NotFoundPage so the two
    // surfaces are indistinguishable to a probing visitor.
    return (
      <EditorialErrorState
        eyebrow="404 · users"
        headline={
          <>
            We can't find <em>that page</em>.
          </>
        }
        lead="The route you typed doesn't match any page in the console. It may have moved, been renamed, or never existed — head back to the dashboard or check the docs for the canonical name."
        primary={{ href: '/dashboard', label: 'Back to dashboard' }}
        secondary={{
          href: 'https://kensaur.us/mushi-mushi/docs/',
          label: 'Open docs',
          external: true,
        }}
      />
    )
  }

  const users = usersData?.users ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Operator-only — every signup, current plan, and recent activity. Service-role view, never reachable by non-operators."
      />

      {/* Top metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total signups" value={metrics?.total_users ?? '—'} />
        <StatCard label="Paid users" value={metrics?.paid_users ?? '—'} accent="text-brand" />
        <StatCard label="MRR (USD)" value={metrics ? `$${metrics.mrr_usd.toLocaleString()}` : '—'} accent="text-brand" />
        <StatCard label="Signups · 7d" value={metrics?.signups_last_7d ?? '—'} />
        <StatCard label="Signups · 30d" value={metrics?.signups_last_30d ?? '—'} />
        <StatCard label="Churn · 30d" value={metrics?.churn_last_30d ?? '—'} accent={metrics && metrics.churn_last_30d > 0 ? 'text-warn' : undefined} />
      </div>

      <Section
        title="Directory"
        action={
          <Btn variant="ghost" size="sm" onClick={reloadUsers}>
            Refresh
          </Btn>
        }
      >
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <Input
            label="Search by email"
            placeholder="alice@…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="md:flex-1"
          />
          <SelectField
            label="Plan"
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="md:w-56"
          >
            {PLAN_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </div>

        {usersError ? (
          <ErrorAlert message={usersError} onRetry={reloadUsers} />
        ) : usersLoading && users.length === 0 ? (
          <Loading text="Loading directory…" />
        ) : users.length === 0 ? (
          <EmptyState
            title="No matching users"
            description="Try clearing the search or switching the plan filter."
          />
        ) : (
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase text-fg-muted text-left">
                <tr className="border-b border-edge/60">
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Signed up</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium text-right">Projects</th>
                  <th className="px-3 py-2 font-medium text-right">Reports · 30d</th>
                  <th className="px-3 py-2 font-medium">Last report</th>
                  <th className="px-3 py-2 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const tone = planBadgeTone(u.current_plan)
                  return (
                    <tr
                      key={u.user_id}
                      className="border-b border-edge/40 hover:bg-surface-raised/40 cursor-pointer"
                      onClick={() => setSelectedUserId(u.user_id)}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-fg">{u.email ?? <em className="text-fg-faint">no email</em>}</span>
                          {u.role === 'super_admin' && (
                            <Badge className="bg-brand/15 text-brand text-2xs">operator</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        <RelativeTime value={u.signed_up_at} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge className={`${tone.bg} ${tone.fg}`}>{tone.label}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{u.project_count ?? 0}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{u.reports_last_30d ?? 0}</td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {u.last_report_at ? <RelativeTime value={u.last_report_at} /> : <span className="text-fg-faint">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {u.last_sign_in_at ? <RelativeTime value={u.last_sign_in_at} /> : <span className="text-fg-faint">never</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {selectedUserId && (
        <UserDetailDrawer
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  )
}

function UserDetailDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch<UserDetail>(`/v1/super-admin/users/${userId}`).then((res) => {
      if (cancelled) return
      if (!res.ok || !res.data) {
        setError(res.error?.message ?? 'Failed to load user detail')
      } else {
        setDetail(res.data)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-overlay backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative w-full max-w-xl h-full bg-surface-root border-l border-edge/60 shadow-raised overflow-y-auto">
        <div className="sticky top-0 z-10 bg-surface-root border-b border-edge/60 px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">User detail</h2>
          <Btn variant="ghost" size="sm" onClick={onClose}>
            Close
          </Btn>
        </div>
        <div className="p-5 space-y-5">
          {loading ? (
            <Loading text="Loading user…" />
          ) : error ? (
            <ErrorAlert message={error} />
          ) : detail ? (
            <>
              <Card className="space-y-3">
                <div>
                  <div className="text-2xs text-fg-muted uppercase tracking-wide">Email</div>
                  <div className="text-base text-fg">{detail.user.email ?? '—'}</div>
                </div>
                <IdField label="User ID" value={detail.user.user_id} full tone="id" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-2xs text-fg-muted uppercase tracking-wide">Signed up</div>
                    <div className="text-sm text-fg"><RelativeTime value={detail.user.signed_up_at} /></div>
                  </div>
                  <div>
                    <div className="text-2xs text-fg-muted uppercase tracking-wide">Last sign-in</div>
                    <div className="text-sm text-fg">
                      {detail.user.last_sign_in_at ? <RelativeTime value={detail.user.last_sign_in_at} /> : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-2xs text-fg-muted uppercase tracking-wide">Current plan</div>
                    <div className="text-sm text-fg">{planBadgeTone(detail.user.current_plan).label}</div>
                  </div>
                  <div>
                    <div className="text-2xs text-fg-muted uppercase tracking-wide">Signup plan</div>
                    <div className="text-sm text-fg">{detail.user.signup_plan ?? '—'}</div>
                  </div>
                </div>
              </Card>

              <Section title={`Projects (${detail.projects.length})`}>
                {detail.projects.length === 0 ? (
                  <p className="text-sm text-fg-muted">No projects yet.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.projects.map((p) => (
                      <Card key={p.id} className="text-sm">
                        <div className="flex justify-between gap-3">
                          <div>
                            <div className="font-medium text-fg">{p.name}</div>
                            <div className="text-2xs text-fg-muted font-mono">{p.slug}</div>
                          </div>
                          <div className="text-right">
                            <Badge className="bg-surface-raised text-fg-muted">{p.plan_tier ?? 'free'}</Badge>
                            <div className="text-2xs text-fg-muted mt-1">
                              <RelativeTime value={p.created_at} />
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </Section>

              <Section title={`Subscriptions (${detail.subscriptions.length})`}>
                {detail.subscriptions.length === 0 ? (
                  <p className="text-sm text-fg-muted">No paid subscriptions.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.subscriptions.map((s) => (
                      <Card key={s.id} className="text-sm flex justify-between">
                        <div>
                          <Badge className={`${planBadgeTone(s.plan_id).bg} ${planBadgeTone(s.plan_id).fg}`}>
                            {planBadgeTone(s.plan_id).label}
                          </Badge>
                          <span className="ml-2 text-fg-muted text-2xs">{s.status}</span>
                        </div>
                        <div className="text-2xs text-fg-muted text-right">
                          renews <RelativeTime value={s.current_period_end} />
                          {s.cancel_at_period_end && <div className="text-warn">cancel scheduled</div>}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </Section>

              <Section title={`Recent reports (${detail.recent_reports.length})`}>
                {detail.recent_reports.length === 0 ? (
                  <p className="text-sm text-fg-muted">No reports filed yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.recent_reports.map((r) => (
                      <li key={r.id} className="text-2xs flex justify-between border-b border-edge/30 pb-1.5">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-surface-raised text-fg-muted">{r.category}</Badge>
                          {r.severity && <Badge className="bg-warn-muted text-warn">{r.severity}</Badge>}
                          <span className="text-fg-muted">{r.status}</span>
                        </div>
                        <RelativeTime value={r.created_at} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
