/**
 * Public roadmap — anonymous voting, no auth required.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Public roadmap — Mushi',
  description: 'Vote on what ships next for apps using Mushi Mushi.',
}

interface RoadmapTicket {
  id: string
  subject: string
  body: string | null
  status: string
  vote_count: number
  comment_count: number
  shipped_at: string | null
}

async function getRoadmap(slug: string): Promise<{
  project: { name: string; slug: string } | null
  tickets: RoadmapTicket[]
}> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  if (!apiUrl) return { project: null, tickets: [] }
  try {
    const res = await fetch(`${apiUrl}/v1/public/roadmap/${slug}`, { next: { revalidate: 60 } })
    if (!res.ok) return { project: null, tickets: [] }
    return await res.json() as { project: { name: string; slug: string }; tickets: RoadmapTicket[] }
  } catch {
    return { project: null, tickets: [] }
  }
}

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string }>
}) {
  const params = await searchParams
  const slug = params.app ?? 'demo'
  const { project, tickets } = await getRoadmap(slug)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-white/10 px-4 py-3">
        <a href="/mushi-mushi/" className="text-violet-400 font-semibold">mushimushi</a>
        <span className="mx-2 text-gray-500">/</span>
        <span>Roadmap</span>
      </nav>
      <main className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        <header>
          <h1 className="text-2xl font-bold">{project?.name ?? slug} roadmap</h1>
          <p className="text-sm text-gray-400 mt-1">Vote without signing in — one tap per item.</p>
        </header>
        <ul className="space-y-3">
          {tickets.map((t) => (
            <li key={t.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{t.subject}</h2>
                  {t.body && <p className="text-sm text-gray-400 mt-1 line-clamp-2">{t.body}</p>}
                  <p className="text-xs text-gray-500 mt-2">
                    {t.vote_count} votes · {t.shipped_at ? 'Shipped' : t.status}
                  </p>
                </div>
                <form action={`/mushi-mushi/roadmap?app=${slug}`} method="get">
                  <button
                    type="button"
                    className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium hover:bg-violet-500"
                    data-vote-id={t.id}
                  >
                    ▲ Vote
                  </button>
                </form>
              </div>
            </li>
          ))}
          {tickets.length === 0 && (
            <p className="text-gray-500 text-sm">No public feature requests yet.</p>
          )}
        </ul>
        <p className="text-xs text-gray-600">
          Wire votes with <code className="text-violet-300">POST /v1/public/roadmap/:slug/:id/vote</code> and a stable visitor id in localStorage.
        </p>
      </main>
    </div>
  )
}
