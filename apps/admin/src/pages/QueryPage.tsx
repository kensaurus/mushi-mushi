import { useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Card, Btn, Input } from '../components/ui'

interface QueryResult {
  sql: string
  explanation: string
  results: unknown[]
  summary: string
}

interface QueryHistoryItem {
  question: string
  result: QueryResult
  timestamp: number
}

const SUGGESTIONS = [
  'How many critical bugs were reported this week?',
  'Which component has the most bugs?',
  'Show reports that might be regressions',
  'What is the average judge score this month?',
  'List dismissed reports with low reputation reporters',
]

export function QueryPage() {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<QueryHistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(q?: string) {
    const queryText = q ?? question
    if (!queryText.trim()) return

    setLoading(true)
    setError(null)

    const res = await apiFetch<QueryResult>('/v1/admin/query', {
      method: 'POST',
      body: JSON.stringify({ question: queryText }),
    })

    if (res.ok && res.data) {
      setHistory(prev => [{ question: queryText, result: res.data!, timestamp: Date.now() }, ...prev])
      setQuestion('')
    } else {
      setError(res.error?.message ?? 'Query failed')
    }

    setLoading(false)
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader title="Ask Your Data" />

      <PageHelp
        title="About Ask Your Data"
        whatIsIt="A natural-language interface to your bug database. Type a question and the LLM converts it to read-only SQL, runs it, and summarizes the answer."
        useCases={[
          'Answer ad-hoc questions without writing SQL ("which component had the most P0s last week?")',
          'Investigate trends without leaving the admin console',
          'Hand off insight-gathering to non-technical teammates',
        ]}
        howToUse="Type a question or click a suggestion. Expand the SQL panel below each answer to verify the query and inspect the raw rows."
      />

      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Ask a question about your bug reports..."
            disabled={loading}
          />
        </div>
        <Btn onClick={() => handleSubmit()} disabled={loading || !question.trim()}>
          {loading ? 'Thinking...' : 'Ask'}
        </Btn>
      </div>

      {history.length === 0 && (
        <div className="space-y-1.5">
          <p className="text-2xs text-fg-faint">Try one of these:</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map(s => (
              <Btn
                key={s}
                variant="ghost"
                size="sm"
                onClick={() => { setQuestion(s); handleSubmit(s) }}
              >
                {s}
              </Btn>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 bg-danger-muted/50 border border-danger/20 rounded-sm text-xs text-danger">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {history.map((item, i) => (
          <Card key={i} className="p-3 space-y-2">
            <p className="text-sm text-fg font-medium">{item.question}</p>
            <p className="text-xs text-fg-secondary">{item.result.summary}</p>

            <details className="text-2xs">
              <summary className="text-fg-faint cursor-pointer hover:text-fg-muted">
                SQL · {item.result.results.length} rows
              </summary>
              <pre className="mt-1.5 p-2 bg-surface-root rounded-sm text-fg-muted overflow-x-auto font-mono">
                {item.result.sql}
              </pre>
              {item.result.results.length > 0 && (
                <pre className="mt-1 p-2 bg-surface-root rounded-sm text-fg-muted overflow-x-auto max-h-48 font-mono">
                  {JSON.stringify(item.result.results.slice(0, 10), null, 2)}
                </pre>
              )}
            </details>
          </Card>
        ))}
      </div>
    </div>
  )
}
