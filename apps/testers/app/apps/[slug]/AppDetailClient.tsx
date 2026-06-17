'use client'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { TestersPageShell } from '../../components/TestersPageShell'

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
  bug_critical: 'text-[var(--mushi-vermillion)] bg-[var(--mushi-vermillion-wash)] border-[color-mix(in_oklch,var(--mushi-vermillion)_35%,var(--mushi-rule))]',
  bug_high: 'text-[var(--mushi-vermillion-ink)] bg-[var(--mushi-vermillion-wash)] border-[var(--mushi-rule)]',
  bug_medium: 'text-[var(--mushi-ink)] bg-[var(--mushi-paper-wash)] border-[var(--mushi-rule)]',
  bug_low: 'text-[var(--mushi-ink-muted)] bg-[var(--mushi-paper-wash)] border-[var(--mushi-rule)]',
  enhancement: 'text-[var(--mushi-jade)] bg-[var(--mushi-jade-wash)] border-[color-mix(in_oklch,var(--mushi-jade)_35%,var(--mushi-rule))]',
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

  const joinUrl = `/mushi-mushi/testers/join/?app=${slug}`

  const [app, setApp] = useState<AppDetail | null | 'loading'>('loading')

  useEffect(() => {
    if (!slug) return
    fetchApp(slug).then(setApp)
  }, [slug])

  if (app === 'loading') {
    return (
      <TestersPageShell>
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
          <div className="testers-skeleton h-4 w-24" />
          <div className="testers-skeleton h-32 border border-[var(--mushi-rule)]" />
          <div className="testers-skeleton h-48 border border-[var(--mushi-rule)]" />
        </div>
      </TestersPageShell>
    )
  }

  if (!app) {
    return (
      <TestersPageShell>
        <div className="flex min-h-[calc(100vh-10rem)] flex-col items-center justify-center px-4 text-center">
          <p className="mb-4 text-4xl">🔍</p>
          <h1 className="mb-2 text-2xl font-bold">App not found</h1>
          <p className="testers-muted mb-6">This app may have been removed from the marketplace.</p>
          <a href="/mushi-mushi/testers/apps/" className="testers-brand-mark underline underline-offset-2 hover:opacity-90">
            ← Browse all apps
          </a>
        </div>
      </TestersPageShell>
    )
  }

  const maxPoints = app.bounties.reduce((m, b) => Math.max(m, b.points_per_event), 0)
  const activeBounties = app.bounties.filter(b => b.enabled)

  return (
    <TestersPageShell>
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        <a href="/mushi-mushi/testers/apps/" className="testers-faint text-sm hover:text-[var(--mushi-ink-muted)] motion-safe:transition-colors">
          ← All apps
        </a>

        <div className="flex items-start gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--mushi-paper-wash)] text-3xl">
            📱
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{app.name}</h1>
            {app.tagline && <p className="testers-muted mt-1">{app.tagline}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {app.platforms.map(p => (
                <span key={p} className="testers-chip capitalize">{p}</span>
              ))}
              {maxPoints > 0 && (
                <span className="testers-badge">
                  up to {maxPoints.toLocaleString()} pts
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="testers-panel flex flex-col items-start justify-between gap-4 border-[color-mix(in_oklch,var(--mushi-vermillion)_30%,var(--mushi-rule))] p-6 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold">Ready to test {app.name}?</p>
            <p className="testers-muted mt-0.5 text-sm">Sign up free — find bugs, earn points, redeem rewards.</p>
          </div>
          <a href={joinUrl} className="testers-cta shrink-0 px-6 py-2.5 text-sm">
            Join to test →
          </a>
        </div>

        {app.description && (
          <div>
            <h2 className="mb-3 text-lg font-semibold">About this app</h2>
            <p className="whitespace-pre-wrap leading-relaxed text-[var(--mushi-ink)]">{app.description}</p>
          </div>
        )}

        {activeBounties.length > 0 ? (
          <div>
            <h2 className="mb-3 text-lg font-semibold">Bounty schedule</h2>
            <div className="testers-panel overflow-hidden">
              <div className="grid grid-cols-[1fr_auto] gap-4 bg-[var(--mushi-paper-wash)] px-4 py-2 text-xs font-medium uppercase tracking-wide testers-faint">
                <span>Action</span>
                <span className="text-right">Points</span>
              </div>
              {activeBounties.map((b, i) => (
                <div key={b.action + i} className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-[var(--mushi-rule)] px-4 py-3">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ACTION_COLORS[b.action] ?? 'border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] text-[var(--mushi-ink-muted)]'}`}>
                    {actionLabel(b.action)}
                  </span>
                  <span className="testers-brand-mark text-right text-sm font-semibold">
                    {b.points_per_event.toLocaleString()} pts
                  </span>
                </div>
              ))}
            </div>
            <p className="testers-faint mt-2 text-xs">
              Points are awarded by the developer after reviewing your submission.
              1,000 pts = $10 gift card or $13 Mushi Pro credit (1.3× premium).
            </p>
          </div>
        ) : (
          <div>
            <h2 className="mb-3 text-lg font-semibold">Bounty schedule</h2>
            <div className="testers-panel p-6 text-center">
              <p className="testers-muted text-sm">This developer awards points at their discretion for each accepted report.</p>
            </div>
          </div>
        )}

        <div className="testers-panel space-y-3 p-6">
          <h2 className="font-semibold">How to submit a report</h2>
          <ol className="list-inside list-decimal space-y-2 text-sm text-[var(--mushi-ink)]">
            <li>Sign up or sign in as a tester.</li>
            <li>Join this app from your tester dashboard.</li>
            <li>Use the app as a real user and reproduce the bug.</li>
            <li>Submit a report with steps to reproduce, expected vs actual behavior, and screenshots.</li>
            <li>The developer reviews and awards points if the report is accepted.</li>
          </ol>
          <a href="/mushi-mushi/testers/how-it-works/" className="testers-brand-mark mt-2 inline-block text-sm underline underline-offset-2 hover:opacity-90">
            Full guide: How Mushi Bounties works →
          </a>
        </div>

        <div className="pt-4">
          <a href={joinUrl} className="testers-cta block w-full px-8 py-3 text-center text-base">
            Start testing {app.name} →
          </a>
        </div>
      </div>
    </TestersPageShell>
  )
}
