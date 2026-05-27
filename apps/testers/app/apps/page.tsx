'use client'
/**
 * /apps — full app catalog with client-side filter rail.
 * Uses useSearchParams() so the page is statically exportable
 * while still supporting filter-via-URL on the client.
 */
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback, Suspense } from 'react'

interface PublicApp {
  id: string
  slug: string
  name: string
  tagline: string | null
  heroUrl: string | null
  platforms: string[]
  minPoints: number
  maxBountyPoints: number
  publishedAt: string
}

async function fetchApps(params: {
  platform?: string
  minPoints?: string
}): Promise<PublicApp[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return []
  const qs = new URLSearchParams()
  if (params.platform) qs.set('platform', params.platform)
  if (params.minPoints) qs.set('min_points', params.minPoints)
  try {
    const res = await fetch(`${apiUrl}/v1/public/marketplace/apps?${qs.toString()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json() as Array<{
      id: string; slug: string; name: string; tagline: string | null;
      hero_url: string | null; platforms: string[];
      min_points?: number; max_bounty_points?: number; published_at: string
    }>
    return data.map(a => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      tagline: a.tagline,
      heroUrl: a.hero_url,
      platforms: a.platforms ?? [],
      minPoints: a.min_points ?? 0,
      maxBountyPoints: a.max_bounty_points ?? 0,
      publishedAt: a.published_at,
    }))
  } catch {
    return []
  }
}

const PLATFORMS = ['web', 'ios', 'android', 'desktop']

function AppsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const platform = searchParams.get('platform') ?? undefined
  const minPoints = searchParams.get('min_points') ?? undefined

  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/console'

  const [apps, setApps] = useState<PublicApp[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchApps({ platform, minPoints }).then(data => {
      setApps(data)
      setLoading(false)
    })
  }, [platform, minPoints])

  const setFilter = useCallback((key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    router.replace(`/apps/${next.toString() ? `?${next.toString()}` : ''}`)
  }, [searchParams, router])

  return (
    <div className="min-h-screen">
      {/* Nav */}
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

      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Browse apps</h1>
          <p className="text-gray-400">
            {loading
              ? 'Loading…'
              : apps.length > 0
              ? `${apps.length} app${apps.length === 1 ? '' : 's'} available to test`
              : 'Filter to find the right app for you.'}
          </p>
        </div>

        {/* Filter rail */}
        <div className="flex flex-wrap gap-3 mb-8">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Platform:</span>
            <button
              onClick={() => setFilter('platform', undefined)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors cursor-pointer ${
                !platform
                  ? 'border-violet-500 bg-violet-500/20 text-violet-300'
                  : 'border-white/10 text-gray-400 hover:border-white/30'
              }`}
            >
              All
            </button>
            {PLATFORMS.map(p => (
              <button
                key={p}
                onClick={() => setFilter('platform', p)}
                className={`rounded-full border px-3 py-1 text-sm capitalize transition-colors cursor-pointer ${
                  platform === p
                    ? 'border-violet-500 bg-violet-500/20 text-violet-300'
                    : 'border-white/10 text-gray-400 hover:border-white/30'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-4">
            <span className="text-sm text-gray-500">Min bounty:</span>
            {[
              { label: 'Any', value: undefined },
              { label: '100 pts', value: '100' },
              { label: '500 pts', value: '500' },
              { label: '1000 pts', value: '1000' },
            ].map(({ label, value }) => (
              <button
                key={label}
                onClick={() => setFilter('min_points', value)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors cursor-pointer ${
                  minPoints === value
                    ? 'border-violet-500 bg-violet-500/20 text-violet-300'
                    : 'border-white/10 text-gray-400 hover:border-white/30'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* App grid */}
        {loading ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center text-gray-500">
            Loading apps…
          </div>
        ) : apps.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center">
            <p className="text-3xl mb-3">📭</p>
            <p className="text-lg font-medium">
              {platform || minPoints ? 'No apps match these filters' : 'No apps yet'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {platform || minPoints
                ? 'Try removing a filter.'
                : 'The first apps are coming soon. Check back shortly.'}
            </p>
            {(platform || minPoints) && (
              <button
                onClick={() => router.replace('/apps/')}
                className="mt-4 inline-block text-sm text-violet-400 hover:underline cursor-pointer"
              >
                Clear filters →
              </button>
            )}
            <p className="text-sm text-gray-400 mt-3">
              Are you a developer?{' '}
              <a href={adminUrl} className="text-violet-400 hover:underline">
                Publish your app →
              </a>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {apps.map(app => (
              <a
                key={app.id}
                href={`/mushi-mushi/testers/apps/${app.slug}/`}
                className="flex gap-4 rounded-xl border border-white/10 bg-white/5 p-5 hover:border-violet-500/50 hover:bg-white/10 transition-all group"
              >
                <div className="h-14 w-14 shrink-0 rounded-xl bg-gray-800 flex items-center justify-center text-2xl">
                  📱
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold group-hover:text-violet-300 transition-colors">
                    {app.name}
                  </p>
                  {app.tagline && (
                    <p className="text-sm text-gray-400 mt-0.5 line-clamp-1">{app.tagline}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {app.platforms.map(p => (
                      <span key={p} className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                        {p}
                      </span>
                    ))}
                    {app.maxBountyPoints > 0 && (
                      <span className="rounded-full bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 text-xs text-violet-300">
                        up to {app.maxBountyPoints.toLocaleString()} pts
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-sm text-gray-500">
        <p>
          <span className="text-violet-400">mushi</span>mushi Bounties ·{' '}
          <a href="/mushi-mushi/testers/" className="hover:text-gray-300">Home</a> ·{' '}
          <a href="/mushi-mushi/testers/how-it-works/" className="hover:text-gray-300">How it works</a> ·{' '}
          <a href="/mushi-mushi/testers/leaderboard/" className="hover:text-gray-300">Leaderboard</a>
        </p>
      </footer>
    </div>
  )
}

export default function AppsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">Loading…</div>}>
      <AppsPageInner />
    </Suspense>
  )
}
