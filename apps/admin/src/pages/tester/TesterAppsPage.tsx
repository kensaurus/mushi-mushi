/**
 * TesterAppsPage — deep-enhanced tester-facing app catalog.
 * Each card surfaces: hero, platforms, bounty schedule (expandable), 30d
 * activity signals, tester-personal stats, targeting fit pill, and CTAs.
 * Filter rail: search + All / Joined / Eligible chips.
 */
import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { TESTER_API_OPTS } from '../../lib/tester-page-data'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn, Badge, SegmentedControl } from '../../components/ui'
import { TableSkeleton } from '../../components/skeletons/TableSkeleton'
import { TesterPageIntro } from '../../components/tester/tester-ui'

interface BountyTier {
  action: string
  points_per_event: number
  daily_cap: number | null
  lifetime_cap_per_tester: number | null
}

interface TesterApp {
  id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  heroUrl: string | null
  screenshotsUrls: string[]
  platforms: string[]
  webUrl: string | null
  appStoreUrl: string | null
  playStoreUrl: string | null
  publishedAt: string
  // bounty
  maxBountyPoints: number
  bountySchedule: BountyTier[]
  // targeting
  reputationMin: number
  targetCountries: string[] | null
  languages: string[]
  expertiseTags: string[]
  // subscription
  joined: boolean
  joinedAt: string | null
  // activity signals
  accepted30d: number
  submitted30d: number
  acceptRate30d: number | null
  lastAcceptedAt: string | null
  avgResponseHours: number | null
  // personal stats
  mySubmissions: number
  myAccepted: number
  myPointsEarned: number
  // fit
  meetsReputationGate: boolean
  myReputationScore: number
}

interface AppsResponse {
  ok: boolean
  data: TesterApp[]
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    bug_critical: 'Critical bug', bug_high: 'High bug',
    bug_medium: 'Medium bug', bug_low: 'Low bug', enhancement: 'Enhancement',
  }
  return map[action] ?? action.replace(/_/g, ' ')
}

const ACTION_COLOR: Record<string, string> = {
  bug_critical: 'text-danger bg-danger/10 border-danger/30',
  bug_high:     'text-warn bg-warn/10 border-warn/30',
  bug_medium:   'text-warn bg-warn-muted/20 border-warn/20',
  bug_low:      'text-fg-muted bg-surface-overlay/40 border-edge/30',
  enhancement:  'text-info bg-info/10 border-info/30',
}

function ActivityDot({ lastAcceptedAt }: { lastAcceptedAt: string | null }) {
  if (!lastAcceptedAt) return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-faint">
      <span className="h-1.5 w-1.5 rounded-full bg-surface-overlay inline-block" />
      No activity yet
    </span>
  )
  const days = (Date.now() - new Date(lastAcceptedAt).getTime()) / 86_400_000
  const [cls, text] = days < 7
    ? ['bg-ok', `Active — last accepted ${Math.floor(days * 24)}h ago`]
    : days < 30
    ? ['bg-warn', `Moderate — last accepted ${Math.floor(days)}d ago`]
    : ['bg-surface-overlay', `Last accepted ${Math.floor(days)}d ago`]
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
      <span className={`h-1.5 w-1.5 rounded-full inline-block ${cls}`} />
      {text}
    </span>
  )
}

function FitPill({ app }: { app: TesterApp }) {
  if (app.reputationMin === 0 && (!app.targetCountries || app.targetCountries.length === 0)) {
    return <Badge className="bg-ok/10 border-ok/30 text-ok text-2xs border">Open to all</Badge>
  }
  if (app.meetsReputationGate) {
    return <Badge className="bg-ok/10 border-ok/30 text-ok text-2xs border">✓ You qualify</Badge>
  }
  const needed = app.reputationMin - app.myReputationScore
  return (
    <Badge
      className="bg-warn/10 border-warn/30 text-warn text-2xs border"
      title={`You need ${app.reputationMin} rep; you have ${app.myReputationScore}. Earn ${needed} more by getting reports accepted.`}
    >
      🔒 Needs {app.reputationMin} rep (you: {app.myReputationScore})
    </Badge>
  )
}

