/**
 * FILE: apps/admin/src/pages/ResearchPage.tsx
 * PURPOSE: Wave E — manual web research powered by BYOK Firecrawl. Admin types
 *          a query during triage, snippets land here, and the user can attach
 *          any snippet to a specific report as evidence.
 *
 *          UX intent: spreadsheet-grade speed. Press Enter to search, snippet
 *          rows are keyboard-navigable, "Attach to report" opens an inline
 *          autocomplete by report id.
 */

import { useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  Input,
  Section,
  Loading,
  ErrorAlert,
  RelativeTime,
} from '../components/ui'
import { useToast } from '../lib/toast'

interface Snippet {
  id: string
  url: string
  title: string | null
  snippet: string | null
  attached_to_report_id: string | null
}

interface SessionRow {
  id: string
  query: string
  mode: 'search' | 'scrape'
  result_count: number
  created_at: string
}

interface SearchResponse {
  sessionId: string
  createdAt: string
  query: string
  results: Snippet[]
}

const SUGGESTIONS = [
  'react query 5 cache invalidation breaking change',
  'supabase auth getUser 401 with valid session',
  'vite 8 esbuild externalization regression',
  'pgvector cosine distance vs inner product accuracy',
  'cloudflare workers fetch ECONNRESET intermittent',
]

