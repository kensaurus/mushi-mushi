import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  Input,
  RelativeTime,
  Section,
  Loading,
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
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [runs, setRuns] = useState<RunItem[]>([])

  const loadHistory = useCallback(() => {
    setHistoryLoading(true)
    apiFetch<{ history: HistoryRow[] }>('/v1/admin/query/history?limit=25')
      .then((res) => {
        if (res.ok) {
          setHistory(res.data?.history ?? [])
        } else {
          toast.error(
            'Could not load query history',
            res.error?.message ?? 'The history sidebar will stay empty until the next successful fetch.',
          )
        }
      })
      .catch((err) => {
        toast.error('Could not load query history', err instanceof Error ? err.message : String(err))
      })
      .finally(() => setHistoryLoading(false))
  }, [toast])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

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
      setHistory((prev) => prev.filter((h) => h.id !== id))
      toast.success('Query removed from history')
    } else {
      toast.error('Failed to delete', res.error?.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Ask Your Data" />

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
            <Btn onClick={() => handleSubmit()} disabled={loading || !question.trim()}>
              {loading ? 'Thinking…' : 'Ask'}
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

        <Section title="History" className="self-start">
          {historyLoading ? (
            <Loading text="Loading…" />
          ) : history.length === 0 ? (
            <p className="text-xs text-fg-muted">No queries yet.</p>
          ) : (
            <ul className="space-y-1.5 max-h-[32rem] overflow-y-auto -mr-1 pr-1">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="rounded-sm border border-edge-subtle p-2 hover:bg-surface-overlay/30 motion-safe:transition-colors group"
                >
                  <button
                    type="button"
                    onClick={() => handleSubmit(h.prompt)}
                    className="text-left w-full text-2xs text-fg-secondary hover:text-fg"
                    title={h.error ?? 'Click to rerun'}
                  >
                    <span className="line-clamp-2">{h.prompt}</span>
                  </button>
                  <div className="flex items-center justify-between mt-1 text-3xs text-fg-faint font-mono">
                    <span>
                      <RelativeTime value={h.created_at} />
                      {h.error ? (
                        <span className="ml-1 text-danger">· error</span>
                      ) : (
                        <span className="ml-1">· {h.row_count} row{h.row_count === 1 ? '' : 's'}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteHistory(h.id)}
                      className="opacity-0 group-hover:opacity-100 motion-safe:transition-opacity hover:text-danger"
                      aria-label="Delete history entry"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
