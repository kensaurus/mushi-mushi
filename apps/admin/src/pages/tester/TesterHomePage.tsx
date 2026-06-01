/**
 * TesterHomePage — landing dashboard for the tester portal.
 * Shows greeting, stat strip, next-milestone progress, recommended apps,
 * in-flight pipeline, and quick links to the Learn section.
 */
import { useTesterStatus, reputationTier, REP_TIERS } from '../../lib/useTesterStatus'
import { usePageData } from '../../lib/usePageData'
import { TesterLayout } from '../../components/tester/TesterLayout'

interface TesterApp {
  id: string
  slug: string
  name: string
  tagline: string | null
  heroUrl: string | null
  platforms: string[]
  maxBountyPoints: number
  joined: boolean
  meetsReputationGate: boolean
  accepted30d: number
  lastAcceptedAt: string | null
  mySubmissions: number
  myAccepted: number
  myPointsEarned: number
  bountySchedule: Array<{ action: string; points_per_event: number }>
  targetCountries: string[] | null
}

interface WalletData {
  balance: number
  totalEarned: number
  totalRedeemed: number
  ytdGiftCardUsd: number
  kycRequired: boolean
  kycCleared: boolean
  kycThresholdUsd: number
  kycCapUsd: number
  pendingRedemptions: Array<{ id: string; kind: string; pointsSpent: number; faceValueUsd: number | null; status: string; requestedAt: string }>
}

interface Submission {
  id: string
  appName: string
  title: string
  status: string
  submittedAt: string
  pointsAwarded: number | null
}

/** SVG-safe color values for each tier — Tailwind class names can't be used as SVG stroke values. */
const TIER_SVG_COLORS: Record<string, string> = {
  Platinum: '#67e8f9',
  Gold:     '#fde047',
  Silver:   '#cbd5e1',
  Bronze:   '#fbbf24',
}

function MilestoneRing({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min(1, value / max)
  const r = 28
  const circ = 2 * Math.PI * r
  const dash = circ * pct
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle
          cx="36" cy="36" r={r} fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <p className="text-xs text-fg-muted -mt-1 text-center leading-tight">{label}</p>
    </div>
  )
}

function ActivityDot({ lastAcceptedAt }: { lastAcceptedAt: string | null }) {
  if (!lastAcceptedAt) return <span className="inline-block h-2 w-2 rounded-full bg-surface-overlay" title="No activity yet" />
  const days = (Date.now() - new Date(lastAcceptedAt).getTime()) / 86_400_000
  const [cls, tip] = days < 7
    ? ['bg-ok', 'Active (last accepted < 7d ago)']
    : days < 30
    ? ['bg-warn', 'Moderate activity (7–30d)']
    : ['bg-surface-overlay', 'Low activity (>30d)']
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} title={tip} />
}

