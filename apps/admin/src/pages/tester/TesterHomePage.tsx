/**
 * TesterHomePage — landing dashboard for the tester portal.
 * Shows greeting, stat strip, next-milestone progress, recommended apps,
 * in-flight pipeline, and quick links to the Learn section.
 */
import { Link } from 'react-router-dom'
import { useTesterStatus, reputationTier, REP_TIERS } from '../../lib/useTesterStatus'
import { usePageData } from '../../lib/usePageData'
import { TESTER_API_OPTS, normalizeListItems } from '../../lib/tester-page-data'
import {
  TesterLearnTile,
  TesterLinkCard,
  TesterLoadingSkeleton,
  TesterMilestoneRing,
  TesterPageIntro,
  TesterPanel,
  TesterPipelineRow,
  TesterPrimaryCta,
  TesterProgressTrack,
  TesterSection,
  TesterStatGrid,
  TesterTierBadge,
} from '../../components/tester/tester-ui'
import { Badge, Btn } from '../../components/ui'

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

const TIER_RING_COLORS: Record<string, string> = {
  Platinum: 'var(--color-info)',
  Gold: 'var(--color-warn)',
  Silver: 'var(--color-fg-secondary)',
  Bronze: 'var(--color-brand)',
}

function ActivityDot({ lastAcceptedAt }: { lastAcceptedAt: string | null }) {
  if (!lastAcceptedAt) {
    return <span className="inline-block h-2 w-2 rounded-full bg-surface-overlay" title="No activity yet" />
  }
  const days = (Date.now() - new Date(lastAcceptedAt).getTime()) / 86_400_000
  const [cls, tip] = days < 7
    ? ['bg-ok', 'Active (last accepted < 7d ago)']
    : days < 30
      ? ['bg-warn', 'Moderate activity (7–30d)']
      : ['bg-surface-overlay', 'Low activity (>30d)']
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} title={tip} />
}

