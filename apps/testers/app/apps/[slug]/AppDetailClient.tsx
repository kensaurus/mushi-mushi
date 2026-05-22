'use client'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

interface BountyTier {
  action: string
  points_per_event: number
  enabled: boolean
}

interface AppDetail {
  id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  heroUrl: string | null
  platforms: string[]
  bounties: BountyTier[]
  publishedAt: string
  ownerHandle: string | null
}

async function fetchApp(slug: string): Promise<AppDetail | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return null
  try {
    const res = await fetch(`${apiUrl}/v1/public/marketplace/apps/${slug}`, { cache: 'no-store' })
    if (!res.ok) return null
    const d = await res.json() as {
      id: string; slug: string; name: string; tagline: string | null;
      description: string | null; hero_url: string | null;
      platforms: string[]; published_at: string; owner_handle: string | null;
      published_app_bounties?: Array<{ action: string; points_per_event: number; enabled: boolean }>
      bounties?: Array<{ action: string; points_per_event: number; enabled: boolean }>
    }
    return {
      id: d.id,
      slug: d.slug,
      name: d.name,
      tagline: d.tagline,
      description: d.description,
      heroUrl: d.hero_url,
      platforms: d.platforms ?? [],
      bounties: (d.published_app_bounties ?? d.bounties ?? []) as BountyTier[],
      publishedAt: d.published_at,
      ownerHandle: d.owner_handle,
    }
  } catch {
    return null
  }
}

const ACTION_COLORS: Record<string, string> = {
  bug_critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  bug_high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  bug_medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  bug_low: 'text-gray-400 bg-gray-500/10 border-gray-500/30',
  enhancement: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    bug_critical: 'Critical bug',
    bug_high: 'High severity bug',
    bug_medium: 'Medium severity bug',
    bug_low: 'Low severity bug',
    enhancement: 'Enhancement',
  }
  return labels[action] ?? action.replace(/_/g, ' ')
}

export default function AppDetailClient() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/console'
  const joinUrl = `/mushi-mushi/testers/join/?app=${slug}`

  const [app, setApp] = useState<AppDetail | null | 'loading'>('loading')

  useEffect(() => {
    if (!slug) return
    fetchApp(slug).then(setApp)
  }, [slug])

  if (app === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    )
  }

  if (!app) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
        <p className="text-4xl mb-4">🔍</p>
        <h1 className="text-2xl font-bold mb-2">App not found</h1>
        <p className="text-gray-400 mb-6">This app may have been removed from the marketplace.</p>
        <a href="/mushi-mushi/testers/apps/" className="text-violet-400 hover:underline">
          ← Browse all apps
        </a>
      </div>
    )
  }

  const maxPoints = app.bounties.reduce((m, b) => Math.max(m, b.points_per_event), 0)
  const activeBounties = app.bounties.filter(b => b.enabled)

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-gray-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <a href="/mushi-mushi/testers/" className="text-lg font-bold">
            <span className="text-violet-400">mushi</span>mushi
            <span className="ml-2 rounded-sm bg-violet-500/20 px-1.5 py-0.5 text-xs font-medium text-violet-400">
              🪲 Bounties
            </span>
          </a>
          <a
            href={`${adminUrl}/login?as=tester`}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium hover:bg-violet-500 transition-colors"
          >
            Sign in as tester
          </a>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
        <a href="/mushi-mushi/testers/apps/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
          ← All apps
        </a>

        <div className="flex gap-5 items-start">
          <div className="h-16 w-16 shrink-0 rounded-2xl bg-gray-800 flex items-center justify-center text-3xl">
            📱
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{app.name}</h1>
            {app.tagline && <p className="text-gray-400 mt-1">{app.tagline}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {app.platforms.map(p => (
                <span key={p} className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-400 capitalize">
                  {p}
                </span>
              ))}
              {maxPoints > 0 && (
                <span className="rounded-full bg-violet-500/10 border border-violet-500/30 px-2.5 py-0.5 text-xs text-violet-300">
                  up to {maxPoints.toLocaleString()} pts
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Ready to test {app.name}?</p>
            <p className="text-sm text-gray-400 mt-0.5">Sign up free — find bugs, earn points, redeem rewards.</p>
          </div>
          <a href={joinUrl} className="shrink-0 rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold hover:bg-violet-500 transition-colors">
            Join to test →
          </a>
        </div>

        {app.description && (
          <div>
            <h2 className="text-lg font-semibold mb-3">About this app</h2>
            <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{app.description}</p>
          </div>
        )}

        {activeBounties.length > 0 ? (
          <div>
            <h2 className="text-lg font-semibold mb-3">Bounty schedule</h2>
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <div className="grid grid-cols-[1fr_auto] gap-4 px-4 py-2 bg-white/5 text-xs text-gray-500 font-medium uppercase tracking-wide">
                <span>Action</span>
                <span className="text-right">Points</span>
              </div>
              {activeBounties.map((b, i) => (
                <div key={b.action + i} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 border-t border-white/5 items-center">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ACTION_COLORS[b.action] ?? 'text-gray-400 bg-gray-500/10 border-gray-500/30'}`}>
                    {actionLabel(b.action)}
                  </span>
                  <span className="text-sm font-semibold text-violet-400 text-right">
                    {b.points_per_event.toLocaleString()} pts
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Points are awarded by the developer after reviewing your submission.
              1,000 pts = $10 gift card or $13 Mushi Pro credit (1.3× premium).
            </p>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold mb-3">Bounty schedule</h2>
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-sm text-gray-400">This developer awards points at their discretion for each accepted report.</p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-3">
          <h2 className="font-semibold">How to submit a report</h2>
          <ol className="space-y-2 text-sm text-gray-300 list-decimal list-inside">
            <li>Sign up or sign in as a tester.</li>
            <li>Join this app from your tester dashboard.</li>
            <li>Use the app as a real user and reproduce the bug.</li>
            <li>Submit a report with steps to reproduce, expected vs actual behavior, and screenshots.</li>
            <li>The developer reviews and awards points if the report is accepted.</li>
          </ol>
          <a href="/mushi-mushi/testers/how-it-works/" className="inline-block text-sm text-violet-400 hover:underline mt-2">
            Full guide: How Mushi Bounties works →
          </a>
        </div>

        <div className="pt-4">
          <a href={joinUrl} className="w-full block text-center rounded-xl bg-violet-600 px-8 py-3 text-base font-semibold hover:bg-violet-500 transition-colors">
            Start testing {app.name} →
          </a>
        </div>
      </div>

      <footer className="border-t border-white/10 py-8 text-center text-sm text-gray-500">
        <p>
          <span className="text-violet-400">mushi</span>mushi Bounties ·{' '}
          <a href="/mushi-mushi/testers/apps/" className="hover:text-gray-300">Browse apps</a> ·{' '}
          <a href="/mushi-mushi/testers/how-it-works/" className="hover:text-gray-300">How it works</a> ·{' '}
          Gift cards powered by Tremendous · $599/yr cap before KYC
        </p>
      </footer>
    </div>
  )
}
