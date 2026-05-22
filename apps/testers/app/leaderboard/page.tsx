/**
 * Public leaderboard — top testers over the past 30 days.
 * Revalidates every 15 minutes (aligned with the pg_cron MV refresh).
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Tester Leaderboard — Mushi Bounties',
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
    <div className="min-h-screen">
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-gray-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <a href="/mushi-mushi/testers/" className="text-lg font-bold">
            <span className="text-violet-400">mushi</span>mushi
            <span className="ml-2 text-sm font-normal text-gray-400">🪲 Bounties</span>
          </a>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-4 py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Tester Leaderboard</h1>
          <p className="text-gray-400 mt-1 text-sm">Top testers in the last 30 days. Updated every 15 minutes.</p>
        </div>

        {leaders.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center">
            <p className="text-3xl mb-3">🏆</p>
            <p className="font-medium">No testers yet — be the first!</p>
            <a
              href="/mushi-mushi/testers/"
              className="mt-4 inline-block text-sm text-violet-400 hover:underline"
            >
              Browse apps →
            </a>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-[2rem_1fr_auto_auto] gap-4 px-4 py-2 bg-white/5 text-xs text-gray-500 font-medium uppercase tracking-wide">
              <span>#</span>
              <span>Tester</span>
              <span className="text-right">Bugs</span>
              <span className="text-right">Points</span>
            </div>
            {leaders.map((e, i) => (
              <div
                key={e.handle + i}
                className="grid grid-cols-[2rem_1fr_auto_auto] gap-4 px-4 py-3 bg-white/5 border-t border-white/5 items-center"
              >
                <span className="text-sm font-mono text-center">
                  {MEDAL[i] ?? e.rank}
                </span>
                <span className="font-medium truncate">{e.handle}</span>
                <span className="text-sm text-gray-400 text-right">{e.acceptedCount}</span>
                <span className="text-sm font-semibold text-violet-400 text-right">
                  {e.totalPoints.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        <a href="/mushi-mushi/testers/" className="text-sm text-gray-500 hover:text-gray-300">
          ← Back to marketplace
        </a>
      </div>
    </div>
  )
}
