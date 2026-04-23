/**
 * FILE: apps/admin/src/lib/askMushiTypes.ts
 * PURPOSE: Wire-format types shared between the Ask Mushi composer, the
 *          sidebar, the history popover, and the streaming hook. Kept in
 *          a separate file so the slash registry can import the
 *          `AskMushiIntent` union without dragging in React.
 */

export type Role = 'user' | 'assistant' | 'system'

export type AskMushiIntent =
  | 'default'
  | 'tldr'
  | 'long'
  | 'pr-summary'
  | 'sql'
  | 'cite'
  | 'why-failed'

/** Structured backend reply. The clarify branch is rendered as chips
 *  instead of prose — clicking a chip is the same as typing the option as
 *  the next user message. */
export type AskMushiReply =
  | { kind: 'answer'; text: string }
  | { kind: 'clarify'; question: string; options: string[] }

/** Per-message LLM telemetry surfaced under each assistant bubble. Mirrors
 *  the columns persisted in `ask_mushi_messages` and `llm_invocations`. */
export interface AskMushiMessageMeta {
  model?: string | null
  fallbackUsed?: boolean | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheCreateTokens?: number | null
  costUsd?: number | null
  latencyMs?: number | null
  langfuseTraceId?: string | null
  /** Echoed from the backend so the UI can render clarify chips. */
  meta?: Record<string, unknown> | null
}

export interface AskMushiMessage extends AskMushiMessageMeta {
  /** Local id — uuid for new turns, the DB row id for hydrated history. */
  id: string
  role: Role
  content: string
  /** When set, the assistant message is a clarify turn; chips come from
   *  `meta.options`. The composer pre-fills with the option label on click. */
  clarify?: { question: string; options: string[] } | null
  /** Citations / mentions returned by the backend, so the per-message
   *  action row can render `Open ↗` deeplinks. */
  citations?: Array<{ kind: string; id: string; label?: string }>
  /** True while a streamed message is still arriving; the UI keeps the
   *  caret blinking and skips the meta strip. */
  streaming?: boolean
}

/** Wire payload posted to /v1/admin/ask-mushi/messages. Kept narrow on
 *  purpose so a malicious page context can't inject through-typed fields. */
export interface AskMushiContextPayload {
  title?: string
  summary?: string
  filters?: Record<string, unknown>
  selection?: { kind: string; id?: string; label: string } | null
}

export interface AskMushiSendBody {
  threadId?: string
  route: string
  context: AskMushiContextPayload | null
  intent: AskMushiIntent
  /** Backend caps to last 20; the client sends the full local thread so
   *  the backend can choose its own summarisation strategy if it grows. */
  messages: Array<{ role: Role; content: string }>
}

export interface AskMushiSendResponse {
  threadId: string
  message: { role: 'assistant'; content: string }
  reply: AskMushiReply
  model: string
  fallbackUsed: boolean
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreateTokens: number | null
  costUsd: number | null
  meta: Record<string, unknown>
}

export interface AskMushiThreadSummary {
  threadId: string
  title: string
  route: string
  pageTitle: string | null
  projectId: string | null
  lastAt: string
  firstAt: string
  messageCount: number
  totalCostUsd: number
}
