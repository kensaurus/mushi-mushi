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
import { apiFetch } from '../lib/supabase'
import { Drawer } from './Drawer'
import { Btn, Loading, Tooltip } from './ui'
import { usePageContext, contextFilterChips, type PageContext } from '../lib/pageContext'
import { formatLlmCost } from '../lib/format'
import { langfuseTraceUrl, RESOLVED_API_URL, RESOLVED_SUPABASE_ANON_KEY } from '../lib/env'
import { debugLog } from '../lib/debug'
import { AskMushiComposer } from './AskMushiComposer'
import { ClarifyChips } from './ClarifyChips'
import { ContainedBlock, InlineProof, SignalChip } from './report-detail/ReportSurface'
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
import type { SlashCommand } from '../lib/askMushiCommands'
import { SLASH_COMMANDS } from '../lib/askMushiCommands'

interface Props {
  open: boolean
  onClose: () => void
  /** Current route path — sent as a fallback when no page has published
   *  richer context via `usePublishPageContext`. */
  route: string
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

export function AskMushiSidebar({ open, onClose, route }: Props) {
  const pageCtx = usePageContext()
  const activeCtx = pageCtx && pageCtx.route === route ? pageCtx : null

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

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-ask-mushi-textarea]')
      ta?.focus()
    }, 120)
    return () => clearTimeout(t)
  }, [open])

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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: m.content || `(stream error: ${err.message})`,
                        streaming: false,
                      }
                    : m,
                ),
              )
              setPending(false)
              // Same reasoning as onDone — overrides are scoped to one
              // turn, regardless of whether the stream succeeded.
              setIntentOverride(null)
              setModelOverride(null)
            },
          })
          streamRef.current = handle
          return
        } catch (err) {
          // Drop the half-rendered assistant bubble and fall back to POST.
          setMessages((prev) => prev.filter((m) => m.id !== assistantId))
          console.warn('Ask Mushi stream init failed, falling back to POST', err)
        }
      }

      // Non-stream path — single round-trip POST.
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
        const data = res.data
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
        // Reset overrides — they only apply to one turn at a time.
        setIntentOverride(null)
        setModelOverride(null)
      }
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
      }>(`/v1/admin/ask-mushi/threads/${id}`)
      if (!res.ok || !res.data) return
      const hydrated: AskMushiMessage[] = res.data.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
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

  const title = activeCtx?.title ?? route

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      dimmed={false}
      // Offset below the desktop header (~36px = top-9) so the header
      // chrome remains accessible and visible while the drawer is open.
      // On mobile the header is taller and sits on top of the drawer in
      // the DOM flow already, so we keep full-height there (top-0).
      containerClassName="fixed inset-x-0 bottom-0 top-0 md:top-9 z-50 flex justify-end"
      title={
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">Ask Mushi</span>
          <span className="text-2xs font-mono text-fg-faint truncate">· {title}</span>
        </div>
      }
      headerAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-2xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:underline"
            aria-expanded={historyOpen}
            aria-haspopup="menu"
          >
            History ▾
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={startNewThread}
              className="text-2xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:underline"
            >
              New
            </button>
          )}
        </div>
      }
      footer={
        <div>
          {/* Persistent quick-actions strip — shown above the composer
              while a chat is in progress so the page's contributed
              actions stay one click away mid-conversation. */}
          {activeCtx?.actions && activeCtx.actions.length > 0 && messages.length > 0 && (
            <div className="border-t border-edge/40 bg-surface-overlay/30 px-3 py-1.5 flex flex-wrap gap-1.5">
              {activeCtx.actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={a.run}
                  title={a.hint}
                  className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-raised/60 px-2 py-0.5 text-3xs text-fg-secondary hover:border-edge hover:text-fg motion-safe:transition-colors"
                >
                  <span>{a.label}</span>
                  {a.shortcut && (
                    <kbd className="rounded-sm border border-edge-subtle px-1 font-mono text-3xs text-fg-faint">
                      {a.shortcut}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          )}
          {messages.length > 0 && (
            <InlineProof className="px-3 py-1 flex items-center gap-2 border-t border-edge/40 bg-surface-overlay/20 font-mono tabular-nums">
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
                <span className="text-3xs text-brand">model: {modelOverride}</span>
              )}
              {intentOverride && intentOverride !== 'default' && (
                <span className="text-3xs text-brand">intent: {intentOverride}</span>
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
      <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-3 space-y-3">
        {historyOpen && (
          <HistoryPopover
            route={route}
            currentThreadId={threadId}
            onPick={hydrateThread}
            onClose={() => setHistoryOpen(false)}
          />
        )}

        {activeCtx &&
          (activeCtx.summary ||
            contextFilterChips(activeCtx.filters).length > 0 ||
            activeCtx.selection) && <ContextStrip ctx={activeCtx} />}

        {messages.length === 0 && (
          <EmptyPrompt
            route={route}
            ctx={activeCtx}
            onSuggest={(t) => setInput(t)}
            onSend={(t) => { void sendTurn(t) }}
          />
        )}

        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
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
    <section aria-label="Page context sent with each message">
      <ContainedBlock tone="muted" label="Page context" className="space-y-1.5">
        {ctx.summary && <div className="text-fg-secondary">{ctx.summary}</div>}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <span key={`${c.key}:${c.value}`} title={`Filter: ${c.key} = ${c.value}`}>
                <SignalChip tone="neutral" className="font-mono">
                  {c.key}: {c.value}
                </SignalChip>
              </span>
            ))}
          </div>
        )}
        {ctx.selection && (
          <InlineProof className="border-0 bg-transparent px-0 py-0">
            <span className="text-fg-faint">Focus:</span>{' '}
            <span className="text-fg-secondary">{ctx.selection.kind}</span>
            <span className="text-fg-faint"> · </span>
            <span className="font-mono text-fg-secondary">{ctx.selection.label}</span>
          </InlineProof>
        )}
      </ContainedBlock>
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

function EmptyPrompt({ route, ctx, onSuggest, onSend }: EmptyPromptProps) {
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
          className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md bg-brand/10 border border-brand/30 text-brand text-base leading-none"
        >
          ✦
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg leading-snug">
            Ask Mushi about{' '}
            {ctx?.title ? (
              <span className="text-brand">{ctx.title}</span>
            ) : (
              <code className="font-mono text-fg">{route}</code>
            )}
            .
          </p>
          <ContainedBlock tone="muted" className="mt-0.5">
            <p className="text-2xs text-fg-muted leading-snug">
              The assistant sees your filters, focus, and the page's quick
              actions. Use <code className="font-mono text-fg-secondary">/commands</code>{' '}
              and <code className="font-mono text-fg-secondary">@mentions</code> in the
              composer to steer the answer.
            </p>
          </ContainedBlock>
        </div>
      </div>

      {/* Quick slash-command chips — discoverability surface for the
          slash registry. Clicking a chip seeds the composer with the
          slash token so the user can finish the prompt or hit Enter. */}
      <section aria-label="Quick commands">
        <p className="text-3xs uppercase tracking-wider text-fg-faint mb-1.5">
          Try a command
        </p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_SLASH_CHIPS.map((c) => (
            <button
              key={c.command}
              type="button"
              onClick={() => onSuggest(`${c.command} `)}
              title={c.hint}
              className="inline-flex items-center gap-1 rounded-sm border border-edge-subtle bg-surface-raised/50 px-2 py-0.5 text-2xs text-fg-secondary hover:border-brand/30 hover:bg-brand/5 hover:text-fg motion-safe:transition-colors"
            >
              <span className="font-mono text-brand">{c.command}</span>
              <span className="text-fg-faint">·</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Page-aware suggestions — clicking sends immediately so the
          operator gets a response without an extra Enter press. */}
      <section aria-label="Suggested questions">
        <p className="text-3xs uppercase tracking-wider text-fg-faint mb-1.5">
          Ask about this page
        </p>
        <div className="space-y-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSend(s)}
              className="block w-full text-left rounded-sm border border-edge/60 px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-overlay/60 hover:border-edge hover:text-fg motion-safe:transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {actions.length > 0 && (
        <section aria-label="Quick actions on this page" className="border-t border-edge/40 pt-3">
          <p className="text-3xs uppercase tracking-wider text-fg-faint mb-1.5">
            Quick actions on this page
          </p>
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={a.run}
                title={a.hint}
                className="inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised/50 px-2 py-1 text-2xs text-fg-secondary hover:border-edge hover:text-fg motion-safe:transition-colors"
              >
                <span>{a.label}</span>
                {a.shortcut && (
                  <kbd className="rounded-sm border border-edge-subtle px-1 font-mono text-3xs text-fg-faint">
                    {a.shortcut}
                  </kbd>
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
        <section aria-label="Recent threads on this page" className="border-t border-edge/40 pt-3">
          <p className="text-3xs uppercase tracking-wider text-fg-faint mb-1.5">
            Resume recent
          </p>
          <ul className="space-y-1">
            {recent.map((t) => (
              <li key={t.threadId}>
                <button
                  type="button"
                  onClick={() => onSuggest(`(resume thread ${t.threadId})`)}
                  className="w-full text-left rounded-sm border border-edge-subtle bg-surface-raised/40 px-2 py-1 hover:bg-surface-overlay motion-safe:transition-colors"
                  title={`Reopen ${t.title || '(empty thread)'} in the History menu`}
                >
                  <div className="text-2xs text-fg-secondary truncate">
                    {t.title || '(empty thread)'}
                  </div>
                  <div className="text-3xs flex items-center gap-1.5 font-mono mt-0.5">
                    <InlineProof className="border-0 bg-transparent px-0 py-0 inline-flex flex-wrap gap-1.5">
                      <SignalChip tone="neutral">{new Date(t.lastAt).toLocaleString()}</SignalChip>
                      <SignalChip tone="neutral">{t.messageCount} msg</SignalChip>
                      {t.totalCostUsd > 0 && (
                        <SignalChip tone="brand">{formatLlmCost(t.totalCostUsd)}</SignalChip>
                      )}
                    </InlineProof>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <InlineProof className="mt-1 border-0 bg-transparent px-0 py-0 text-3xs">
            Use the History menu in the header to reload one in full.
          </InlineProof>
        </section>
      )}
    </div>
  )
}

interface MessageRowProps {
  message: AskMushiMessage
  onCopy: () => void
  onClarifyPick: (option: string) => void
  disabled?: boolean
}

function MessageRow({ message, onCopy, onClarifyPick, disabled }: MessageRowProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  if (isSystem) {
    return (
      <ContainedBlock tone="muted" className="text-center italic text-3xs">
        {message.content}
      </ContainedBlock>
    )
  }
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-1`}>
      <div
        className={`max-w-[88%] rounded-sm px-2.5 py-1.5 text-xs leading-relaxed ${
          isUser
            ? 'bg-brand/15 text-fg border border-brand/30 whitespace-pre-wrap'
            : 'bg-surface-overlay text-fg-secondary border border-edge/60'
        }`}
      >
        {isUser ? (
          message.content
        ) : (
          <Streamdown
            className="prose-mushi"
            parseIncompleteMarkdown={Boolean(message.streaming)}
            shikiTheme={['github-dark', 'github-dark']}
          >
            {message.content || (message.streaming ? '…' : '')}
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
    <InlineProof className="font-mono tabular-nums flex items-center gap-1.5 border-0 bg-transparent px-0 py-0">
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
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onCopy}
        className="text-3xs text-fg-faint hover:text-fg-secondary motion-safe:transition-colors focus-visible:outline-none focus-visible:underline"
      >
        Copy
      </button>
      {message.citations?.map((c) => (
        <a
          key={`${c.kind}:${c.id}`}
          href={c.kind === 'report' ? `/reports/${c.id}` : c.kind === 'fix' ? `/fixes` : '#'}
          className="text-3xs text-brand hover:underline"
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
      className="rounded-md border border-edge bg-surface-raised shadow-card p-2 text-xs"
      aria-label="Recent threads"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-2xs uppercase tracking-wider text-fg-faint">
          Recent on {route}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-2xs text-fg-muted hover:text-fg"
        >
          Close
        </button>
      </div>
      {loading ? (
        <EmptySectionMessage text="Loading…" />
      ) : threads && threads.length > 0 ? (
        <ul className="space-y-0.5">
          {threads.map((t) => (
            <li key={t.threadId}>
              <button
                type="button"
                onClick={() => onPick(t.threadId)}
                className={`w-full text-left rounded-sm px-2 py-1 hover:bg-surface-overlay motion-safe:transition-colors ${
                  t.threadId === currentThreadId ? 'border border-brand/30' : ''
                }`}
              >
                <div className="text-xs text-fg-secondary truncate">{t.title || '(empty)'}</div>
                <InlineProof className="border-0 bg-transparent px-0 py-0 mt-0.5 inline-flex flex-wrap gap-1 font-mono">
                  <SignalChip tone="neutral">{new Date(t.lastAt).toLocaleString()}</SignalChip>
                  <SignalChip tone="neutral">{t.messageCount} msg</SignalChip>
                  {t.totalCostUsd > 0 && (
                    <SignalChip tone="brand">{formatLlmCost(t.totalCostUsd)}</SignalChip>
                  )}
                </InlineProof>
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
  return ['What is this page for?', 'How do I get started here?']
}
