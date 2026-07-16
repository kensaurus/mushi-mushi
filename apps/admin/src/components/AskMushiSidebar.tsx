/**
 * FILE: apps/admin/src/components/AskMushiSidebar.tsx
 * PURPOSE: Cmd/Ctrl+J right-anchored chat drawer — "Ask Mushi". Replaces
 *          the previous AIAssistSidebar with:
 *            • Persistent thread (hybrid model — flat rows tagged with
 *              route/project/selection, grouped by thread_id on read).
 *            • Streaming via SSE when MUSHI_ASK_STREAMING is on; falls
 *              back to single-shot POST otherwise.
 *            • Markdown rendering of assistant replies via streamdown.
 *            • Per-message LLM telemetry strip (model · latency · tokens
 *              · cost), and a thread-total footer.
 *            • Clarifying-question loop — chips render under the bubble
 *              and a click sends the option as the next user message.
 *            • Slash commands and @ mentions through `AskMushiComposer`.
 *            • History popover (recent threads on the current route).
 *
 *          Page context is still read from the publish/subscribe registry
 *          (`usePageContext()`), so the assistant always sees what the
 *          user sees — filters, focused entity, page-published quick
 *          actions and `@`-mentionables.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import {
  STREAMDOWN_LINK_SAFETY,
  streamdownUrlTransform,
} from '../lib/streamdownSafety'
import { apiFetch } from '../lib/supabase'
import { Drawer } from './Drawer'
import { Btn, Loading, Tooltip } from './ui'
import { usePageContext, contextFilterChips, type PageContext } from '../lib/pageContext'
import { formatLlmCost } from '../lib/format'
import { langfuseTraceUrl, RESOLVED_API_URL, RESOLVED_SUPABASE_ANON_KEY } from '../lib/env'
import { debugLog, debugError } from '../lib/debug'
import { Sentry } from '../lib/sentry'
import { AskMushiComposer } from './AskMushiComposer'
import { SLASH_COMMANDS, type SlashCommand } from '../lib/askMushiCommands'
import { ClarifyChips } from './ClarifyChips'
import { InlineProof, SignalChip } from './report-detail/ReportSurface'
import { EmptySectionMessage } from './report-detail/ReportClassification'
import {
  isAskMushiStreamingEnabled,
  openAskMushiStream,
  type AskMushiStreamHandle,
} from '../lib/askMushiStream'
import type {
  AskMushiMessage,
  AskMushiSendBody,
  AskMushiSendResponse,
  AskMushiThreadSummary,
  AskMushiIntent,
} from '../lib/askMushiTypes'
import { useTheme } from '../lib/useTheme'
import { askMushiShikiThemes, formatAssistantMarkdown, formatThreadTitle } from '../lib/askMushiTerminalTheme'

interface Props {
  open: boolean
  onClose: () => void
  /** Current route path — sent as a fallback when no page has published
   *  richer context via `usePublishPageContext`. */
  route: string
  /** Optional seed message from Cmd+K "Continue in sidebar" (composer pre-fill). */
  seedMessage?: string | null
  /** When set, hydrate the palette assist thread instead of starting empty. */
  seedThreadId?: string | null
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Fallback for older browsers — good enough for thread ids since the
  // server validates the regex shape and ignores collisions.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function buildContextPayload(activeCtx: PageContext | null) {
  if (!activeCtx) return null
  return {
    title: activeCtx.title,
    summary: activeCtx.summary,
    filters: activeCtx.filters,
    selection: activeCtx.selection ?? null,
  }
}

