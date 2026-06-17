/**
 * Public leaderboard — top testers over the past 30 days.
 * Revalidates every 15 minutes (aligned with the pg_cron MV refresh).
 */
import type { Metadata } from 'next'
import { TestersPageShell } from '../components/TestersPageShell'

export const metadata: Metadata = {
  title: 'Tester Leaderboard',
  description: 'Top Mushi Bounties testers in the last 30 days.',
}

interface LeaderEntry {
  rank: number
  handle: string
  acceptedCount: number
  totalPoints: number
  impactPct: number
}

async function getLeaderboard(): Promise<LeaderEntry[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return []
  try {
    const res = await fetch(`${apiUrl}/v1/public/marketplace/leaderboard`, {
      next: { revalidate: 900 },
    })
    if (!res.ok) return []
    const data = await res.json() as Array<{
      rank?: number; public_handle?: string; accepted_count?: number;
      total_points?: number; impact_pct?: number
    }>
    return data.map((e, i) => ({
      rank: e.rank ?? i + 1,
      handle: e.public_handle ?? 'anonymous',
      acceptedCount: e.accepted_count ?? 0,
      totalPoints: e.total_points ?? 0,
      impactPct: e.impact_pct ?? 0,
    }))
  } catch {
    return []
  }
}

const MEDAL = ['🥇', '🥈', '🥉']

export default async function LeaderboardPage() {
  const leaders = await getLeaderboard()

  return (
    <TestersPageShell>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-12">
        <div>
          <h1 className="text-2xl font-bold">Tester Leaderboard</h1>
          <p className="testers-muted mt-1 text-sm">Top testers in the last 30 days. Updated every 15 minutes.</p>
        </div>

        {leaders.length === 0 ? (
          <div className="testers-panel p-12 text-center">
            <p className="mb-3 text-3xl">🏆</p>
            <p className="font-medium">No testers yet — be the first!</p>
            <a
              href="/mushi-mushi/testers/apps/"
              className="testers-brand-mark mt-4 inline-block text-sm underline underline-offset-2 hover:opacity-90"
            >
              Browse apps →
            </a>
          </div>
        ) : (
          <div className="testers-panel overflow-hidden">
            <div className="grid grid-cols-[2rem_1fr_auto_auto] gap-4 bg-[var(--mushi-paper-wash)] px-4 py-2 text-xs font-medium uppercase tracking-wide testers-faint">
              <span>#</span>
              <span>Tester</span>
              <span className="text-right">Bugs</span>
              <span className="text-right">Points</span>
            </div>
            {leaders.map((e, i) => (
              <div
                key={e.handle + i}
                className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-4 border-t border-[var(--mushi-rule)] px-4 py-3"
              >
                <span className="text-center font-mono text-sm">
                  {MEDAL[i] ?? e.rank}
                </span>
                <span className="truncate font-medium">{e.handle}</span>
                <span className="testers-muted text-right text-sm">{e.acceptedCount}</span>
                <span className="testers-brand-mark text-right text-sm font-semibold">
                  {e.totalPoints.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <a href="/mushi-mushi/testers/" className="testers-faint text-sm hover:text-[var(--mushi-ink-muted)]">
          ← Back to marketplace
        </a>
      </div>
    </TestersPageShell>
  )
}
