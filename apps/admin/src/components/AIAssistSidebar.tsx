/**
 * FILE: apps/admin/src/components/AIAssistSidebar.tsx
 * PURPOSE: Cmd+J / Ctrl+J scoped AI assistant — opens a right-anchored
 *          drawer with a minimal chat interface that forwards the
 *          current **page context** (filters, counts, focused entity)
 *          to the backend so answers stay relevant to what the user is
 *          actually looking at, not just the URL path.
 *
 *          Context flow:
 *            Pages publish via `usePublishPageContext(...)`.
 *            This sidebar reads via `usePageContext()`.
 *            The body sent to `/v1/admin/assist` carries:
 *              { route, context: {title, summary, filters, selection}, messages }
 *            so the backend prompt can condition on real state — e.g.
 *            "the user is on /reports, filtered to status=new
 *             severity=critical, looking at report <id>".
 *
 *          UX affordances built from the same context:
 *            - Header chip strip shows the page title + filter chips so
 *              the user can see what the assistant sees (and catch
 *              stale state before asking a bad question).
 *            - Empty-state suggestions come from the page when possible
 *              (`ctx.questions`) and fall back to the static route-based
 *              list.
 *            - Page-contributed actions render as quick-action chips
 *              below suggestions ("Triage next new report", etc.).
 *
 *          If the endpoint is not available (e.g. feature-flagged off
 *          for a given workspace), the drawer surfaces a clear "not
 *          available" state instead of silently failing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { Drawer } from './Drawer'
import { Btn, Loading } from './ui'
import { usePageContext, contextFilterChips, type PageContext } from '../lib/pageContext'

type Role = 'user' | 'assistant' | 'system'
interface Message {
  role: Role
  content: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Current route path — sent as a fallback when no page has published
   *  richer context via `usePublishPageContext`. */
  route: string
}

interface AssistResponse {
  message?: Message
}

export function AIAssistSidebar({ open, onClose, route }: Props) {
  const pageCtx = usePageContext()
  // Only trust pageCtx if it matches the current route — a stale context
  // from a just-unmounted page would lie to the assistant for one tick.
  const activeCtx = pageCtx && pageCtx.route === route ? pageCtx : null

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Tracks the in-flight assist request so navigation / drawer-close
  // aborts it instead of letting a stale response land in the chat
  // after the user has moved on. Separate from component unmount (we
  // also want to abort when the drawer closes but stays mounted).
  const inflightRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [open])

  // Abort any pending request when the drawer closes so stale replies
  // don't land after the user closed the panel.
  useEffect(() => {
    if (open) return
    inflightRef.current?.abort()
    inflightRef.current = null
  }, [open])

  // Abort on unmount so closures can't touch state after the tree is gone.
  useEffect(() => () => inflightRef.current?.abort(), [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, pending])

  const send = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || pending) return
    const next: Message[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    setPending(true)

    // Cancel any earlier in-flight request so rapid consecutive sends
    // (or a close-then-reopen) don't race — only the latest response
    // should update the conversation.
    inflightRef.current?.abort()
    const controller = new AbortController()
    inflightRef.current = controller

    try {
      // Snapshot the payload fields the backend actually needs. Drop
      // closures (`actions[*].run`) — they'd JSON.stringify to empty
      // objects and the backend can't invoke them anyway.
      const ctxPayload = activeCtx
        ? {
            route: activeCtx.route,
            title: activeCtx.title,
            summary: activeCtx.summary,
            filters: activeCtx.filters,
            selection: activeCtx.selection,
          }
        : null
      const res = await apiFetch<AssistResponse>('/v1/admin/assist', {
        method: 'POST',
        body: JSON.stringify({ route, context: ctxPayload, messages: next }),
        signal: controller.signal,
      })
      // If another send started (or the drawer closed) while we were
      // awaiting, drop this response to avoid out-of-order updates.
      if (controller.signal.aborted) return
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `(couldn't reach the assistant: ${res.error?.message ?? 'unknown error'})`,
          },
        ])
        return
      }
      const reply = res.data?.message
      if (reply && reply.content) {
        setMessages((prev) => [...prev, reply])
      }
    } catch (e) {
      // AbortError from an intentional cancel is expected — not an error
      // worth surfacing in the chat transcript.
      if (controller.signal.aborted) return
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `(network error: ${e instanceof Error ? e.message : 'unknown'})`,
        },
      ])
    } finally {
      if (inflightRef.current === controller) {
        inflightRef.current = null
      }
      // Always clear pending — if an abort was triggered by drawer-close,
      // a later reopen should not leave the composer stuck in "Sending…".
      setPending(false)
    }
  }, [input, messages, pending, route, activeCtx])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const clearConversation = () => {
    setMessages([])
    setInput('')
  }

  const title = activeCtx?.title ?? route

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      dimmed={false}
      title={
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">AI sidebar</span>
          <span className="text-2xs font-mono text-fg-faint truncate">· {title}</span>
        </div>
      }
      headerAction={
        messages.length > 0 ? (
          <button
            type="button"
            onClick={clearConversation}
            className="text-2xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:underline"
          >
            Clear
          </button>
        ) : null
      }
      footer={
        <form
          className="flex gap-2 px-3 py-2 border-t border-edge/60"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={`Ask about ${title}…  (Enter to send, Shift+Enter for newline)`}
            className="flex-1 resize-none bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/40"
            disabled={pending}
          />
          <Btn
            type="submit"
            size="sm"
            variant="primary"
            disabled={pending || input.trim().length === 0}
          >
            {pending ? '…' : 'Send'}
          </Btn>
        </form>
      }
    >
      <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-3 space-y-3">
        {/* Context strip — always first so the user can read back what
            the assistant will see. Shown once there's anything beyond
            the bare route (otherwise it'd just echo the drawer header). */}
        {activeCtx && (activeCtx.summary || contextFilterChips(activeCtx.filters).length > 0 || activeCtx.selection) && (
          <ContextStrip ctx={activeCtx} />
        )}

        {messages.length === 0 && (
          <EmptyPrompt
            route={route}
            ctx={activeCtx}
            onSuggest={(t) => {
              setInput(t)
              inputRef.current?.focus()
            }}
          />
        )}
        {messages.map((m, idx) => (
          <MessageBubble key={idx} message={m} />
        ))}
        {pending && (
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
    <section
      className="rounded-sm border border-edge/50 bg-surface-overlay/40 px-3 py-2 text-2xs space-y-1.5"
      aria-label="Page context sent with each message"
    >
      {ctx.summary && <div className="text-fg-secondary">{ctx.summary}</div>}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={`${c.key}:${c.value}`}
              className="rounded-sm border border-edge-subtle bg-surface-raised/60 px-1.5 py-0.5 font-mono text-fg-muted"
              title={`Filter: ${c.key} = ${c.value}`}
            >
              <span className="text-fg-faint">{c.key}:</span> <span className="text-fg-secondary">{c.value}</span>
            </span>
          ))}
        </div>
      )}
      {ctx.selection && (
        <div className="text-fg-muted">
          <span className="text-fg-faint">Focus:</span>{' '}
          <span className="text-fg-secondary">{ctx.selection.kind}</span>
          <span className="text-fg-faint"> · </span>
          <span className="font-mono text-fg-secondary">{ctx.selection.label}</span>
        </div>
      )}
    </section>
  )
}