export function AskMushiSidebar({ open, onClose, route, seedMessage, seedThreadId }: Props) {
  const pageCtx = usePageContext()
  const activeCtx = pageCtx && pageCtx.route === route ? pageCtx : null
  const { resolved: appTheme } = useTheme()
  const shikiTheme = useMemo(() => askMushiShikiThemes(appTheme), [appTheme])

  const [messages, setMessages] = useState<AskMushiMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [threadId, setThreadId] = useState<string>(() => uuid())
  const [intentOverride, setIntentOverride] = useState<AskMushiIntent | null>(null)
  const [modelOverride, setModelOverride] = useState<'sonnet' | 'haiku' | 'gpt' | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inflightRef = useRef<AbortController | null>(null)
  const streamRef = useRef<AskMushiStreamHandle | null>(null)
  const paletteHandoffRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      paletteHandoffRef.current = null
      return
    }
    if (seedThreadId) return
    if (seedMessage?.trim()) {
      setInput(seedMessage.trim())
    }
    const t = setTimeout(() => {
      const ta = document.querySelector<HTMLTextAreaElement>(
        'form textarea:not([readonly])',
      )
      ta?.focus()
    }, 120)
    return () => clearTimeout(t)
  }, [open, seedMessage, seedThreadId])

  useEffect(() => {
    if (open) return
    inflightRef.current?.abort()
    streamRef.current?.cancel()
    inflightRef.current = null
    streamRef.current = null
  }, [open])

  useEffect(() => () => {
    inflightRef.current?.abort()
    streamRef.current?.cancel()
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, pending])

  const startNewThread = useCallback(() => {
    inflightRef.current?.abort()
    streamRef.current?.cancel()
    setMessages([])
    setInput('')
    setThreadId(uuid())
    setIntentOverride(null)
  }, [])

  const sendTurn = useCallback(
    async (text: string, intent: AskMushiIntent = 'default') => {
      const trimmed = text.trim()
      if (!trimmed || pending) return

      const userMsg: AskMushiMessage = {
        id: uuid(),
        role: 'user',
        content: trimmed,
      }
      const next = [...messages, userMsg]
      setMessages(next)
      setInput('')
      setPending(true)

      inflightRef.current?.abort()
      streamRef.current?.cancel()

      const ctxPayload = buildContextPayload(activeCtx)
      const body: AskMushiSendBody = {
        threadId,
        route,
        mode: 'chat',
        context: ctxPayload,
        intent: intentOverride ?? intent,
        messages: next.map((m) => ({ role: m.role, content: m.content })),
      }

      // Streaming path. Falls back to non-stream POST on any error so the
      // UX is identical when the SSE flag is off or the backend isn't
      // ready yet — only the typewriter effect drops.
      const useStream = isAskMushiStreamingEnabled() && !modelOverride
      debugLog('ask-mushi', `Sending turn (${useStream ? 'stream' : 'POST'})`, {
        endpoint: `${RESOLVED_API_URL}/v1/admin/ask-mushi/messages${useStream ? '/stream' : ''}`,
        model: modelOverride ?? 'server-default',
        intent: intentOverride ?? intent,
        route,
        threadId,
        messageCount: next.length,
        streaming: useStream,
        anonKeyPrefix: RESOLVED_SUPABASE_ANON_KEY.slice(0, 10) + '…',
      })
      const appendPostAssistant = (data: AskMushiSendResponse) => {
        if (data.threadId && data.threadId !== threadId) setThreadId(data.threadId)
        const reply = data.reply
        const assistant: AskMushiMessage = {
          id: uuid(),
          role: 'assistant',
          content: data.message.content,
          model: data.model,
          fallbackUsed: data.fallbackUsed,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          cacheReadTokens: data.cacheReadTokens,
          cacheCreateTokens: data.cacheCreateTokens,
          costUsd: data.costUsd,
          latencyMs: data.latencyMs,
          clarify:
            reply.kind === 'clarify'
              ? { question: reply.question, options: reply.options }
              : null,
        }
        setMessages((prev) => [...prev, assistant])
      }

      const runPostTurn = async () => {
        const ctrl = new AbortController()
        inflightRef.current = ctrl
        try {
          const res = await apiFetch<AskMushiSendResponse>('/v1/admin/ask-mushi/messages', {
            method: 'POST',
            body: JSON.stringify(body),
            signal: ctrl.signal,
          })
          if (ctrl.signal.aborted) return
          if (!res.ok || !res.data) {
            setMessages((prev) => [
              ...prev,
              {
                id: uuid(),
                role: 'assistant',
                content: `(couldn't reach the assistant: ${res.error?.message ?? 'unknown error'})`,
              },
            ])
            return
          }
          appendPostAssistant(res.data)
        } catch (e) {
          if (ctrl.signal.aborted) return
          setMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              role: 'assistant',
              content: `(network error: ${e instanceof Error ? e.message : 'unknown'})`,
            },
          ])
        } finally {
          if (inflightRef.current === ctrl) inflightRef.current = null
          setPending(false)
          setIntentOverride(null)
          setModelOverride(null)
        }
      }

      if (useStream) {
        const assistantId = uuid()
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: 'assistant', content: '', streaming: true },
        ])
        let accumulated = ''
        try {
          const handle = await openAskMushiStream(body, {
            onStart: ({ threadId: tid }) => {
              if (tid && tid !== threadId) setThreadId(tid)
            },
            onDelta: (delta) => {
              accumulated += delta
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: accumulated } : m,
                ),
              )
            },
            onMeta: (meta) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        model: meta.model ?? null,
                        fallbackUsed: meta.fallbackUsed ?? null,
                        latencyMs: meta.latencyMs ?? null,
                        inputTokens: meta.inputTokens ?? null,
                        outputTokens: meta.outputTokens ?? null,
                        cacheReadTokens: meta.cacheReadTokens ?? null,
                        cacheCreateTokens: meta.cacheCreateTokens ?? null,
                        costUsd: meta.costUsd ?? null,
                      }
                    : m,
                ),
              )
            },
            onDone: () => {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
              )
              setPending(false)
              // Streaming path returns early below, bypassing the
              // non-stream `finally` that resets per-turn overrides.
              // Without this clear, an intent override from a slash
              // command (e.g. `/tldr`) would silently apply to every
              // subsequent turn until the user reloaded.
              setIntentOverride(null)
              setModelOverride(null)
            },
            onError: (err) => {
              debugError('ask-mushi:stream', 'Stream failed — falling back to POST', err)
              streamRef.current?.cancel()
              // Drop the empty/half-rendered streaming bubble; POST will append
              // a complete assistant turn (same contract as non-stream path).
              setMessages((prev) => prev.filter((m) => m.id !== assistantId))
              void runPostTurn()
            },
          })
          streamRef.current = handle
          return
        } catch (err) {
          // Drop the half-rendered assistant bubble and fall back to POST.
          setMessages((prev) => prev.filter((m) => m.id !== assistantId))
          console.warn('Ask Mushi stream init failed, falling back to POST', err)
          Sentry.captureMessage('Ask Mushi stream init failed, falling back to POST', {
            level: 'warning',
            tags: { route: 'ask-mushi', fallback: 'post' },
            extra: { err: err instanceof Error ? err.message : String(err) },
          })
        }
      }

      // Non-stream path — single round-trip POST.
      await runPostTurn()
    },
    [messages, pending, route, activeCtx, threadId, intentOverride, modelOverride],
  )

  // Slash-command handler. Three shapes: prepend (rewrite + send),
  // local (clear / help), and model-override (annotate next turn).
  //
  // `strippedInput` is the textarea value with the slash token already
  // removed, supplied by the composer. We must use it instead of the
  // `input` state — `setInput(stripped)` from the composer is batched
  // alongside this callback, so the closure here would still see the
  // un-stripped text and embed the residual `/tldr` token in the
  // composed message sent to the LLM.
  const handleSlashCommand = useCallback(
    (cmd: SlashCommand, strippedInput: string) => {
      const eff = cmd.effect
      if (eff.kind === 'local') {
        if (eff.action === 'clear') {
          startNewThread()
        } else if (eff.action === 'help') {
          const helpBody = SLASH_COMMANDS.map(
            (c) => `- \`${c.command}\` — ${c.hint}`,
          ).join('\n')
          setMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              role: 'assistant',
              content: `**Slash commands**\n\n${helpBody}`,
            },
          ])
        }
        return
      }
      if (eff.kind === 'model-override') {
        setModelOverride(eff.model)
        // Surface the override as a system note so the user knows the
        // next turn will use a different model.
        setMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            role: 'system',
            content: `Next turn will use \`${eff.model}\`.`,
          },
        ])
        return
      }
      if (eff.kind === 'prepend') {
        const composed = `${eff.text}\n\n${strippedInput.trim()}`.trim()
        if (eff.intent) setIntentOverride(eff.intent)
        void sendTurn(composed, eff.intent ?? 'default')
      }
    },
    [sendTurn, startNewThread],
  )

  const onSubmit = useCallback(() => {
    void sendTurn(input)
  }, [input, sendTurn])

  const pickClarify = useCallback(
    (option: string) => {
      void sendTurn(option)
    },
    [sendTurn],
  )

  // Thread totals — derived from the local message list. Reload-from-history
  // hydrates the same telemetry fields so this number stays correct even
  // for restored conversations.
  const threadTotals = useMemo(() => {
    let latency = 0
    let tokens = 0
    let cost = 0
    for (const m of messages) {
      latency += m.latencyMs ?? 0
      tokens += (m.inputTokens ?? 0) + (m.outputTokens ?? 0)
      cost += m.costUsd ?? 0
    }
    return { latency, tokens, cost }
  }, [messages])

  const hydrateThread = useCallback(async (id: string) => {
    setHistoryOpen(false)
    inflightRef.current?.abort()
    streamRef.current?.cancel()
    setInput('')
    setPending(true)
    try {
      const res = await apiFetch<{
        messages: Array<{
          id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          model: string | null
          fallback_used: boolean | null
          input_tokens: number | null
          output_tokens: number | null
          cache_read_tokens: number | null
          cache_create_tokens: number | null
          cost_usd: number | null
          latency_ms: number | null
          langfuse_trace_id: string | null
          meta: Record<string, unknown> | null
        }>
      }>(`/v1/admin/ask-mushi/threads/${id}`, { cache: 'no-store' })
      if (!res.ok || !res.data) {
        setMessages([
          {
            id: uuid(),
            role: 'system',
            content: 'Could not load that thread. Open **History** and try again.',
          },
        ])
        return
      }
      if (res.data.messages.length === 0) {
        setThreadId(id)
        setMessages([
          {
            id: uuid(),
            role: 'system',
            content: 'That thread is empty — send a message to continue it.',
          },
        ])
        return
      }
      const hydrated: AskMushiMessage[] = res.data.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content:
          m.role === 'assistant' ? formatAssistantMarkdown(m.content) : m.content,
        model: m.model,
        fallbackUsed: m.fallback_used,
        inputTokens: m.input_tokens,
        outputTokens: m.output_tokens,
        cacheReadTokens: m.cache_read_tokens,
        cacheCreateTokens: m.cache_create_tokens,
        costUsd: m.cost_usd,
        latencyMs: m.latency_ms,
        langfuseTraceId: m.langfuse_trace_id,
        clarify:
          m.meta && (m.meta as Record<string, unknown>).kind === 'clarify' && Array.isArray((m.meta as Record<string, unknown>).options)
            ? {
                question: m.content,
                options: (m.meta as { options: string[] }).options,
              }
            : null,
      }))
      setMessages(hydrated)
      setThreadId(id)
    } finally {
      setPending(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !seedThreadId) return
    if (paletteHandoffRef.current === seedThreadId) return
    paletteHandoffRef.current = seedThreadId
    setInput('')
    void hydrateThread(seedThreadId)
  }, [open, seedThreadId, hydrateThread])

  const title = activeCtx?.title ?? route

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      dimmed={false}
      surface="ask-mushi"
      panelClassName="ask-mushi-terminal"
      title={
        <div className="flex items-center gap-2 min-w-0 ask-mushi-header-title">
          <span className="shrink-0 font-mono tracking-tight">&gt; Ask Mushi</span>
          <span className="text-2xs font-mono truncate">· {title}</span>
        </div>
      }
      headerAction={
        <div className="flex items-center gap-2">
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-2xs px-0 h-auto border-0 underline-offset-2 hover:underline"
            aria-expanded={historyOpen}
            aria-haspopup="menu"
          >
            History ▾
          </Btn>
          {messages.length > 0 && (
            <Btn
              type="button"
              variant="ghost"
              size="sm"
              onClick={startNewThread}
              className="text-2xs px-0 h-auto border-0 underline-offset-2 hover:underline"
            >
              New
            </Btn>
          )}
        </div>
      }
      footer={
        <div>
          {/* Persistent quick-actions strip — shown above the composer
              while a chat is in progress so the page's contributed
              actions stay one click away mid-conversation. */}
          {activeCtx?.actions && activeCtx.actions.length > 0 && messages.length > 0 && (
            <div className="ask-mushi-quick-actions">
              <span className="ask-mushi-quick-actions__label">Page actions</span>
              <div className="ask-mushi-quick-actions__row">
                {activeCtx.actions.map((a) => (
                  // mushi-ui: chrome icon button — Btn variant TBD (terminal quick-action chip row)
                  <button
                    key={a.id}
                    type="button"
                    onClick={a.run}
                    title={a.hint}
                    className="ask-mushi-quick-action-btn"
                  >
                    {a.id.includes('reload') || a.id.includes('refresh') ? (
                      <span className="ask-mushi-quick-action-btn__icon" aria-hidden>
                        ↻
                      </span>
                    ) : null}
                    <span>{a.label}</span>
                    {a.shortcut && (
                      <kbd className="ask-mushi-quick-action-btn__kbd">{a.shortcut}</kbd>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.length > 0 && (
            <InlineProof className="ask-mushi-thread-meta px-3 py-1 flex items-center gap-2 border-t border-edge/40 font-mono tabular-nums">
              <span className="text-fg-secondary">This thread:</span>
              <SignalChip tone="neutral">{(threadTotals.latency / 1000).toFixed(1)}s</SignalChip>
              <SignalChip tone="neutral">{threadTotals.tokens.toLocaleString()} tok</SignalChip>
              <SignalChip tone="brand">{formatLlmCost(threadTotals.cost)}</SignalChip>
            </InlineProof>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit()
            }}
          >
            <AskMushiComposer
              value={input}
              onChange={setInput}
              onSubmit={onSubmit}
              onSlashCommand={handleSlashCommand}
              disabled={pending}
              placeholder={`Ask about ${title}…  /commands · @mention · Enter to send`}
              mentionables={activeCtx?.mentionables}
            />
            <div className="hidden">
              <textarea ref={inputRef} data-ask-mushi-textarea readOnly />
            </div>
            <div className="flex justify-end gap-2 px-3 pb-2">
              {modelOverride && (
                <span className="text-2xs text-brand">model: {modelOverride}</span>
              )}
              {intentOverride && intentOverride !== 'default' && (
                <span className="text-2xs text-brand">intent: {intentOverride}</span>
              )}
              <Btn
                type="submit"
                size="sm"
                variant="primary"
                disabled={pending || input.trim().length === 0}
              >
                {pending ? '…' : 'Send'}
              </Btn>
            </div>
          </form>
        </div>
      }
    >
      <div ref={scrollRef} className="ask-mushi-scroll h-full overflow-y-auto px-4 py-3 space-y-3">
        {historyOpen && (
          <HistoryPopover
            route={route}
            currentThreadId={threadId}
            onPick={hydrateThread}
            onClose={() => setHistoryOpen(false)}
          />
        )}

        {activeCtx &&
          messages.length === 0 &&
          (activeCtx.summary ||
            contextFilterChips(activeCtx.filters).length > 0 ||
            activeCtx.selection) && <ContextStrip ctx={activeCtx} />}

        {messages.length === 0 && (
          <EmptyPrompt
            route={route}
            ctx={activeCtx}
            onSuggest={(t) => setInput(t)}
            onSend={(t) => { void sendTurn(t) }}
            onResumeThread={(id) => { void hydrateThread(id) }}
            resuming={pending}
          />
        )}

        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            shikiTheme={shikiTheme}
            onCopy={() => navigator.clipboard?.writeText(m.content)}
            onClarifyPick={pickClarify}
            disabled={pending}
          />
        ))}

        {pending && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex items-center gap-2 text-2xs text-fg-muted">
            <Loading text="Thinking…" />
          </div>
        )}
      </div>
    </Drawer>
  )
}

