import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Streamdown } from 'streamdown'
import {
  Btn,
  Card,
  ChatComposer,
  ChatScrollRegion,
  ChatThreadItem,
  ChatThreadList,
  ChatTurnShell,
  CodeChip,
  Tooltip,
  WorkbenchSplit,
} from '../ui'
import { IconCheck, IconClose, IconCopy, IconEdit } from '../icons'
import { apiFetch } from '../../lib/supabase'
import { formatLlmCost } from '../../lib/format'
import { useTheme } from '../../lib/useTheme'
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
  id?: string
  role: 'user' | 'assistant'
  content: string
  citations?: CodebaseCitation[]
  streaming?: boolean
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  costUsd?: number | null
  latencyMs?: number | null
  keySource?: 'byok' | 'env' | null
}

interface ChatThreadRow {
  id: string
  title: string | null
  preview: string | null
  created_at: string
  updated_at: string
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
  const [threads, setThreads] = useState<ChatThreadRow[]>([])
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [fatalError, setFatalError] = useState<CodebaseUnderstandError | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const streamRef = useRef<{ cancel: () => void } | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const loadThreads = useCallback(async () => {
    if (!projectId) return
    setThreadsLoading(true)
    const res = await apiFetch<{ threads: ChatThreadRow[] }>(
      `/v1/admin/projects/${projectId}/codebase/chat/threads?limit=30`,
    )
    setThreadsLoading(false)
    if (res.ok && res.data?.threads) setThreads(res.data.threads)
  }, [projectId])

