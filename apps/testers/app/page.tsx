/**
 * Marketplace landing page — SSR catalog of published apps.
 * Fetches from the public API, renders cards with SEO-friendly metadata.
 */
import type { Metadata } from 'next'
import { TestersPageShell } from './components/TestersPageShell'

export const metadata: Metadata = {
  title: 'Mushi Bounties — crowd-testing marketplace',
  description:
    'Get paid to find bugs — browse apps on the Mushi Bounties crowd-testing marketplace and earn mushi-points redeemable for Mushi Pro credit or gift cards.',
  alternates: { canonical: 'https://kensaur.us/mushi-mushi/testers/' },
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
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/admin'

  return (
    <TestersPageShell>
      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <p className="testers-kicker mb-3">Mushi Bounties</p>
        <h1 className="text-4xl font-bold leading-tight md:text-5xl mb-4">
          Find real bugs.<br />Earn real rewards.
        </h1>
        <p className="testers-muted mx-auto mb-8 max-w-2xl text-xl">
          Developers publish their apps. You find bugs. Every accepted report
          earns mushi-points redeemable for Mushi Pro credit or 100+ gift cards.
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <a href={`${adminUrl}/login?as=tester`} className="testers-cta px-8 py-3 text-base">
            Start testing →
          </a>
          <a href="/mushi-mushi/testers/apps/" className="testers-cta-secondary px-8 py-3 text-base">
            Browse apps
          </a>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {[
            { icon: '🐛', title: 'Find bugs', body: "Use apps as a real user — then report what's broken. We route your report directly to the dev's Sentry inbox." },
            { icon: '💰', title: 'Earn points', body: 'Every accepted bug earns mushi-points. The more critical, the more points. No spam, no filler.' },
            { icon: '🎁', title: 'Redeem rewards', body: "Spend points on Mushi Pro credit (30% bonus) or cash out via 100+ gift cards including Amazon, Starbucks, and App Store." },
          ].map(({ icon, title, body }) => (
            <div key={title} className="testers-panel p-5">
              <p className="mb-2 text-2xl">{icon}</p>
              <p className="mb-1 font-semibold">{title}</p>
              <p className="testers-muted text-sm">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="mb-6 text-2xl font-bold">
          Apps available to test
          {apps.length > 0 && (
            <span className="testers-muted ml-2 text-base font-normal">({apps.length})</span>
          )}
        </h2>

        {apps.length === 0 ? (
          <div className="testers-panel p-12 text-center">
            <p className="mb-3 text-3xl">📭</p>
            <p className="text-lg font-medium">No apps published yet</p>
            <p className="testers-muted mt-1 text-sm">
              Check back soon — the first bounty programs are onboarding now.
            </p>
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
                <div className="min-w-0">
                  <p className="font-semibold group-hover:text-[var(--mushi-vermillion)] motion-safe:transition-colors">
                    {app.name}
                  </p>
                  {app.tagline && (
                    <p className="testers-muted mt-0.5 line-clamp-1 text-sm">{app.tagline}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {app.platforms.map(p => (
                      <span key={p} className="testers-chip">{p}</span>
                    ))}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </TestersPageShell>
  )
}