interface EmptyPromptProps {
  route: string
  ctx: PageContext | null
  onSuggest: (t: string) => void
}

function EmptyPrompt({ route, ctx, onSuggest }: EmptyPromptProps) {
  // Page-contributed questions take precedence over the static list so
  // /reports filtered to "status=new severity=critical" surfaces
  // different suggestions than /reports filtered to "resolved".
  const suggestions =
    ctx?.questions && ctx.questions.length > 0 ? ctx.questions : suggestionsFor(route)
  const actions = ctx?.actions ?? []

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted leading-relaxed">
        Ask anything about {ctx?.title ? <span className="text-fg-secondary">{ctx.title}</span> : <code className="font-mono">{route}</code>}.
        The assistant knows your current filters and focus, so you can ask about what's on screen without pasting IDs.
      </p>

      <div className="space-y-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggest(s)}
            className="block w-full text-left rounded-sm border border-edge/60 px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-overlay/60 hover:text-fg motion-safe:transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {actions.length > 0 && (
        <div className="pt-2 border-t border-edge/40 space-y-1.5">
          <div className="text-2xs uppercase tracking-wider text-fg-faint">Quick actions on this page</div>
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
        </div>
      )}
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-sm px-2.5 py-1.5 text-xs leading-relaxed ${
          isUser
            ? 'bg-brand/15 text-fg border border-brand/30'
            : 'bg-surface-overlay text-fg-secondary border border-edge/60'
        }`}
      >
        {message.content}
      </div>
    </div>
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
    return [
      'Which branches have open PRs awaiting review?',
      'Explain the repo sync status',
    ]
  }
  if (route.startsWith('/dashboard') || route === '/') {
    return [
      'What are the key health signals I should watch?',
      'Is the auto-fix pipeline healthy today?',
    ]
  }
  return [
    'What is this page for?',
    'How do I get started here?',
  ]
}