  const loadThreadMessages = useCallback(async (id: string) => {
    if (!projectId) return
    setLoading(true)
    const res = await apiFetch<{
      messages: Array<{
        id: string
        role: 'user' | 'assistant'
        content: string
        citations?: CodebaseCitation[]
        model?: string | null
        input_tokens?: number | null
        output_tokens?: number | null
        cost_usd?: number | null
        latency_ms?: number | null
      }>
    }>(`/v1/admin/projects/${projectId}/codebase/chat/threads/${id}/messages`)
    setLoading(false)
    if (!res.ok || !res.data?.messages) return
    setThreadId(id)
    setTurns(
      res.data.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citations,
        model: m.model ?? null,
        inputTokens: m.input_tokens ?? null,
        outputTokens: m.output_tokens ?? null,
        costUsd: m.cost_usd != null ? Number(m.cost_usd) : null,
        latencyMs: m.latency_ms ?? null,
      })),
    )
  }, [projectId])

  const startNewThread = useCallback(() => {
    streamRef.current?.cancel()
    setThreadId(undefined)
    setTurns([])
    setInput('')
    setFatalError(null)
    setRenamingId(null)
  }, [])

  const deleteThread = useCallback(
    async (id: string) => {
      if (!projectId) return
      if (!window.confirm('Delete this chat thread? This cannot be undone.')) return
      const res = await apiFetch(`/v1/admin/projects/${projectId}/codebase/chat/threads/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) return
      setThreads((prev) => prev.filter((t) => t.id !== id))
      if (threadId === id) startNewThread()
    },
    [projectId, threadId, startNewThread],
  )

  const saveThreadRename = useCallback(
    async (id: string) => {
      if (!projectId) return
      const title = renameDraft.trim()
      if (!title) {
        setRenamingId(null)
        return
      }
      const res = await apiFetch<{ id: string; title: string }>(
        `/v1/admin/projects/${projectId}/codebase/chat/threads/${id}`,
        { method: 'PATCH', body: JSON.stringify({ title }) },
      )
      setRenamingId(null)
      if (res.ok && res.data) {
        setThreads((prev) =>
          prev.map((t) => (t.id === id ? { ...t, title: res.data!.title, preview: res.data!.title } : t)),
        )
      }
    },
    [projectId, renameDraft],
  )

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

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

      setTurns((prev) => [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: '', streaming: true },
      ])
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
                  model: meta.model ?? null,
                  inputTokens: meta.inputTokens ?? null,
                  outputTokens: meta.outputTokens ?? null,
                  costUsd: meta.costUsd ?? null,
                  latencyMs: meta.latencyMs ?? null,
                  keySource: meta.keySource ?? null,
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
            void loadThreads()
          },
          onError: (err) => {
            if (err.code === 'NO_LLM_KEY' || err.code === 'INDEX_DISABLED') {
              setFatalError({ code: err.code, message: err.message })
            }
            setTurns((prev) => {
              const withoutEmpty = prev.filter(
                (t, i) => !(i === prev.length - 1 && t.streaming && !t.content),
              )
              return withoutEmpty
            })
            setLoading(false)
          },
        },
      )
    },
    [loading, projectId, threadId, turns, loadThreads],
  )

  useEffect(() => {
    if (!seed?.question.trim()) return
    void sendMessage(seed.question, seed.fileFocus)
    onSeedConsumed?.()
  }, [seed])

  useEffect(() => () => streamRef.current?.cancel(), [])

  const threadTotals = turns.reduce(
    (acc, t) => {
      if (t.role !== 'assistant') return acc
      acc.cost += t.costUsd ?? 0
      acc.input += t.inputTokens ?? 0
      acc.output += t.outputTokens ?? 0
      return acc
    },
    { cost: 0, input: 0, output: 0 },
  )

  if (fatalError) {
    return <ExploreUnderstandEmpty error={fatalError} onRetry={() => setFatalError(null)} />
  }

  return (
    <WorkbenchSplit
      sidebarWidth="lg"
      sidebar={
        <ChatThreadList
          header={
            <div className="flex items-center justify-between gap-2">
              <span className="text-3xs uppercase tracking-wider text-fg-faint">Threads</span>
              <Btn size="sm" variant="ghost" onClick={startNewThread} disabled={loading}>
                New
              </Btn>
            </div>
          }
        >
          {threadsLoading && threads.length === 0 && (
            <p className="text-3xs text-fg-muted px-2 py-1">Loading…</p>
          )}
          {!threadsLoading && threads.length === 0 && (
            <p className="text-3xs text-fg-muted px-2 py-1">No past chats yet.</p>
          )}
          {threads.map((t) =>
            renamingId === t.id ? (
              <form
                key={t.id}
                className="flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-overlay p-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveThreadRename(t.id)
                }}
              >
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  className="flex-1 min-w-0 text-2xs rounded border border-edge-subtle bg-surface-raised px-1.5 py-1 text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
                  maxLength={200}
                />
                <button
                  type="submit"
                  aria-label="Save title"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-ok hover:bg-ok/10"
                >
                  <IconCheck size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Cancel rename"
                  onClick={() => setRenamingId(null)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-overlay"
                >
                  <IconClose size={14} />
                </button>
              </form>
            ) : (
              <ChatThreadItem
                key={t.id}
                active={threadId === t.id}
                title={t.preview ?? t.title ?? 'Untitled chat'}
                meta={new Date(t.updated_at).toLocaleDateString()}
                onClick={() => void loadThreadMessages(t.id)}
                actions={
                  <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover/thread:opacity-100 sm:group-focus-within/thread:opacity-100 motion-safe:transition-opacity">
                    <Tooltip content="Rename thread">
                      <button
                        type="button"
                        aria-label="Rename thread"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingId(t.id)
                          setRenameDraft(t.title ?? t.preview ?? '')
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        <IconEdit size={13} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Delete thread">
                      <button
                        type="button"
                        aria-label="Delete thread"
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteThread(t.id)
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-fg-muted hover:text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                      >
                        <IconClose size={13} />
                      </button>
                    </Tooltip>
                  </div>
                }
              />
            ),
          )}
        </ChatThreadList>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        {turns.length === 0 && (
          <Card className="p-4 space-y-3 bg-surface-raised">
            <p className="text-sm text-fg-secondary">
              Ask plain-English questions about your indexed repo. Answers cite real files and lines from the codebase index.
            </p>
            <p className="text-2xs text-fg-muted">
              Requires an Anthropic or OpenAI key in{' '}
              <Link to="/settings#byok" className="text-accent underline hover:no-underline">
                Settings → API Keys
              </Link>
              . Usage (model · tokens · cost) appears under each answer.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={loading}
                  onClick={() => void sendMessage(q)}
                  className="text-left text-2xs px-2.5 py-1.5 rounded-md border border-edge-subtle bg-surface-overlay hover:border-brand/40 hover:bg-brand/5 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </Card>
        )}

        {turns.length > 0 && (
          <ChatScrollRegion scrollRef={listRef}>
            {turns.map((turn, i) => (
              <ChatTurnCard
                key={turn.id ?? `turn-${i}`}
                turn={turn}
                onCitationClick={onCitationClick}
              />
            ))}
          </ChatScrollRegion>
        )}

        {threadTotals.cost > 0 || threadTotals.input > 0 ? (
          <p className="text-3xs text-fg-faint font-mono tabular-nums px-0.5">
            Thread total: {threadTotals.input.toLocaleString()} → {threadTotals.output.toLocaleString()} tok
            {threadTotals.cost > 0 ? ` · ${formatLlmCost(threadTotals.cost)}` : ''}
            {' · '}
            <Link to="/settings#byok" className="text-info hover:underline">
              BYOK usage
            </Link>
          </p>
        ) : null}

        <ChatComposer>
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
              className="flex-1 text-sm rounded-md border border-edge-subtle bg-surface-root px-3 py-2 text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 resize-none min-h-[44px]"
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
        </ChatComposer>
      </div>
    </WorkbenchSplit>
  )
}

function ChatTurnCard({
  turn,
  onCitationClick,
}: {
  turn: ChatTurn
  onCitationClick?: (citation: CodebaseCitation) => void
}) {
  const [copied, setCopied] = useState(false)
  const { resolved: theme } = useTheme()
  const isUser = turn.role === 'user'

  const copyContent = useCallback(async () => {
    const text = turn.content.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard denied */
    }
  }, [turn.content])

  const copyAction =
    !turn.streaming && turn.content.trim() ? (
      <Tooltip content={copied ? 'Copied' : 'Copy message'}>
        <button
          type="button"
          aria-label={copied ? 'Copied' : 'Copy message'}
          onClick={() => void copyContent()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {copied ? <IconCheck size={14} className="text-ok" /> : <IconCopy size={14} />}
        </button>
      </Tooltip>
    ) : null

  const citations =
    turn.citations && turn.citations.length > 0 ? (
      <div className="border-t border-edge-subtle/70 px-3 py-2 flex flex-wrap gap-1.5 bg-surface-overlay">
        {turn.citations.map((c, ci) => {
          const label = c.line_start != null ? `${c.file_path}:${c.line_start}` : c.file_path
          return (
            <button
              key={`${label}-${ci}`}
              type="button"
              onClick={() => onCitationClick?.(c)}
              className="text-3xs font-mono px-1.5 py-0.5 rounded border border-edge-subtle bg-surface-raised hover:border-brand/50 hover:text-brand transition-colors"
              title={c.symbol_name ?? c.file_path}
            >
              {label}
            </button>
          )
        })}
      </div>
    ) : null

  const telemetry =
    !isUser && !turn.streaming && hasTelemetry(turn) ? (
      <MessageTelemetryStrip turn={turn} />
    ) : null

  const footer = citations || telemetry ? <>{citations}{telemetry}</> : undefined

  return (
    <ChatTurnShell
      role={turn.role}
      streaming={turn.streaming}
      actions={copyAction}
      footer={footer}
    >
      {isUser ? (
        <p className="text-sm leading-relaxed text-fg whitespace-pre-wrap break-words">{turn.content}</p>
      ) : (
        <Streamdown
          className="prose-mushi prose-mushi-chat"
          parseIncompleteMarkdown={Boolean(turn.streaming)}
          shikiTheme={theme === 'light' ? ['github-light', 'github-light'] : ['github-dark', 'github-dark']}
        >
          {turn.content || (turn.streaming ? '…' : '')}
        </Streamdown>
      )}
    </ChatTurnShell>
  )
}

function hasTelemetry(turn: ChatTurn): boolean {
  return Boolean(
    turn.model ||
      turn.latencyMs != null ||
      turn.inputTokens != null ||
      turn.outputTokens != null ||
      turn.costUsd != null,
  )
}

function MessageTelemetryStrip({ turn }: { turn: ChatTurn }) {
  const meta: string[] = []
  if (turn.latencyMs != null) meta.push(`${(turn.latencyMs / 1000).toFixed(1)}s`)
  if (turn.inputTokens != null && turn.outputTokens != null) {
    meta.push(`${turn.inputTokens.toLocaleString()} → ${turn.outputTokens.toLocaleString()} tok`)
  }
  if (turn.costUsd != null && turn.costUsd > 0) meta.push(formatLlmCost(turn.costUsd))
  if (turn.keySource === 'byok') meta.push('your key')

  return (
    <div className="border-t border-edge-subtle/70 px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-3xs font-mono tabular-nums text-fg-faint bg-surface-overlay">
      {turn.model ? <CodeChip maxWidthClass="max-w-[14rem]">{turn.model}</CodeChip> : null}
      {meta.length > 0 ? <span>{meta.join(' · ')}</span> : null}
      <Link
        to="/settings#byok"
        className="text-info hover:underline font-sans normal-case tracking-normal"
        title="Manage API keys and BYOK usage"
      >
        API keys ↗
      </Link>
    </div>
  )
}