function ContextStrip({ ctx }: { ctx: PageContext }) {
  const chips = contextFilterChips(ctx.filters)
  return (
    <section aria-label="Page context sent with each message" className="ask-mushi-context-strip">
      <p className="ask-mushi-context-strip__label">Page context</p>
      {ctx.summary && (
        <p className="ask-mushi-context-strip__summary">{ctx.summary}</p>
      )}
      {chips.length > 0 && (
        <div className="ask-mushi-context-strip__chips">
          {chips.map((c) => (
            <span
              key={`${c.key}:${c.value}`}
              className="ask-mushi-context-chip font-mono"
              title={`Filter: ${c.key} = ${c.value}`}
            >
              {c.key}: {c.value}
            </span>
          ))}
        </div>
      )}
      {ctx.selection && (
        <p className="ask-mushi-context-strip__focus">
          <span className="ask-mushi-context-strip__focus-label">Focus</span>
          <span>{ctx.selection.kind}</span>
          <span className="ask-mushi-context-strip__focus-sep">·</span>
          <span className="font-mono">{ctx.selection.label}</span>
        </p>
      )}
    </section>
  )
}

interface EmptyPromptProps {
  route: string
  ctx: PageContext | null
  /** Populate the composer with a text prefix (slash commands — user may edit before sending). */
  onSuggest: (t: string) => void
  /** Send a message immediately without stopping at the composer (suggestion buttons). */
  onSend: (t: string) => void
  /** Load a prior thread from the server (Resume recent). */
  onResumeThread: (threadId: string) => void
  resuming?: boolean
}