function RecommendedAppCard({ app }: { app: TesterApp }) {
  return (
    <TesterLinkCard to={`/tester/apps?highlight=${encodeURIComponent(app.slug)}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-overlay text-xl">
          {app.heroUrl ? (
            <img src={app.heroUrl} alt="" className="h-full w-full rounded-md object-cover" />
          ) : (
            '📱'
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-fg">{app.name}</p>
            <ActivityDot lastAcceptedAt={app.lastAcceptedAt} />
          </div>
          {app.tagline && (
            <p className="mt-0.5 line-clamp-1 text-xs text-fg-muted">{app.tagline}</p>
          )}
          <p className="mt-1 text-xs font-medium text-brand">
            Up to {app.maxBountyPoints.toLocaleString()} pts · {app.accepted30d} accepted last 30d
          </p>
        </div>
      </div>
    </TesterLinkCard>
  )
}

export function TesterHomePage() {
  const { data: status, loading: statusLoading, error: statusError } = useTesterStatus()
  const { data: appsRaw, error: appsError, reload: reloadApps } = usePageData<{ data?: TesterApp[] } | TesterApp[]>('/v1/tester/apps', TESTER_API_OPTS)
  const { data: walletRaw, error: walletError, reload: reloadWallet } = usePageData<{ data?: WalletData } | WalletData>('/v1/tester/wallet', TESTER_API_OPTS)
  const { data: subsRaw, error: subsError, reload: reloadSubs } = usePageData<{ items: Submission[]; total: number }>('/v1/tester/submissions', TESTER_API_OPTS)

  const apps: TesterApp[] = Array.isArray(appsRaw)
    ? appsRaw
    : (appsRaw as { data?: TesterApp[] } | null)?.data ?? []
  const wallet: WalletData | null = walletRaw && 'data' in walletRaw && walletRaw.data
    ? (walletRaw as { data: WalletData }).data
    : walletRaw as unknown as WalletData | null
  const submissions: Submission[] = normalizeListItems<Submission>(subsRaw)

  const handle = status?.handle ?? 'Tester'
  const reputation = status?.reputation ?? 0
  const tier = reputationTier(reputation)

  const currentTierIdx = REP_TIERS.findIndex((t) => t.name === tier.name)
  const nextTier = currentTierIdx > 0 ? REP_TIERS[currentTierIdx - 1] : null

  const recommended = apps
    .filter((a) => !a.joined && a.meetsReputationGate)
    .sort((a, b) => b.maxBountyPoints - a.maxBountyPoints)
    .slice(0, 3)

  const pendingSubmissions = submissions.filter((s) => s.status === 'pending').slice(0, 3)

  const ytd = wallet?.ytdGiftCardUsd ?? 0
  const kycThreshold = wallet?.kycThresholdUsd ?? 400
  const kycCleared = wallet?.kycCleared ?? false
  const kycCap = wallet?.kycCapUsd ?? 599
  const pendingRedemptions = wallet?.pendingRedemptions ?? []

  const loadError = statusError ?? appsError ?? walletError ?? subsError

  if (statusLoading) {
    return <TesterLoadingSkeleton rows={3} />
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <TesterPageIntro
          title="Could not load dashboard"
          description={loadError}
        />
        <Btn
          variant="primary"
          onClick={() => {
            void reloadApps()
            void reloadWallet()
            void reloadSubs()
          }}
        >
          Retry
        </Btn>
      </div>
    )
  }

  return (
    <div className="space-y-6">
        <TesterPageIntro
          title={`Welcome back, ${handle}`}
          description="Track your balance, reputation, and in-flight reports — then browse apps to earn mushi-points."
          meta={
            <>
              <TesterTierBadge tier={tier} />
              <span className="text-sm text-fg-muted">
                {reputation} reputation · {status?.acceptedSubmissions ?? 0} accepted reports
              </span>
            </>
          }
          actions={<TesterPrimaryCta to="/tester/apps">Browse apps →</TesterPrimaryCta>}
        />

        <TesterStatGrid
          items={[
            {
              label: 'Balance',
              value: `${(status?.balance ?? 0).toLocaleString()} pts`,
              hint: 'redeemable now',
              accent: 'text-brand',
              to: '/tester/wallet',
            },
            {
              label: 'Total earned',
              value: `${(status?.totalEarned ?? 0).toLocaleString()} pts`,
              hint: 'all time',
              to: '/tester/wallet',
            },
            {
              label: 'Apps joined',
              value: String(status?.joinedApps ?? 0),
              hint: 'active programs',
              to: '/tester/apps',
            },
            {
              label: 'Accepted',
              value: String(status?.acceptedSubmissions ?? 0),
              hint: 'all-time reports',
            },
          ]}
        />

        <TesterSection title="Milestones">
          <div className="flex flex-wrap items-start gap-6 lg:gap-10">
            {nextTier ? (
              <div className="flex items-center gap-4">
                <TesterMilestoneRing
                  value={reputation - tier.min}
                  max={nextTier.min - tier.min}
                  label={`→ ${nextTier.name}`}
                  color={TIER_RING_COLORS[nextTier.name] ?? 'var(--color-brand)'}
                />
                <div>
                  <p className="text-sm font-medium text-fg">{nextTier.name} tier</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {reputation} / {nextTier.min} rep · {nextTier.min - reputation} more needed
                  </p>
                  <p className="mt-1 text-xs text-fg-faint">Earn rep when developers accept your reports.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <TesterMilestoneRing value={1} max={1} label="Max tier" color={TIER_RING_COLORS.Platinum} />
                <div>
                  <p className="text-sm font-medium text-fg">Platinum — max tier reached</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{reputation} rep · keep it up!</p>
                </div>
              </div>
            )}

            <div className="min-w-[12rem] flex-1 space-y-2">
              <p className="text-xs font-medium text-fg-muted">YTD gift cards</p>
              <TesterProgressTrack
                value={ytd}
                max={kycCap}
                markerPct={(kycThreshold / kycCap) * 100}
                markerLabel={`KYC required at $${kycThreshold}`}
                barClassName={ytd >= kycThreshold && !kycCleared ? 'bg-warn' : 'bg-brand'}
              />
              <div className="flex justify-between text-2xs text-fg-faint">
                <span>${ytd.toFixed(0)}</span>
                <span>${kycThreshold} KYC</span>
                <span>${kycCap} cap</span>
              </div>
              <div className="pt-1">
                <p className="text-xs font-medium text-fg">Gift card cap</p>
                {ytd >= kycThreshold && !kycCleared ? (
                  <Link to="/tester/settings#kyc" className="mt-0.5 block text-xs text-warn hover:underline">
                    Verify identity to continue →
                  </Link>
                ) : (
                  <p className="mt-0.5 text-xs text-fg-muted">${(kycCap - ytd).toFixed(0)} remaining</p>
                )}
              </div>
            </div>
          </div>
        </TesterSection>

        {recommended.length > 0 && (
          <TesterSection
            title="Recommended for you"
            action={
              <Link to="/tester/apps" className="text-xs font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
                See all apps →
              </Link>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {recommended.map((app) => (
                <RecommendedAppCard key={app.id} app={app} />
              ))}
            </div>
          </TesterSection>
        )}

        {(pendingSubmissions.length > 0 || pendingRedemptions.length > 0) && (
          <TesterSection title="In progress">
            <div className="space-y-2">
              {pendingSubmissions.map((s) => (
                <TesterPipelineRow
                  key={s.id}
                  to="/tester/submissions"
                  icon="🐛"
                  label={s.title}
                  sub={`${s.appName} · submitted ${new Date(s.submittedAt).toLocaleDateString()}`}
                  badge="Pending review"
                  badgeTone="warn"
                />
              ))}
              {pendingRedemptions.map((r) => (
                <TesterPipelineRow
                  key={r.id}
                  to="/tester/wallet"
                  icon={r.kind === 'mushi_pro_credit' ? '🚀' : '🎁'}
                  label={r.kind === 'mushi_pro_credit' ? 'Mushi Pro credit' : `Gift card — $${r.faceValueUsd?.toFixed(0) ?? '?'}`}
                  sub={`${r.pointsSpent.toLocaleString()} pts · ${new Date(r.requestedAt).toLocaleDateString()}`}
                  badge={r.status === 'processing' ? 'Processing' : 'Pending'}
                />
              ))}
            </div>
          </TesterSection>
        )}

        <TesterSection
          title="Learn how Bounties works"
          action={
            <Link to="/tester/learn" className="text-xs font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
              Full guide →
            </Link>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TesterLearnTile
              to="/tester/learn#good-report"
              icon="✅"
              title="What makes a good report"
              description="Steps to reproduce, expected vs actual, screenshots. Reports that get accepted every time."
            />
            <TesterLearnTile
              to="/tester/learn#bounty-math"
              icon="💰"
              title="The bounty math"
              description="1,000 pts = $10 gift card or $13 Mushi Pro credit. How point values are set and calculated."
            />
            <TesterLearnTile
              to="/tester/learn#kyc"
              icon="📋"
              title="KYC & gift card cap"
              description="$400 threshold, W-9 / W-8BEN, what your TIN is used for, and how to clear verification."
            />
          </div>
        </TesterSection>

        <TesterPanel className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge className="border border-edge bg-surface-overlay text-fg-muted">Beta program</Badge>
          <span>Questions or payout issues? Use Settings → Send feedback.</span>
        </TesterPanel>
    </div>
  )
}
