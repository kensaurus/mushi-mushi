/**
 * Marketplace landing page — SSR catalog of published apps.
 * Fetches from the public API, renders cards with SEO-friendly metadata.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mushi Bounties — crowd-testing marketplace',
  description:
    'Browse apps published to the Mushi Bounties marketplace. Find a bug, earn mushi-points.',
}

interface PublicApp {
  id: string
  slug: string
  name: string
  tagline: string | null
  heroUrl: string | null
  platforms: string[]
  publishedAt: string
}

async function getApps(): Promise<PublicApp[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return []
  try {
    const res = await fetch(`${apiUrl}/v1/public/marketplace/apps`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const data = await res.json() as Array<{
      id: string; slug: string; name: string; tagline: string | null;
      hero_url: string | null; platforms: string[]; published_at: string
    }>
    return data.map(a => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      tagline: a.tagline,
      heroUrl: a.hero_url,
      platforms: a.platforms ?? [],
      publishedAt: a.published_at,
    }))
  } catch {
    return []
  }
}

export default async function MarketplacePage() {
  const apps = await getApps()
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/console'

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-gray-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <a href="/mushi-mushi/" className="text-lg font-bold">
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

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <p className="text-violet-400 text-sm font-medium tracking-wide uppercase mb-3">
          Mushi Bounties
        </p>
        <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-4">
          Find real bugs.<br />Earn real rewards.
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
          Developers publish their apps. You find bugs. Every accepted report
          earns mushi-points redeemable for Mushi Pro credit or 100+ gift cards.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href={`${adminUrl}/login?as=tester`}
            className="rounded-xl bg-violet-600 px-8 py-3 text-base font-semibold hover:bg-violet-500 transition-colors"
          >
            Start testing →
          </a>
          <a
            href="/mushi-mushi/testers/apps/"
            className="rounded-xl border border-white/20 px-8 py-3 text-base font-semibold hover:border-white/40 transition-colors"
          >
            Browse apps
          </a>
        </div>

        {/* Value props */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16 text-left">
          {[
            { icon: '🐛', title: 'Find bugs', body: "Use apps as a real user — then report what's broken. We route your report directly to the dev's Sentry inbox." },
            { icon: '💰', title: 'Earn points', body: 'Every accepted bug earns mushi-points. The more critical, the more points. No spam, no filler.' },
            { icon: '🎁', title: 'Redeem rewards', body: "Spend points on Mushi Pro credit (30% bonus) or cash out via 100+ gift cards including Amazon, Starbucks, and App Store." },
          ].map(({ icon, title, body }) => (
            <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-5">
              <p className="text-2xl mb-2">{icon}</p>
              <p className="font-semibold mb-1">{title}</p>
              <p className="text-sm text-gray-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* App catalog */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="text-2xl font-bold mb-6">
          Apps available to test
          {apps.length > 0 && (
            <span className="ml-2 text-base font-normal text-gray-400">({apps.length})</span>
          )}
        </h2>

        {apps.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center">
            <p className="text-3xl mb-3">📭</p>
            <p className="text-lg font-medium">No apps yet</p>
            <p className="text-sm text-gray-400 mt-1">
              The first apps are coming soon. Check back shortly.
            </p>
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
                href={`${adminUrl}/login?as=tester&next=/tester/apps`}
                className="flex gap-4 rounded-xl border border-white/10 bg-white/5 p-5 hover:border-violet-500/50 hover:bg-white/8 transition-all group"
              >
                <div className="h-14 w-14 shrink-0 rounded-xl bg-gray-800 flex items-center justify-center text-2xl">
                  📱
                </div>
                <div className="min-w-0">
                  <p className="font-semibold group-hover:text-violet-300 transition-colors">
                    {app.name}
                  </p>
                  {app.tagline && (
                    <p className="text-sm text-gray-400 mt-0.5 line-clamp-1">{app.tagline}</p>
                  )}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {app.platforms.map(p => (
                      <span key={p} className="rounded-full bg-gray-800 px-2 py-0.5 text-2xs text-gray-400">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-sm text-gray-500">
        <p>
          <span className="text-violet-400">mushi</span>mushi Bounties ·{' '}
          <a href="/mushi-mushi/testers/apps/" className="hover:text-gray-300">Browse apps</a> ·{' '}
          <a href="/mushi-mushi/testers/how-it-works/" className="hover:text-gray-300">How it works</a> ·{' '}
          <a href="/mushi-mushi/testers/leaderboard/" className="hover:text-gray-300">Leaderboard</a> ·{' '}
          Gift cards powered by Tremendous · $599/yr cap before KYC
        </p>
      </footer>
    </div>
  )
}