// Curated subset of slash commands surfaced as chips in the empty state.
// Operators told us the slash registry is great when you remember it
// exists and useless when you don't — chips solve the discoverability
// half by showing the four most-used commands as one-click suggestions.
const QUICK_SLASH_CHIPS: { command: string; label: string; hint: string }[] = [
  { command: '/tldr', label: 'TL;DR', hint: 'One short paragraph. Cheap and fast.' },
  { command: '/explain', label: 'Explain', hint: 'Walk me through what I am looking at.' },
  { command: '/why-failed', label: 'Why failed?', hint: 'Diagnose the focused report or fix.' },
  { command: '/draft-pr-summary', label: 'PR summary', hint: 'Draft a Markdown PR description.' },
]

function EmptyPrompt({ route, ctx, onSuggest, onSend, onResumeThread, resuming }: EmptyPromptProps) {
  const suggestions =
    ctx?.questions && ctx.questions.length > 0 ? ctx.questions : suggestionsFor(route)
  const actions = ctx?.actions ?? []

  // Recent threads on this route, lazily fetched. Surfacing them in the
  // empty state turns "open Ask Mushi → start typing → realise I asked
  // this yesterday" into a single click resume.
  const [recent, setRecent] = useState<AskMushiThreadSummary[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void apiFetch<{ threads: AskMushiThreadSummary[] }>(
      `/v1/admin/ask-mushi/threads?route=${encodeURIComponent(route)}&limit=3`,
    ).then((res) => {
      if (cancelled) return
      if (res.ok && res.data?.threads) setRecent(res.data.threads.slice(0, 3))
      else setRecent([])
    })
    return () => {
      cancelled = true
    }
  }, [route])

  return (
    <div className="space-y-4">
      {/* Friendly intro — terser than before so the eye reaches the
          actionable chips and suggestions sooner. */}
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md border font-mono text-xs leading-none"
          style={{
            borderColor: 'var(--am-accent-cyan)',
            color: 'var(--am-accent-cyan)',
            background: 'color-mix(in oklch, var(--am-accent-cyan) 12%, transparent)',
          }}
        >
          &gt;
        </span>
        <div className="min-w-0">
          <p className="ask-mushi-empty-intro text-sm font-medium leading-snug">
            Ask Mushi about{' '}
            {ctx?.title ? (
              <span className="text-[var(--am-accent-cyan)]">{ctx.title}</span>
            ) : (
              <code className="font-mono">{route}</code>
            )}
            .
          </p>
          <p className="ask-mushi-empty-hint mt-1.5">
            The assistant sees your filters, focus, and the page&apos;s quick
            actions. Use <code className="font-mono text-[var(--am-accent-green)]">/commands</code>{' '}
            and <code className="font-mono text-[var(--am-accent-green)]">@mentions</code> in the
            composer to steer the answer.
          </p>
        </div>
      </div>

      {/* Quick slash-command chips — discoverability surface for the
          slash registry. Clicking a chip seeds the composer with the
          slash token so the user can finish the prompt or hit Enter. */}
      <section aria-label="Quick commands">
        <p className="ask-mushi-section-label">Try a command</p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_SLASH_CHIPS.map((c) => (
            // mushi-ui: chrome icon button — Btn variant TBD (terminal slash-command chip)
            <button
              key={c.command}
              type="button"
              onClick={() => onSuggest(`${c.command} `)}
              title={c.hint}
              className="ask-mushi-slash-chip"
            >
              <span className="ask-mushi-slash-chip__cmd">{c.command}</span>
              <span className="opacity-60">·</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Page-aware suggestions — clicking sends immediately so the
          operator gets a response without an extra Enter press. */}
      <section aria-label="Suggested questions">
        <p className="ask-mushi-section-label">Ask about this page</p>
        <div className="space-y-1.5">
          {suggestions.map((s) => (
            // mushi-ui: chrome icon button — Btn variant TBD (full-width suggest row)
            <button
              key={s}
              type="button"
              onClick={() => onSend(s)}
              className="ask-mushi-suggest-btn"
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {actions.length > 0 && (
        <section aria-label="Quick actions on this page" className="ask-mushi-resume-section">
          <p className="ask-mushi-section-label">Page actions</p>
          <div className="ask-mushi-quick-actions__row">
            {actions.map((a) => (
              // mushi-ui: chrome icon button — Btn variant TBD (terminal page-action chip)
              <button
                key={a.id}
                type="button"
                onClick={a.run}
                title={a.hint}
                className="ask-mushi-quick-action-btn"
              >
                {a.id.includes('reload') || a.id.includes('refresh') ? (
                  <span className="ask-mushi-quick-action-btn__icon" aria-hidden>
                    ↻
                  </span>
                ) : null}
                <span>{a.label}</span>
                {a.shortcut && (
                  <kbd className="ask-mushi-quick-action-btn__kbd">{a.shortcut}</kbd>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Recent threads — subtle list at the bottom. Empty array stays
          quiet (no header), null = still loading (we skip rendering for
          one tick to avoid layout flash). */}
      {recent && recent.length > 0 && (
        <section aria-label="Recent threads on this page" className="ask-mushi-resume-section">
          <p className="ask-mushi-section-label">Resume recent</p>
          <ul className="space-y-1.5">
            {recent.map((t) => (
              <li key={t.threadId}>
                {/* mushi-ui: chrome icon button — Btn variant TBD (resume thread list row) */}
                <button
                  type="button"
                  disabled={resuming}
                  onClick={() => onResumeThread(t.threadId)}
                  className="ask-mushi-resume-btn w-full text-left rounded-sm px-2.5 py-2 motion-safe:transition-opacity disabled:opacity-50"
                  title={`Reopen ${t.title || '(empty thread)'}`}
                >
                  <div className="ask-mushi-resume-btn__title truncate">
                    {formatThreadTitle(t.title)}
                  </div>
                  <div className="ask-mushi-resume-btn__meta flex flex-wrap items-center gap-1.5 font-mono mt-1">
                    <span>{new Date(t.lastAt).toLocaleString()}</span>
                    <span className="opacity-60">·</span>
                    <span>{t.messageCount} msg</span>
                    {t.totalCostUsd > 0 && (
                      <>
                        <span className="opacity-60">·</span>
                        <span className="ask-mushi-resume-btn__cost">{formatLlmCost(t.totalCostUsd)}</span>
                      </>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <p className="ask-mushi-resume-hint mt-1.5">
            Or use <strong>History</strong> in the header for older threads.
          </p>
        </section>
      )}
    </div>
  )
}

interface MessageRowProps {
  message: AskMushiMessage
  shikiTheme: ReturnType<typeof askMushiShikiThemes>
  onCopy: () => void
  onClarifyPick: (option: string) => void
  disabled?: boolean
}

function MessageRow({ message, shikiTheme, onCopy, onClarifyPick, disabled }: MessageRowProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const assistantBody = useMemo(
    () => (isUser ? message.content : formatAssistantMarkdown(message.content)),
    [isUser, message.content],
  )
  if (isSystem) {
    return (
      <p className="ask-mushi-system-msg text-center italic text-2xs px-2 py-1">
        {message.content}
      </p>
    )
  }
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-1`}>
      <div
        className={`ask-mushi-msg ask-mushi-msg--${isUser ? 'user' : 'assistant'} max-w-[88%] rounded-sm px-2.5 py-2 leading-relaxed`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <Streamdown
            className="prose-mushi prose-mushi-chat"
            parseIncompleteMarkdown={Boolean(message.streaming)}
            shikiTheme={shikiTheme}
            linkSafety={STREAMDOWN_LINK_SAFETY}
            urlTransform={streamdownUrlTransform}
          >
            {assistantBody || (message.streaming ? '…' : '')}
          </Streamdown>
        )}
      </div>

      {!isUser && message.clarify && (
        <ClarifyChips
          question={message.clarify.question}
          options={message.clarify.options}
          onPick={onClarifyPick}
          disabled={disabled}
        />
      )}

      {!isUser && !message.streaming && (
        <MessageActions message={message} onCopy={onCopy} />
      )}

      {!isUser && !message.streaming && hasTelemetry(message) && (
        <MessageMetaStrip message={message} />
      )}
    </div>
  )
}

function hasTelemetry(m: AskMushiMessage): boolean {
  return Boolean(
    m.model || m.latencyMs != null || m.inputTokens != null || m.outputTokens != null || m.costUsd != null,
  )
}

function MessageMetaStrip({ message }: { message: AskMushiMessage }) {
  const traceUrl = langfuseTraceUrl(message.langfuseTraceId)
  const parts: string[] = []
  if (message.model) parts.push(message.model)
  if (message.latencyMs != null) parts.push(`${(message.latencyMs / 1000).toFixed(1)}s`)
  if (message.inputTokens != null && message.outputTokens != null) {
    let tok = `${message.inputTokens} → ${message.outputTokens} tok`
    if (message.cacheReadTokens) tok += ` (cached ${message.cacheReadTokens})`
    parts.push(tok)
  }
  if (message.costUsd != null) parts.push(formatLlmCost(message.costUsd))
  if (message.fallbackUsed) parts.push('fallback')
  return (
    <InlineProof className="ask-mushi-msg-meta font-mono tabular-nums flex items-center gap-1.5 border-0 bg-transparent px-0 py-0">
      <span>{parts.join(' · ')}</span>
      {traceUrl && (
        <Tooltip content={`Open Langfuse trace ${message.langfuseTraceId}`}>
          <a
            href={traceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-muted hover:text-fg"
          >
            ⓘ
          </a>
        </Tooltip>
      )}
    </InlineProof>
  )
}

function MessageActions({ message, onCopy }: { message: AskMushiMessage; onCopy: () => void }) {
  return (
    <div className="ask-mushi-msg-actions flex items-center gap-1.5">
      <Btn
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCopy}
        className="text-2xs px-0 h-auto border-0 underline-offset-2 hover:underline"
      >
        Copy
      </Btn>
      {message.citations?.map((c) => (
        <a
          key={`${c.kind}:${c.id}`}
          href={c.kind === 'report' ? `/reports/${c.id}` : c.kind === 'fix' ? `/fixes` : '#'}
          className="text-2xs text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity"
        >
          Open {c.kind} ↗
        </a>
      ))}
    </div>
  )
}

function HistoryPopover({
  route,
  currentThreadId,
  onPick,
  onClose,
}: {
  route: string
  currentThreadId: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [threads, setThreads] = useState<AskMushiThreadSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void apiFetch<{ threads: AskMushiThreadSummary[] }>(
      `/v1/admin/ask-mushi/threads?route=${encodeURIComponent(route)}&limit=20`,
    ).then((res) => {
      if (cancelled) return
      if (res.ok && res.data?.threads) setThreads(res.data.threads)
      else setThreads([])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [route])

  return (
    <section
      className="ask-mushi-history-popover rounded-md border p-2 text-xs"
      aria-label="Recent threads"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="ask-mushi-section-label">
          Recent on {route}
        </span>
        <Btn
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-2xs px-0 h-auto border-0"
        >
          Close
        </Btn>
      </div>
      {loading ? (
        <EmptySectionMessage text="Loading…" />
      ) : threads && threads.length > 0 ? (
        <ul className="space-y-0.5">
          {threads.map((t) => (
            <li key={t.threadId}>
              {/* mushi-ui: chrome icon button — Btn variant TBD (history thread list row) */}
              <button
                type="button"
                onClick={() => onPick(t.threadId)}
                className={`ask-mushi-history-item w-full text-left rounded-sm px-2 py-1.5 motion-safe:transition-opacity ${
                  t.threadId === currentThreadId ? 'ask-mushi-history-item--active' : ''
                }`}
              >
                <div className="ask-mushi-resume-btn__title truncate">{formatThreadTitle(t.title)}</div>
                <div className="ask-mushi-resume-btn__meta flex flex-wrap gap-1 font-mono mt-0.5">
                  <span>{new Date(t.lastAt).toLocaleString()}</span>
                  <span className="opacity-60">·</span>
                  <span>{t.messageCount} msg</span>
                  {t.totalCostUsd > 0 && (
                    <>
                      <span className="opacity-60">·</span>
                      <span className="ask-mushi-resume-btn__cost">{formatLlmCost(t.totalCostUsd)}</span>
                    </>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptySectionMessage text="No recent threads on this page." />
      )}
    </section>
  )
}

function suggestionsFor(route: string): string[] {
  if (route.startsWith('/reports')) {
    return [
      'What do the status values (new/queued/triaged/resolved) mean?',
      'How does severity classification work?',
      'Summarize the highest-priority reports right now',
    ]
  }
  if (route.startsWith('/fixes')) {
    return [
      'Why did the latest fix fail?',
      'What does "CI passing" mean for a fix?',
      'Show me the longest-running in-flight fixes',
    ]
  }
  if (route.startsWith('/repo')) {
    return ['Which branches have open PRs awaiting review?', 'Explain the repo sync status']
  }
  if (route.startsWith('/dashboard') || route === '/') {
    return [
      'What are the key health signals I should watch?',
      'Is the auto-fix pipeline healthy today?',
    ]
  }
  return ['Summarize this page', 'What should I do next here?']
}
