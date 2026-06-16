import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card } from '../ui'
import { openCodebaseChatStream, type CodebaseChatMessage } from '../../lib/exploreCodebaseStream'
import { ExploreUnderstandEmpty } from './ExploreUnderstandEmpty'
import type { AskSeed, CodebaseCitation, CodebaseUnderstandError } from './exploreUnderstandTypes'

const STARTER_QUESTIONS = [
  'How does authentication work in this repo?',
  'Where is the main API entry point?',
  'What handles error reporting from the SDK?',
  'Which files would I change to add a new admin page?',
]

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  citations?: CodebaseCitation[]
  streaming?: boolean
}

interface Props {
  projectId: string
  seed?: AskSeed | null
  onSeedConsumed?: () => void
  onCitationClick?: (citation: CodebaseCitation) => void
}

export function ExploreChatPanel({
  projectId,
  seed,
  onSeedConsumed,
  onCitationClick,
}: Props) {
  const [threadId, setThreadId] = useState<string | undefined>()
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [fatalError, setFatalError] = useState<CodebaseUnderstandError | null>(null)
  const streamRef = useRef<{ cancel: () => void } | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const sendMessage = useCallback(
    async (text: string, fileFocus?: AskSeed['fileFocus']) => {
      const trimmed = text.trim()
      if (!trimmed || loading || !projectId) return

      setFatalError(null)
      setLoading(true)

      const history: CodebaseChatMessage[] = [
        ...turns.filter((t) => !t.streaming).map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: trimmed },
      ]

      setTurns((prev) => [...prev, { role: 'user', content: trimmed }, { role: 'assistant', content: '', streaming: true }])
      setInput('')

      let acc = ''
      streamRef.current?.cancel()
      streamRef.current = await openCodebaseChatStream(
        projectId,
        { threadId, messages: history, fileFocus },
        {
          onStart: (info) => setThreadId(info.threadId),
          onDelta: (delta) => {
            acc += delta
            setTurns((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: acc }
              return next
            })
          },
          onMeta: (meta) => {
            setThreadId(meta.threadId)
            setTurns((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') {
                next[next.length - 1] = {
                  role: 'assistant',
                  content: acc || last.content,
                  citations: meta.citations,
                }
              }
              return next
            })
          },
          onDone: () => {
            setTurns((prev) =>
              prev.map((t) => (t.streaming ? { ...t, streaming: false } : t)),
            )
            setLoading(false)
          },
          onError: (err) => {
            if (err.code === 'NO_LLM_KEY' || err.code === 'INDEX_DISABLED') {
              setFatalError({ code: err.code, message: err.message })
            }
            setTurns((prev) => {
              const withoutEmpty = prev.filter((t, i) => !(i === prev.length - 1 && t.streaming && !t.content))
              return withoutEmpty
            })
            setLoading(false)
          },
        },
      )
    },
    [loading, projectId, threadId, turns],
  )

  // Intentionally fires once per distinct `seed` object (not on sendMessage /
  // onSeedConsumed identity changes) so a parent-supplied question is sent
  // exactly once. The admin ESLint config does not run react-hooks/exhaustive-
  // deps, so no suppression directive is needed here.
  useEffect(() => {
    if (!seed?.question.trim()) return
    void sendMessage(seed.question, seed.fileFocus)
    onSeedConsumed?.()
  }, [seed])

  useEffect(() => () => streamRef.current?.cancel(), [])

  if (fatalError) {
    return <ExploreUnderstandEmpty error={fatalError} onRetry={() => setFatalError(null)} />
  }

  return (
    <div className="space-y-3">
      {turns.length === 0 && (
        <Card className="p-4 space-y-3">
          <p className="text-sm text-fg-secondary">
            Ask plain-English questions about your indexed repo. Answers cite real files and lines from the codebase index.
          </p>
          <p className="text-2xs text-fg-muted">
            Requires an Anthropic or OpenAI key in{' '}
            <Link to="/settings#byok" className="text-accent underline hover:no-underline">
              Settings → API Keys
            </Link>
            .
          </p>
          <div className="flex flex-wrap gap-2">
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading}
                onClick={() => void sendMessage(q)}
                className="text-left text-2xs px-2.5 py-1.5 rounded-md border border-edge-subtle bg-surface-overlay/50 hover:border-brand/40 hover:bg-brand/5 transition-colors disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </Card>
      )}

      {turns.length > 0 && (
        <div ref={listRef} className="space-y-3 max-h-[min(52vh,520px)] overflow-y-auto pr-1">
          {turns.map((turn, i) => (
            <Card
              key={i}
              className={`p-3 ${turn.role === 'user' ? 'bg-brand/5 border-brand/20' : 'bg-surface-overlay/30'}`}
            >
              <p className="text-3xs uppercase tracking-wider text-fg-faint mb-1">
                {turn.role === 'user' ? 'You' : 'Answer'}
                {turn.streaming ? ' …' : ''}
              </p>
              <p className="text-sm text-fg whitespace-pre-wrap break-words">{turn.content || (turn.streaming ? '…' : '')}</p>
              {turn.citations && turn.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {turn.citations.map((c, ci) => {
                    const label =
                      c.line_start != null
                        ? `${c.file_path}:${c.line_start}`
                        : c.file_path
                    return (
                      <button
                        key={`${label}-${ci}`}
                        type="button"
                        onClick={() => onCitationClick?.(c)}
                        className="text-3xs font-mono px-1.5 py-0.5 rounded border border-edge-subtle bg-surface-root hover:border-brand/50 hover:text-brand transition-colors"
                        title={c.symbol_name ?? c.file_path}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <form
        className="flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault()
          void sendMessage(input)
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about auth, API routes, tests…"
          rows={2}
          disabled={loading}
          className="flex-1 text-sm rounded-md border border-edge-subtle bg-surface-raised px-3 py-2 text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 resize-none min-h-[44px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void sendMessage(input)
            }
          }}
        />
        <Btn type="submit" size="sm" variant="primary" loading={loading} disabled={!input.trim()}>
          Ask
        </Btn>
      </form>
    </div>
  )
}
