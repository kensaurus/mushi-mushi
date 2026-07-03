'use client'
/**
 * /apps — full app catalog with client-side filter rail.
 * Uses useSearchParams() so the page is statically exportable
 * while still supporting filter-via-URL on the client.
 */
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { TestersPageShell } from '../components/TestersPageShell'

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

function filterChipClass(active: boolean): string {
  return active
    ? 'rounded-full border border-[color-mix(in_oklch,var(--mushi-vermillion)_45%,var(--mushi-rule))] bg-[var(--mushi-vermillion-wash)] px-3 py-1 text-sm text-[var(--mushi-vermillion)] motion-safe:transition-colors cursor-pointer'
    : 'rounded-full border border-[var(--mushi-rule)] px-3 py-1 text-sm testers-muted hover:border-[color-mix(in_oklch,var(--mushi-ink)_35%,var(--mushi-rule))] motion-safe:transition-colors cursor-pointer'
}

function AppsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const platform = searchParams.get('platform') ?? undefined
  const minPoints = searchParams.get('min_points') ?? undefined

  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/admin'

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
    <TestersPageShell>
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Browse apps</h1>
          <p className="testers-muted">
            {loading
              ? 'Loading…'
              : apps.length > 0
              ? `${apps.length} app${apps.length === 1 ? '' : 's'} available to test`
              : 'Filter to find the right app for you.'}
          </p>
        </div>

        <div className="mb-8 flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="testers-faint text-sm">Platform:</span>
            <button
              onClick={() => setFilter('platform', undefined)}
              className={filterChipClass(!platform)}
            >
              All
            </button>
            {PLATFORMS.map(p => (
              <button
                key={p}
                onClick={() => setFilter('platform', p)}
                className={`${filterChipClass(platform === p)} capitalize`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="ml-4 flex items-center gap-2">
            <span className="testers-faint text-sm">Min bounty:</span>
            {[
              { label: 'Any', value: undefined },
              { label: '100 pts', value: '100' },
              { label: '500 pts', value: '500' },
              { label: '1000 pts', value: '1000' },
            ].map(({ label, value }) => (
              <button
                key={label}
                onClick={() => setFilter('min_points', value)}
                className={filterChipClass(minPoints === value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="testers-skeleton h-24 border border-[var(--mushi-rule)]" />
            ))}
          </div>
        ) : apps.length === 0 ? (
          <div className="testers-panel p-12 text-center">
            <p className="mb-3 text-3xl">📭</p>
            <p className="text-lg font-medium">
              {platform || minPoints ? 'No apps match these filters' : 'No apps yet'}
            </p>
            <p className="testers-muted mt-1 text-sm">
              {platform || minPoints
                ? 'Try removing a filter.'
                : 'The first apps are coming soon. Check back shortly.'}
            </p>
            {(platform || minPoints) && (
              <button
                onClick={() => router.replace('/apps/')}
                className="testers-brand-mark mt-4 inline-block cursor-pointer text-sm underline underline-offset-2 hover:opacity-90"
              >
                Clear filters →
              </button>
            )}
            <p className="testers-muted mt-3 text-sm">
              Are you a developer?{' '}
              <a href={adminUrl} className="testers-brand-mark underline underline-offset-2 hover:opacity-90">
                Publish your app →
              </a>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {apps.map(app => (
              <a
                key={app.id}
                href={`/mushi-mushi/testers/apps/${app.slug}/`}
                className="testers-panel testers-panel-hover group flex gap-4 p-5"
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--mushi-paper-wash)] text-2xl">
                  📱
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold group-hover:text-[var(--mushi-vermillion)] motion-safe:transition-colors">
                    {app.name}
                  </p>
                  {app.tagline && (
                    <p className="testers-muted mt-0.5 line-clamp-1 text-sm">{app.tagline}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {app.platforms.map(p => (
                      <span key={p} className="testers-chip">{p}</span>
                    ))}
                    {app.maxBountyPoints > 0 && (
                      <span className="testers-badge">
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
    </TestersPageShell>
  )
}

export default function AppsPage() {
  return (
    <Suspense
      fallback={
        <div className="testers-shell flex min-h-screen items-center justify-center">
          <p className="testers-muted">Loading…</p>
        </div>
      }
    >
      <AppsPageInner />
    </Suspense>
  )
}
