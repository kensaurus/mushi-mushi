/**
 * TesterHomePage — landing page for the Mushi Bounties tester portal.
 * Shows the tester's balance, recent activity, and quick links.
 */
import { TesterLayout } from '../../components/tester/TesterLayout'
import { usePageData } from '../../lib/usePageData'
import { useAuth } from '../../lib/auth'
import { Link } from 'react-router-dom'

interface TesterStatus {
  isTester: boolean
  handle: string | null
  reputation: number
  balance: number
  totalEarned: number
  totalRedeemed: number
  acceptedSubmissions: number
  joinedApps: number
}

export function TesterHomePage() {
  const { user } = useAuth()
  const { data: status, loading } = usePageData<TesterStatus>('/v1/me/tester-status')

  return (
    <TesterLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-lg font-bold">Welcome back 🪲</h1>
          <p className="text-sm text-fg-muted mt-0.5">{user?.email}</p>
        </div>

        {loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-surface animate-pulse" />
            ))}
          </div>
        )}

        {!loading && status && (
          <>
            {!status.isTester && (
              <div className="rounded-lg border border-brand/30 bg-brand/5 p-4 text-sm text-fg-secondary">
                Your tester profile is being set up. Check back in a moment.
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Balance" value={`${status.balance.toLocaleString()} pts`} sub="mushi-points" />
              <StatCard label="Reputation" value={status.reputation.toString()} sub="score" />
              <StatCard label="Accepted" value={status.acceptedSubmissions.toString()} sub="bug reports" />
              <StatCard label="Apps joined" value={status.joinedApps.toString()} sub="active" />
            </div>

            {status.balance > 0 && (
              <div className="rounded-lg border border-ok/30 bg-ok/5 p-4">
                <p className="text-sm font-medium text-fg">
                  You have <span className="text-ok">{status.balance.toLocaleString()} mushi-points</span> ready to redeem.
                </p>
                <Link
                  to="/tester/wallet"
                  className="mt-2 inline-block text-2xs text-brand hover:text-brand-hover motion-safe:transition-colors"
                >
                  Redeem in wallet →
                </Link>
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QuickLink
            to="/tester/apps"
            icon="📱"
            title="Browse apps"
            description="Find apps to test and earn mushi-points."
          />
          <QuickLink
            to="/tester/submissions"
            icon="🐛"
            title="My submissions"
            description="Track your bug reports and their status."
          />
          <QuickLink
            to="/tester/wallet"
            icon="💰"
            title="Wallet & rewards"
            description="Redeem your points for Mushi Pro or gift cards."
          />
          <QuickLink
            to="/tester/settings"
            icon="⚙️"
            title="Profile settings"
            description="Update your handle, expertise tags, and privacy."
          />
        </div>
      </div>
    </TesterLayout>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-3 space-y-0.5">
      <p className="text-2xs text-fg-muted">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-2xs text-fg-faint">{sub}</p>
    </div>
  )
}

function QuickLink({ to, icon, title, description }: {
  to: string
  icon: string
  title: string
  description: string
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-lg border border-edge bg-surface p-4 hover:border-brand/40 hover:bg-brand/5 motion-safe:transition-all group"
    >
      <span className="text-xl">{icon}</span>
      <div>
        <p className="text-sm font-medium group-hover:text-brand motion-safe:transition-colors">{title}</p>
        <p className="text-2xs text-fg-muted mt-0.5">{description}</p>
      </div>
    </Link>
  )
}