function AppCard({ app, onJoin, onLeave, acting }: {
  app: TesterApp
  onJoin: (slug: string) => void
  onLeave: (slug: string) => void
  acting: string | null
}) {
  const [showBounties, setShowBounties] = useState(false)

  const median = app.bountySchedule.length > 0
    ? app.bountySchedule[Math.floor(app.bountySchedule.length / 2)]?.points_per_event
    : null

  return (
    <div className="rounded-xl border border-edge-subtle bg-surface-raised overflow-hidden hover:border-accent/30 transition-colors">
      {/* Header row */}
      <div className="flex items-start gap-4 p-4">
        <div className="h-14 w-14 shrink-0 rounded-xl bg-surface-root flex items-center justify-center text-2xl overflow-hidden">
          {app.heroUrl
            ? <img src={app.heroUrl} alt={app.name} className="h-full w-full object-cover" />
            : '📱'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{app.name}</p>
            {app.joined && (
              <Badge className="bg-accent/20 border-accent/30 text-accent text-2xs border">✓ Joined</Badge>
            )}
            <FitPill app={app} />
          </div>
          {app.tagline && <p className="text-sm text-fg-muted mt-0.5 line-clamp-1">{app.tagline}</p>}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {app.platforms.map(p => (
              <span key={p} className="rounded-full bg-surface-root px-2 py-0.5 text-xs text-fg-muted capitalize">{p}</span>
            ))}
          </div>
        </div>
        {/* CTA */}
        <div className="shrink-0 flex flex-col gap-2 items-end">
          {app.joined ? (
            <>
              <Link
                to={`/tester/submissions?appId=${encodeURIComponent(app.id)}&new=1`}
                className="inline-flex items-center justify-center rounded-sm border border-brand/40 bg-brand-subtle px-2.5 py-1 text-2xs font-semibold text-brand motion-safe:transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                Report bug
              </Link>
              <Btn variant="ghost" size="sm" loading={acting === app.slug} onClick={() => onLeave(app.slug)}>
                Leave
              </Btn>
            </>
          ) : (
            <Btn
              variant="primary" size="sm"
              loading={acting === app.slug}
              disabled={!app.meetsReputationGate}
              onClick={() => onJoin(app.slug)}
              title={!app.meetsReputationGate ? `Requires ${app.reputationMin} reputation` : undefined}
            >
              Join
            </Btn>
          )}
        </div>
      </div>

      {/* Description */}
      {app.description && (
        <div className="px-4 pb-3">
          <p className="text-xs text-fg-muted leading-relaxed line-clamp-2">{app.description}</p>
        </div>
      )}

      {/* Data strip */}
      <div className="border-t border-edge-subtle px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-y-2 gap-x-4 text-xs">
        <div>
          <p className="text-fg-faint mb-0.5">Bounty</p>
          <p className="text-fg font-medium">
            Up to {app.maxBountyPoints.toLocaleString()} pts
            {median && ` · median ~${median.toLocaleString()}`}
            {app.bountySchedule.length > 0 && ` · ${app.bountySchedule.length} tiers`}
          </p>
        </div>
        <div>
          <p className="text-fg-faint mb-0.5">Activity (30d)</p>
          <div className="flex flex-col gap-0.5">
            <ActivityDot lastAcceptedAt={app.lastAcceptedAt} />
            {app.submitted30d > 0 && (
              <span className="text-fg-muted">
                {app.accepted30d} accepted / {app.submitted30d} submitted
                {app.acceptRate30d !== null && ` (${app.acceptRate30d}%)`}
              </span>
            )}
            {app.avgResponseHours !== null && (
              <span className="text-fg-muted">~{app.avgResponseHours}h median review time</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-fg-faint mb-0.5">
            {app.joined ? 'My stats' : 'Targeting'}
          </p>
          {app.joined ? (
            <p className="text-fg-secondary">
              {app.mySubmissions} submitted · {app.myAccepted} accepted · {app.myPointsEarned.toLocaleString()} pts
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {app.targetCountries && app.targetCountries.length > 0 && (
                <span className="text-fg-muted">{app.targetCountries.slice(0, 4).join(' · ')}{app.targetCountries.length > 4 ? ' …' : ''}</span>
              )}
              {app.reputationMin > 0 && (
                <span className={app.meetsReputationGate ? 'text-ok' : 'text-warn'}>
                  {app.meetsReputationGate ? '✓' : '✗'} {app.reputationMin} rep required
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bounty schedule (expandable) */}
      {app.bountySchedule.length > 0 && (
        <div className="border-t border-edge-subtle">
          <button
            type="button"
            onClick={() => setShowBounties(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-fg-muted hover:text-fg hover:bg-surface-overlay transition-colors"
          >
            <span>Bounty schedule — {app.bountySchedule.length} active tiers</span>
            <span>{showBounties ? '▲' : '▼'}</span>
          </button>
          {showBounties && (
            <div className="px-4 pb-3 space-y-1.5">
              {app.bountySchedule.map((tier, i) => (
                <div key={tier.action + i} className="flex items-center justify-between">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ACTION_COLOR[tier.action] ?? 'text-fg-muted bg-surface-overlay/40 border-edge/30'}`}>
                    {actionLabel(tier.action)}
                  </span>
                  <div className="flex items-center gap-3 text-xs text-right">
                    <span className="font-semibold text-accent">{tier.points_per_event.toLocaleString()} pts</span>
                    {tier.daily_cap !== null && (
                      <span className="text-fg-faint">max {tier.daily_cap}/day</span>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-2xs text-fg-faint pt-1">
                Points awarded after developer review. 1,000 pts = $10 gift card or $13 Mushi Pro credit.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Footer links */}
      <div className="border-t border-edge-subtle px-4 py-2.5 flex flex-wrap gap-3">
        {app.webUrl && (
          <a href={app.webUrl} target="_blank" rel="noreferrer" className="text-xs text-fg-muted hover:text-fg transition-colors">
            Open web ↗
          </a>
        )}
        {app.appStoreUrl && (
          <a href={app.appStoreUrl} target="_blank" rel="noreferrer" className="text-xs text-fg-muted hover:text-fg transition-colors">
            App Store ↗
          </a>
        )}
        {app.playStoreUrl && (
          <a href={app.playStoreUrl} target="_blank" rel="noreferrer" className="text-xs text-fg-muted hover:text-fg transition-colors">
            Play Store ↗
          </a>
        )}
        <a
          href={`/mushi-mushi/testers/apps/${app.slug}/`}
          target="_blank" rel="noreferrer"
          className="text-xs text-brand hover:underline"
        >
          Public listing ↗
        </a>
      </div>
    </div>
  )
}

type FilterChip = 'all' | 'joined' | 'eligible'

export function TesterAppsPage() {
  const toast = useToast()
  const { data: raw, loading, error, reload } = usePageData<AppsResponse | TesterApp[]>('/v1/tester/apps', TESTER_API_OPTS)
  const [acting, setActing] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState<FilterChip>('all')

  // normalise nested .data wrapper from the API
  const allApps: TesterApp[] = useMemo(() => {
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    if ('data' in raw && Array.isArray((raw as AppsResponse).data)) return (raw as AppsResponse).data
    return []
  }, [raw])

  const filtered = useMemo(() => {
    let apps = allApps
    if (search.trim()) {
      const q = search.toLowerCase()
      apps = apps.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.tagline ?? '').toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      )
    }
    if (chip === 'joined')   apps = apps.filter(a => a.joined)
    if (chip === 'eligible') apps = apps.filter(a => a.meetsReputationGate && !a.joined)
    return apps
  }, [allApps, search, chip])

  async function handleJoin(slug: string) {
    setActing(slug)
    try {
      const res = await apiFetch(`/v1/tester/apps/${slug}/join`, { method: 'POST', scope: 'none' })
      if (res.ok) {
        toast.success('Joined! Start testing and report bugs to earn points.')
        reload()
      } else {
        toast.error((res as { error?: { message?: string } }).error?.message ?? 'Could not join.')
      }
    } finally {
      setActing(null)
    }
  }

  async function handleLeave(slug: string) {
    setActing(slug)
    try {
      const res = await apiFetch(`/v1/tester/apps/${slug}/leave`, { method: 'POST', scope: 'none' })
      if (res.ok) {
        toast.success('Left the test program.')
        reload()
      } else {
        toast.error((res as { error?: { message?: string } }).error?.message ?? 'Could not leave.')
      }
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-5">
        <TesterPageIntro
          title="Apps to test"
          description="Join a program, find real bugs, and earn mushi-points redeemable for Pro credit or gift cards."
        />

        {/* Filter rail */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative max-w-xs flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 select-none text-sm text-fg-faint" aria-hidden>🔍</span>
            <input
              type="search"
              placeholder="Search apps…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-md border border-edge-subtle bg-surface-raised py-2 pl-8 pr-3 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>
          <SegmentedControl
            value={chip}
            onChange={setChip}
            ariaLabel="Filter apps"
            size="sm"
            options={[
              { id: 'all', label: 'All', count: allApps.length },
              { id: 'joined', label: 'Joined', count: allApps.filter(a => a.joined).length },
              { id: 'eligible', label: 'Eligible', count: allApps.filter(a => a.meetsReputationGate && !a.joined).length },
            ]}
          />
        </div>

        {loading && <TableSkeleton rows={3} />}

        {error && (
          <p className="text-sm text-danger">
            {error.includes('not_a_tester')
              ? 'You need a tester account. Please sign in via the marketplace.'
              : `Error loading apps: ${error}`}
          </p>
        )}

        {!loading && filtered.length === 0 && !error && (
          <div className="rounded-xl border border-edge-subtle bg-surface-raised p-12 text-center">
            <p className="text-3xl mb-3">{search ? '🔍' : '📭'}</p>
            <p className="text-lg font-medium">{search ? 'No apps match your search' : chip === 'joined' ? 'No joined apps yet' : 'No apps yet'}</p>
            <p className="text-sm text-fg-muted mt-1">
              {search
                ? 'Try different keywords.'
                : chip === 'joined'
                ? 'Browse available apps and join one to start earning.'
                : 'Check back soon — developers are publishing their apps.'}
            </p>
            {chip !== 'all' && (
              <button
                type="button"
                onClick={() => { setChip('all'); setSearch('') }}
                className="mt-3 text-sm text-accent hover:underline"
              >
                Show all apps →
              </button>
            )}
            <div className="mt-4">
              <Link to="/tester/learn" className="text-xs text-fg-faint hover:text-fg-secondary motion-safe:transition-colors">
                New to Bounties? Read the guide →
              </Link>
            </div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map(app => (
              <AppCard
                key={app.id}
                app={app}
                onJoin={handleJoin}
                onLeave={handleLeave}
                acting={acting}
              />
            ))}
          </div>
        )}
    </div>
  )
}