function RecommendedAppCard({ app }: { app: TesterApp }) {
  const maxPts = app.maxBountyPoints
  return (
    <a
      href="/tester/apps"
      className="block rounded-xl border border-white/10 bg-white/5 p-4 hover:border-accent/40 hover:bg-white/8 transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-lg bg-surface-root flex items-center justify-center text-xl">
          {app.heroUrl ? <img src={app.heroUrl} alt="" className="h-full w-full rounded-lg object-cover" /> : '📱'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold group-hover:text-accent transition-colors truncate">{app.name}</p>
            <ActivityDot lastAcceptedAt={app.lastAcceptedAt} />
          </div>
          {app.tagline && <p className="text-xs text-fg-muted mt-0.5 line-clamp-1">{app.tagline}</p>}
          <p className="text-xs text-accent mt-1 font-medium">
            Up to {maxPts.toLocaleString()} pts · {app.accepted30d} accepted last 30d
          </p>
        </div>
      </div>
    </a>
  )
}

function PipelineItem({ icon, label, sub, href, badge }: { icon: string; label: string; sub: string; href: string; badge?: string }) {
  return (
    <a href={href} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 hover:border-white/20 transition-colors">
      <span className="text-xl shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{label}</p>
        <p className="text-xs text-fg-faint truncate">{sub}</p>
      </div>
      {badge && <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-2xs font-medium text-accent">{badge}</span>}
    </a>
  )
}

function LearnTile({ icon, title, href, description }: { icon: string; title: string; href: string; description: string }) {
  return (
    <a
      href={href}
      className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/5 p-4 hover:border-accent/40 hover:bg-accent/5 transition-all"
    >
      <span className="text-2xl">{icon}</span>
      <p className="text-sm font-semibold leading-snug">{title}</p>
      <p className="text-xs text-fg-muted leading-relaxed">{description}</p>
    </a>
  )
}

export function TesterHomePage() {
  const { data: status, loading: statusLoading } = useTesterStatus()
  const { data: appsRaw } = usePageData<{ data?: TesterApp[] } | TesterApp[]>('/v1/tester/apps')
  const { data: walletRaw } = usePageData<{ data?: WalletData } | WalletData>('/v1/tester/wallet')
  const { data: subsRaw } = usePageData<{ data?: { items: Submission[] } } | { items: Submission[] }>('/v1/tester/submissions')

  // normalise nested .data wrappers
  const apps: TesterApp[] = Array.isArray(appsRaw)
    ? appsRaw
    : (appsRaw as { data?: TesterApp[] } | null)?.data ?? []
  const wallet: WalletData | null = walletRaw && 'data' in walletRaw && walletRaw.data
    ? (walletRaw as { data: WalletData }).data
    : walletRaw as unknown as WalletData | null
  const submissions: Submission[] = (subsRaw as { data?: { items: Submission[] } } | null)?.data?.items
    ?? (subsRaw as { items?: Submission[] } | null)?.items
    ?? []

  const handle = status?.handle ?? 'Tester'
  const reputation = status?.reputation ?? 0
  const tier = reputationTier(reputation)

  // Next reputation tier
  const currentTierIdx = REP_TIERS.findIndex(t => t.name === tier.name)
  const nextTier = currentTierIdx > 0 ? REP_TIERS[currentTierIdx - 1] : null
  // Recommended apps: not joined, meets gate, sort by maxBountyPoints
  const recommended = apps
    .filter(a => !a.joined && a.meetsReputationGate)
    .sort((a, b) => b.maxBountyPoints - a.maxBountyPoints)
    .slice(0, 3)

  // Pending submissions
  const pendingSubmissions = submissions.filter(s => s.status === 'pending').slice(0, 3)

  const ytd = wallet?.ytdGiftCardUsd ?? 0
  const kycThreshold = wallet?.kycThresholdUsd ?? 400
  const kycCleared = wallet?.kycCleared ?? false
  const pendingRedemptions = wallet?.pendingRedemptions ?? []

  if (statusLoading) {
    return (
      <TesterLayout title="Home">
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />
          ))}
        </div>
      </TesterLayout>
    )
  }

  return (
    <TesterLayout title="Home">
      <div className="space-y-8">

        {/* Greeting */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Welcome back, {handle}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tier.bg} ${tier.color}`}>
                {tier.name} tester
              </span>
              <span className="text-sm text-fg-faint">{reputation} reputation · {status?.acceptedSubmissions ?? 0} accepted reports</span>
            </div>
          </div>
          <a
            href="/tester/apps"
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-semibold hover:bg-accent-hover transition-colors"
          >
            Browse apps →
          </a>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Balance',       value: `${(status?.balance ?? 0).toLocaleString()} pts`, sub: 'redeemable now' },
            { label: 'Total earned',  value: `${(status?.totalEarned ?? 0).toLocaleString()} pts`, sub: 'all time' },
            { label: 'Apps joined',   value: String(status?.joinedApps ?? 0),      sub: 'active programs' },
            { label: 'Accepted',      value: String(status?.acceptedSubmissions ?? 0), sub: 'all-time reports' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-fg-faint uppercase tracking-wide mb-1">{label}</p>
              <p className="text-xl font-bold text-fg">{value}</p>
              <p className="text-xs text-fg-faint mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* Milestones row */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold mb-4">Milestones</h2>
          <div className="flex items-start gap-8 flex-wrap">
            {nextTier ? (
              <div className="flex items-center gap-4">
                <MilestoneRing
                  value={reputation - tier.min}
                  max={nextTier.min - tier.min}
                  label={`→ ${nextTier.name}`}
                  color={TIER_SVG_COLORS[nextTier.name] ?? '#7c3aed'}
                />
                <div>
                  <p className="text-sm font-medium">{nextTier.name} tier</p>
                  <p className="text-xs text-fg-muted mt-0.5">
                    {reputation} / {nextTier.min} rep
                    {' '}· {nextTier.min - reputation} more needed
                  </p>
                  <p className="text-xs text-fg-faint mt-1">
                    Earn rep by getting reports accepted.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <MilestoneRing value={1} max={1} label="Max tier" color="#67e8f9" />
                <div>
                  <p className="text-sm font-medium">Platinum — max tier reached</p>
                  <p className="text-xs text-fg-muted mt-0.5">{reputation} rep · keep it up!</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4">
              <div className="w-48">
                <p className="text-xs text-fg-muted mb-1.5">YTD gift cards</p>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden relative">
                  {/* KYC gate at $400 */}
                  <div
                    className={`h-full rounded-full transition-all ${
                      ytd >= kycThreshold && !kycCleared ? 'bg-warn' : 'bg-accent'
                    }`}
                    style={{ width: `${Math.min(100, (ytd / (wallet?.kycCapUsd ?? 599)) * 100)}%` }}
                  />
                  <div
                    className="absolute top-0 h-full w-px bg-warn/60"
                    style={{ left: `${(kycThreshold / (wallet?.kycCapUsd ?? 599)) * 100}%` }}
                    title="KYC required at this point"
                  />
                </div>
                <div className="flex justify-between text-2xs text-fg-faint mt-1">
                  <span>${ytd.toFixed(0)}</span>
                  <span>${kycThreshold} KYC</span>
                  <span>${wallet?.kycCapUsd ?? 599} cap</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium">Gift card cap</p>
                {ytd >= kycThreshold && !kycCleared ? (
                  <a href="/tester/settings#kyc" className="text-xs text-warn hover:underline mt-0.5 block">
                    Verify identity to continue →
                  </a>
                ) : (
                  <p className="text-xs text-fg-muted mt-0.5">${((wallet?.kycCapUsd ?? 599) - ytd).toFixed(0)} remaining</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Recommended apps */}
        {recommended.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Recommended for you</h2>
              <a href="/tester/apps" className="text-xs text-accent hover:underline">See all apps →</a>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {recommended.map(app => <RecommendedAppCard key={app.id} app={app} />)}
            </div>
          </div>
        )}

        {/* Pipeline strip: pending submissions + pending redemptions */}
        {(pendingSubmissions.length > 0 || pendingRedemptions.length > 0) && (
          <div>
            <h2 className="text-sm font-semibold mb-3">In progress</h2>
            <div className="space-y-2">
              {pendingSubmissions.map(s => (
                <PipelineItem
                  key={s.id}
                  icon="🐛"
                  label={s.title}
                  sub={`${s.appName} · submitted ${new Date(s.submittedAt).toLocaleDateString()}`}
                  href="/tester/apps"
                  badge="Pending review"
                />
              ))}
              {pendingRedemptions.map(r => (
                <PipelineItem
                  key={r.id}
                  icon={r.kind === 'mushi_pro_credit' ? '🚀' : '🎁'}
                  label={r.kind === 'mushi_pro_credit' ? 'Mushi Pro credit' : `Gift card — $${r.faceValueUsd?.toFixed(0) ?? '?'}`}
                  sub={`${r.pointsSpent.toLocaleString()} pts · ${new Date(r.requestedAt).toLocaleDateString()}`}
                  href="/tester/wallet"
                  badge={r.status === 'processing' ? 'Processing' : 'Pending'}
                />
              ))}
            </div>
          </div>
        )}

        {/* Learn corner */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Learn how Bounties works</h2>
            <a href="/tester/learn" className="text-xs text-accent hover:underline">Full guide →</a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <LearnTile
              icon="✅"
              title="What makes a good report"
              href="/tester/learn#good-report"
              description="Steps to reproduce, expected vs actual, screenshots. Reports that get accepted every time."
            />
            <LearnTile
              icon="💰"
              title="The bounty math"
              href="/tester/learn#bounty-math"
              description="1,000 pts = $10 gift card or $13 Mushi Pro credit. How point values are set and calculated."
            />
            <LearnTile
              icon="📋"
              title="KYC & gift card cap"
              href="/tester/learn#kyc"
              description="$400 threshold, W-9 / W-8BEN, what your TIN is used for, and how to clear verification."
            />
          </div>
        </div>

      </div>
    </TesterLayout>
  )
}
