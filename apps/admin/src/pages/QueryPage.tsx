import { useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  Input,
  RelativeTime,
  Section,
  Loading,
  Skeleton,
  ErrorAlert,
} from '../components/ui'
import { useToast } from '../lib/toast'

interface QueryResult {
  sql: string
  explanation: string
  results: unknown[]
  summary: string
  latencyMs?: number
}

interface HistoryRow {
  id: string
  prompt: string
  sql: string | null
  summary: string | null
  explanation: string | null
  row_count: number
  error: string | null
  latency_ms: number | null
  is_saved?: boolean
  created_at: string
}

interface RunItem {
  id: string
  question: string
  result?: QueryResult
  error?: string
  latencyMs?: number
}

const SUGGESTIONS = [
  'How many critical bugs were reported this week?',
  'Which component has the most bugs?',
  'Show reports that might be regressions',
  'Top 5 components by report count this month',
  'List dismissed reports with low reputation reporters',
  'Average judge score by week (last 4 weeks)',
]

const SQL_HINTS: Array<{ prompt: string; whyItWorks: string }> = [
  {
    prompt: 'How many P0/P1 reports landed this week vs last week?',
    whyItWorks: 'Time-bucketed comparison — phrase the deltas explicitly.',
  },
  {
    prompt: 'List components that regressed (fixed → reopened) in the last 30 days',
    whyItWorks: 'Mention "regressed" so the LLM joins reports.fixed_at with later events.',
  },
  {
    prompt: 'Which reporters have the highest agreement rate with the judge?',
    whyItWorks: 'Anchor on a known metric (classification_agreed) so the SQL stays read-only.',
  },
  {
    prompt: 'Average classifier latency by model over the last 14 days',
    whyItWorks: 'Specifying the time window keeps the result set small + the LLM cheap.',
  },
  {
    prompt: 'Reports with screenshots but no console logs in the last 7 days',
    whyItWorks: 'Pair two columns to test telemetry coverage end-to-end.',
  },
]

function asTable(rows: unknown[]): { columns: string[]; data: Record<string, unknown>[] } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const objects = rows.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
  if (objects.length === 0) return null
  const cols = new Set<string>()
  for (const obj of objects.slice(0, 50)) {
    for (const k of Object.keys(obj)) cols.add(k)
  }
  return { columns: [...cols], data: objects }
}

