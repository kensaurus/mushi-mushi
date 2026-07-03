'use client'
/**
 * Public roadmap — anonymous voting, no auth required.
 * Client component so it works with `output: 'export'` (no server-side
 * searchParams) — mirrors the pattern in ../join/page.tsx and
 * ../apps/[slug]/AppDetailClient.tsx.
 */
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { TestersPageShell } from '../components/TestersPageShell'
import { VoteButton } from './vote-button'

interface RoadmapTicket {
  id: string
  subject: string
  body: string | null
  status: string
  vote_count: number
  comment_count: number
  shipped_at: string | null
}

interface RoadmapData {
  project: { name: string; slug: string } | null
  tickets: RoadmapTicket[]
}

async function getRoadmap(slug: string): Promise<RoadmapData> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return { project: null, tickets: [] }
  try {
    const res = await fetch(`${apiUrl}/v1/public/roadmap/${slug}`, { cache: 'no-store' })
    if (!res.ok) return { project: null, tickets: [] }
    return await res.json() as RoadmapData
  } catch {
    return { project: null, tickets: [] }
  }
}

export function RoadmapClient() {
  const searchParams = useSearchParams()
  const slug = searchParams.get('app') ?? 'demo'
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''

  const [data, setData] = useState<RoadmapData | 'loading'>('loading')

  useEffect(() => {
    setData('loading')
    getRoadmap(slug).then(setData)
  }, [slug])

  const project = data === 'loading' ? null : data.project
  const tickets = data === 'loading' ? [] : data.tickets

  return (
    <TestersPageShell>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <header>
          <p className="testers-kicker mb-2">Public roadmap</p>
          <h1 className="text-2xl font-bold">{project?.name ?? slug} roadmap</h1>
          <p className="testers-muted mt-1 text-sm">Vote without signing in — one tap per item.</p>
        </header>
        {data === 'loading' ? (
          <div className="space-y-3">
            <div className="testers-skeleton h-16 border border-[var(--mushi-rule)]" />
            <div className="testers-skeleton h-16 border border-[var(--mushi-rule)]" />
          </div>
        ) : (
          <ul className="space-y-3">
            {tickets.map((t) => (
              <li key={t.id} className="testers-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium">{t.subject}</h2>
                    {t.body && <p className="testers-muted mt-1 line-clamp-2 text-sm">{t.body}</p>}
                    <p className="testers-faint mt-2 text-xs">
                      {t.shipped_at ? 'Shipped' : t.status}
                    </p>
                  </div>
                  <VoteButton
                    apiUrl={apiUrl}
                    slug={slug}
                    requestId={t.id}
                    initialVoteCount={t.vote_count}
                  />
                </div>
              </li>
            ))}
            {tickets.length === 0 && (
              <p className="testers-muted text-sm">No public feature requests yet.</p>
            )}
          </ul>
        )}
        <p className="testers-faint text-xs">
          Votes are anonymous — tap to vote, tap again to remove. One vote per item per browser.
        </p>
      </div>
    </TestersPageShell>
  )
}