export function ResearchPage() {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState<SearchResponse | null>(null)
  const [attachInput, setAttachInput] = useState<Record<string, string>>({})

  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    reload: loadHistory,
  } = usePageData<{ sessions: SessionRow[] }>('/v1/admin/research/sessions?limit=20')
  const sessions = historyData?.sessions ?? null

  async function runSearch(q: string) {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      toast.error('Type a search query first.')
      return
    }
    setSearching(true)
    const res = await apiFetch<SearchResponse>('/v1/admin/research/search', {
      method: 'POST',
      body: JSON.stringify({ query: trimmed, limit: 5 }),
    })
    setSearching(false)
    if (res.ok && res.data) {
      setActive(res.data)
      loadHistory()
    } else {
      const code = res.error?.code
      if (code === 'FIRECRAWL_NOT_CONFIGURED') {
        toast.error('Add a Firecrawl API key in Settings → Firecrawl (BYOK) first.')
      } else if (code === 'FIRECRAWL_AUTH_FAILED') {
        toast.error('Firecrawl rejected the key. Re-check Settings → Firecrawl.')
      } else if (code === 'RATE_LIMITED') {
        toast.error('Firecrawl rate-limited — try again shortly.')
      } else {
        toast.error('Search failed', res.error?.message)
      }
    }
  }

  async function loadSession(id: string) {
    const res = await apiFetch<{ session: SessionRow; snippets: Snippet[] }>(`/v1/admin/research/sessions/${id}`)
    if (res.ok && res.data) {
      setActive({
        sessionId: res.data.session.id,
        createdAt: res.data.session.created_at,
        query: res.data.session.query,
        results: res.data.snippets,
      })
    } else {
      toast.error('Failed to load session', res.error?.message)
    }
  }

  async function attach(snippetId: string) {
    const reportId = (attachInput[snippetId] ?? '').trim()
    if (!reportId) {
      toast.error('Paste the report id to attach to.')
      return
    }
    const res = await apiFetch(`/v1/admin/research/snippets/${snippetId}/attach`, {
      method: 'POST',
      body: JSON.stringify({ reportId }),
    })
    if (res.ok) {
      toast.success(`Snippet attached to ${reportId.slice(0, 8)}…`)
      setAttachInput((s) => ({ ...s, [snippetId]: '' }))
      if (active) {
        setActive({
          ...active,
          results: active.results.map((r) =>
            r.id === snippetId ? { ...r, attached_to_report_id: reportId } : r,
          ),
        })
      }
    } else if (res.error?.code === 'REPORT_NOT_FOUND') {
      toast.error('No report with that id in your project.')
    } else {
      toast.error('Attach failed', res.error?.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Research" />

      <PageHelp
        title="About Research"
        whatIsIt="BYOK Firecrawl-powered web search you run during triage. Use it to look up release-notes for a stubborn report, find Stack Overflow threads matching the error signature, or pull a vendor changelog into the report's evidence trail."
        useCases={[
          'Cross-reference an error signature against current upstream docs.',
          'Find a Stack Overflow thread to attach as triage evidence.',
          'Check if a 3rd-party library shipped a fix in the last 24 hours.',
        ]}
        howToUse="Press Enter to search. Click 'Attach' on any snippet to bind it to a specific report. Sessions persist; the same query within 24h hits the cache for free. The fix-worker also auto-uses Firecrawl when local RAG is sparse — see Settings → Firecrawl for the allow-list and per-call page cap."
      />

      <Section title="Search" className="space-y-2.5">
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(query) }}
          className="flex gap-2 items-center"
        >
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="error signature, library name, doc topic…"
            className="flex-1"
          />
          <Btn type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </Btn>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setQuery(s); runSearch(s) }}
              className="text-2xs font-mono px-1.5 py-0.5 rounded-sm border border-edge bg-surface-raised text-fg-muted hover:text-fg-secondary"
              title="Run this example query"
            >
              {s}
            </button>
          ))}
        </div>
      </Section>

      {active && (
        <Section title={`Results — "${active.query}"`} className="space-y-2.5">
          {active.results.length === 0 ? (
            <div className="text-2xs text-fg-muted">No results returned. Try a broader query or relax the allow-list in Settings.</div>
          ) : (
            active.results.map((r) => (
              <Card key={r.id} className="p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-accent hover:underline truncate block"
                    >
                      {r.title ?? r.url}
                    </a>
                    <div className="text-2xs text-fg-faint truncate">{r.url}</div>
                  </div>
                  {r.attached_to_report_id && (
                    <span className="text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-ok/10 text-ok shrink-0">
                      attached
                    </span>
                  )}
                </div>
                {r.snippet && (
                  <p className="text-2xs text-fg-secondary leading-relaxed line-clamp-3">{r.snippet}</p>
                )}
                {!r.attached_to_report_id && (
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="text"
                      value={attachInput[r.id] ?? ''}
                      onChange={(e) => setAttachInput((s) => ({ ...s, [r.id]: e.target.value }))}
                      placeholder="report id (uuid)"
                      className="flex-1 text-2xs font-mono"
                    />
                    <Btn size="sm" variant="ghost" onClick={() => attach(r.id)}>Attach</Btn>
                  </div>
                )}
              </Card>
            ))
          )}
        </Section>
      )}

      <Section title="Recent sessions" className="space-y-2">
        {historyLoading && <Loading text="Loading history..." />}
        {historyError && <ErrorAlert message={`Failed to load history: ${historyError}`} onRetry={loadHistory} />}
        {sessions && sessions.length === 0 && (
          <div className="text-2xs text-fg-muted">No sessions yet — your first search will land here.</div>
        )}
        {sessions && sessions.length > 0 && (
          <div className="border border-edge rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg-muted text-left border-b border-edge bg-surface-raised">
                  <th className="py-1.5 px-3 font-medium">Query</th>
                  <th className="py-1.5 px-3 font-medium">Mode</th>
                  <th className="py-1.5 px-3 font-medium">Results</th>
                  <th className="py-1.5 px-3 font-medium">When</th>
                  <th className="py-1.5 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-edge/60 hover:bg-surface-raised/40">
                    <td className="py-1.5 px-3 truncate max-w-[28ch]" title={s.query}>{s.query}</td>
                    <td className="py-1.5 px-3 font-mono text-2xs text-fg-muted">{s.mode}</td>
                    <td className="py-1.5 px-3 font-mono text-2xs">{s.result_count}</td>
                    <td className="py-1.5 px-3 text-2xs text-fg-muted"><RelativeTime value={s.created_at} /></td>
                    <td className="py-1.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => loadSession(s.id)}
                        className="text-2xs text-accent hover:underline"
                      >
                        Open →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