function HistoryItem({
  row,
  onRerun,
  onToggleSave,
  onDelete,
}: {
  row: HistoryRow
  onRerun: () => void
  onToggleSave: () => void
  onDelete: () => void
}) {
  return (
    <li className="rounded-sm border border-edge-subtle p-2 hover:bg-surface-overlay/30 motion-safe:transition-colors group">
      <button
        type="button"
        onClick={onRerun}
        className="text-left w-full text-2xs text-fg-secondary hover:text-fg"
        title={row.error ?? 'Click to rerun'}
      >
        <span className="line-clamp-2">{row.prompt}</span>
      </button>
      <div className="flex items-center justify-between mt-1 text-3xs text-fg-faint font-mono gap-1">
        <span>
          <RelativeTime value={row.created_at} />
          {row.error ? (
            <span className="ml-1 text-danger">· error</span>
          ) : (
            <span className="ml-1">· {row.row_count} row{row.row_count === 1 ? '' : 's'}</span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleSave}
            className={`motion-safe:transition-opacity hover:text-brand ${row.is_saved ? 'text-brand' : 'opacity-0 group-hover:opacity-100'}`}
            aria-label={row.is_saved ? 'Unpin saved query' : 'Pin to saved'}
            title={row.is_saved ? 'Unpin saved query' : 'Pin to Saved'}
          >
            {row.is_saved ? '★' : '☆'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 motion-safe:transition-opacity hover:text-danger"
            aria-label="Delete history entry"
          >
            ✕
          </button>
        </span>
      </div>
    </li>
  )
}

function ResultsTable({ rows }: { rows: unknown[] }) {
  const table = asTable(rows)
  if (!table) {
    return (
      <pre className="p-2 bg-surface-root rounded-sm text-2xs text-fg-muted overflow-x-auto max-h-64 font-mono">
        {JSON.stringify(rows.slice(0, 20), null, 2)}
      </pre>
    )
  }
  return (
    <div className="overflow-x-auto -mx-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-fg-muted text-left border-b border-edge sticky top-0 bg-surface-raised">
            {table.columns.map((c) => (
              <th key={c} className="py-1.5 px-3 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.data.slice(0, 50).map((row, i) => (
            <tr key={i} className="border-b border-edge-subtle text-fg-secondary">
              {table.columns.map((c) => {
                const v = row[c]
                const display =
                  v == null
                    ? '—'
                    : typeof v === 'object'
                      ? JSON.stringify(v)
                      : String(v)
                return (
                  <td key={c} className="py-1.5 px-3 align-top max-w-[16rem] truncate" title={display}>
                    {display}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {table.data.length > 50 && (
        <p className="text-2xs text-fg-faint mt-1 px-3">
          Showing 50 of {table.data.length} rows.
        </p>
      )}
    </div>
  )
}

export function QueryPage() {
  const toast = useToast()
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [runs, setRuns] = useState<RunItem[]>([])

  const {
    data: historyData,
    loading: historyLoading,
    reload: loadHistory,
    error: historyError,
  } = usePageData<{ history: HistoryRow[] }>('/v1/admin/query/history?limit=25')
  const history = historyData?.history ?? []

  async function handleSubmit(q?: string) {
    const queryText = (q ?? question).trim()
    if (!queryText) return
    const id = `q${Date.now()}`
    setLoading(true)
    setRuns((prev) => [{ id, question: queryText }, ...prev])
    setQuestion('')

    const res = await apiFetch<QueryResult>('/v1/admin/query', {
      method: 'POST',
      body: JSON.stringify({ question: queryText }),
    })

    setLoading(false)
    if (res.ok && res.data) {
      setRuns((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, result: res.data, latencyMs: res.data?.latencyMs } : r,
        ),
      )
    } else {
      const err = res.error?.message ?? 'Query failed'
      setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, error: err } : r)))
      toast.error('Query failed', err)
    }
    loadHistory()
  }

  async function deleteHistory(id: string) {
    const res = await apiFetch(`/v1/admin/query/history/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Query removed from history')
      loadHistory()
    } else {
      toast.error('Failed to delete', res.error?.message)
    }
  }

  async function toggleSaved(row: HistoryRow) {
    const next = !(row.is_saved ?? false)
    const res = await apiFetch(`/v1/admin/query/history/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_saved: next }),
    })
    if (res.ok) {
      toast.success(next ? 'Pinned to Saved' : 'Unpinned from Saved')
      loadHistory()
    } else {
      toast.error('Could not update', res.error?.message)
    }
  }

  const saved = history.filter((h) => h.is_saved)
  const recent = history.filter((h) => !h.is_saved)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ask Your Data"
        description="Ad-hoc natural-language questions against your bug data. Read-only, sandboxed, and cited."
      />

      <PageHelp
        title="About Ask Your Data"
        whatIsIt="A natural-language interface to your bug database. Type a question; the LLM converts it to read-only SQL, runs it, and summarizes the answer. Every query is persisted for rerun and audit."
        useCases={[
          'Answer ad-hoc questions without writing SQL',
          'Investigate trends without leaving the admin console',
          'Hand off insight-gathering to non-technical teammates',
        ]}
        howToUse="Type a question or click a suggestion. Open the SQL panel to verify the generated query. Use the history sidebar to rerun past queries."
      />

      <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
        <div className="space-y-3 min-w-0">
          <div className="flex gap-2">
            <Input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="Ask a question about your bug reports…"
              disabled={loading}
              className="flex-1"
            />
            <Btn onClick={() => handleSubmit()} disabled={loading || !question.trim()} loading={loading}>
              Ask
            </Btn>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setQuestion(s); handleSubmit(s) }}
                className="text-2xs px-2 py-1 rounded-sm border border-edge-subtle text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          <Card className="p-3">
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wider text-fg-muted">SQL hints</h3>
              <span className="text-2xs text-fg-faint">Phrase your question to make the LLM produce sharper SQL.</span>
            </div>
            <ul className="space-y-1">
              {SQL_HINTS.map((h) => (
                <li key={h.prompt} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => { setQuestion(h.prompt); handleSubmit(h.prompt) }}
                    className="text-left text-2xs text-fg-secondary hover:text-fg flex-1 min-w-0"
                  >
                    <span className="block truncate">{h.prompt}</span>
                    <span className="block text-3xs text-fg-faint italic">{h.whyItWorks}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-2">
            {runs.length === 0 && (
              <Card className="p-6 text-center">
                <p className="text-xs text-fg-muted">
                  Ask a question above. Successful answers persist to your history sidebar.
                </p>
              </Card>
            )}
            {runs.map((run) => (
              <Card key={run.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-fg font-medium">{run.question}</p>
                  {run.latencyMs != null && (
                    <span className="text-3xs text-fg-faint font-mono shrink-0">
                      {run.latencyMs}ms
                    </span>
                  )}
                </div>
                {!run.result && !run.error && (
                  <Loading text="Generating SQL and running…" />
                )}
                {run.error && (
                  <div className="px-2.5 py-1.5 rounded-sm border border-danger/30 bg-danger-muted/15 text-xs text-danger">
                    <strong>Query failed.</strong> {run.error}
                  </div>
                )}
                {run.result && (
                  <>
                    <p className="text-xs text-fg-secondary leading-relaxed">{run.result.summary}</p>
                    {run.result.explanation && (
                      <p className="text-2xs text-fg-faint italic">{run.result.explanation}</p>
                    )}
                    <details className="text-2xs">
                      <summary className="text-fg-faint cursor-pointer hover:text-fg-muted">
                        SQL · {run.result.results.length} row{run.result.results.length === 1 ? '' : 's'}
                      </summary>
                      <pre className="mt-1.5 p-2 bg-surface-root rounded-sm text-fg-muted overflow-x-auto font-mono whitespace-pre-wrap">
                        {run.result.sql}
                      </pre>
                    </details>
                    {run.result.results.length > 0 && (
                      <div className="mt-1">
                        <ResultsTable rows={run.result.results} />
                      </div>
                    )}
                  </>
                )}
              </Card>
            ))}
          </div>
        </div>

        <div className="self-start space-y-3">
          {saved.length > 0 && (
            <Section title={`Saved (${saved.length})`}>
              <ul className="space-y-1.5">
                {saved.map((h) => (
                  <HistoryItem
                    key={h.id}
                    row={h}
                    onRerun={() => handleSubmit(h.prompt)}
                    onToggleSave={() => toggleSaved(h)}
                    onDelete={() => deleteHistory(h.id)}
                  />
                ))}
              </ul>
            </Section>
          )}
          <Section title="History">
            {historyLoading ? (
              <ul className="space-y-1.5" aria-busy="true" aria-label="Loading history">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="space-y-1">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-2 w-1/3" />
                  </li>
                ))}
              </ul>
            ) : historyError ? (
              <ErrorAlert message={`Could not load history: ${historyError}`} onRetry={loadHistory} />
            ) : recent.length === 0 ? (
              <p className="text-xs text-fg-muted">No queries yet.</p>
            ) : (
              <ul className="space-y-1.5 max-h-[32rem] overflow-y-auto -mr-1 pr-1">
                {recent.map((h) => (
                  <HistoryItem
                    key={h.id}
                    row={h}
                    onRerun={() => handleSubmit(h.prompt)}
                    onToggleSave={() => toggleSaved(h)}
                    onDelete={() => deleteHistory(h.id)}
                  />
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
