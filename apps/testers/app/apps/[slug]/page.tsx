/**
 * App detail page — shows a specific published app's details, bounty table,
 * and a CTA to join + test. SSR with ISR every 5 minutes.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

interface AppDetail {
  id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  heroUrl: string | null
  platforms: string[]
  publishedAt: string
  bounties: Array<{
    action: string
    pointsPerEvent: number
    enabled: boolean
  }>
  targeting: {
    reputationMin: number
    maxTesters: number | null
    targetCountries: string[] | null
  } | null
}

async function getApp(slug: string): Promise<AppDetail | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return null
  try {
    const res = await fetch(`${apiUrl}/v1/public/marketplace/apps/${slug}`, {
      next: { revalidate: 300 },
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    const d = await res.json() as {
      id: string; slug: string; name: string; tagline: string | null;
      description: string | null; hero_url: string | null;
      platforms: string[]; published_at: string;
      published_app_bounties?: Array<{ action: string; points_per_event: number; enabled: boolean }>
      published_app_targeting?: { reputation_min: number; max_testers: number | null; target_countries: string[] | null }
    }
    return {
      id: d.id,
      slug: d.slug,
      name: d.name,
      tagline: d.tagline,
      description: d.description,
      heroUrl: d.hero_url,
      platforms: d.platforms ?? [],
      publishedAt: d.published_at,
      bounties: (d.published_app_bounties ?? []).map(b => ({
        action: b.action,
        pointsPerEvent: b.points_per_event,
        enabled: b.enabled,
      })),
      targeting: d.published_app_targeting
        ? { reputationMin: d.published_app_targeting.reputation_min, maxTesters: d.published_app_targeting.max_testers, targetCountries: d.published_app_targeting.target_countries }
        : null,
    }
  } catch {
    return null
  }
}

// Static export requires this; returns [] so no slugs are pre-rendered at build
// time — the hosting layer handles unknown paths (404 or SPA fallback).
export async function generateStaticParams() {
  return []
}

export const dynamicParams = false

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const app = await getApp(slug)
  if (!app) return { title: 'App not found' }
  return {
    title: `Test ${app.name} — Mushi Bounties`,
    description: app.tagline ?? `Find bugs in ${app.name} and earn mushi-points on Mushi Bounties.`,
    openGraph: {
      title: `Test ${app.name}`,
      description: app.tagline ?? `Find bugs in ${app.name} and earn mushi-points.`,
      images: app.heroUrl ? [app.heroUrl] : [],
    },
  }
}

const ACTION_LABELS: Record<string, string> = {
  bug_accept: 'Accepted bug report',
  accessibility_issue: 'Accessibility issue',
  feature_request: 'Feature request',
  content_fix: 'Content fix',
  localization_issue: 'Localization issue',
  critical_bug: 'Critical bug report',
}

export default async function AppDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const app = await getApp(slug)
  if (!app) notFound()

  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL ?? '/mushi-mushi/console'

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-gray-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <a href="/mushi-mushi/testers/" className="text-lg font-bold">
            <span className="text-violet-400">mushi</span>mushi
            <span className="ml-2 text-sm font-normal text-gray-400">🪲 Bounties</span>
          </a>
          <a
            href={`${adminUrl}/login?as=tester&next=/tester/apps`}
            className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium hover:bg-violet-500 transition-colors"
          >
            Join to test
          </a>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-4 py-12 space-y-8">
        {/* App header */}
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 shrink-0 rounded-2xl bg-gray-800 flex items-center justify-center text-3xl">
            📱
          </div>
          <div>
            <h1 className="text-2xl font-bold">{app.name}</h1>
            {app.tagline && <p className="text-gray-400 mt-1">{app.tagline}</p>}
            <div className="flex gap-2 mt-2 flex-wrap">
              {app.platforms.map(p => (
                <span key={p} className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-400">
                  {p}
                </span>
              ))}
              {app.targeting?.targetCountries && app.targeting.targetCountries.length > 0 && (
                <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-400">
                  🌍 {app.targeting.targetCountries.join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {app.description && (
          <p className="text-gray-300 leading-relaxed">{app.description}</p>
        )}

        {/* CTA */}
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-6">
          <p className="font-semibold text-lg mb-2">Ready to test?</p>
          <p className="text-sm text-gray-400 mb-4">
            Sign up as a tester with just your email. We'll send you a magic link — no password needed.
            {app.targeting?.reputationMin && app.targeting.reputationMin > 0 && (
              <> You'll need a reputation score of {app.targeting.reputationMin}+ to join.</>
            )}
          </p>
          <a
            href={`${adminUrl}/login?as=tester&next=/tester/apps`}
            className="inline-block rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold hover:bg-violet-500 transition-colors"
          >
            Join to test →
          </a>
        </div>

        {/* Bounty table */}
        {app.bounties.filter(b => b.enabled).length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Bounty schedule</h2>
            <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden">
              {app.bounties.filter(b => b.enabled).map(b => (
                <div key={b.action} className="flex items-center justify-between px-4 py-3 bg-white/5">
                  <span className="text-sm">{ACTION_LABELS[b.action] ?? b.action}</span>
                  <span className="text-sm font-medium text-violet-400">
                    {b.pointsPerEvent.toLocaleString()} pts
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Points credited within minutes of your report being accepted.
              1,000 pts = $13 Mushi Pro credit or $10 gift card.
            </p>
          </div>
        )}

        {/* Back link */}
        <a href="/mushi-mushi/testers/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
          ← Browse all apps
        </a>
      </div>
    </div>
  )
}
