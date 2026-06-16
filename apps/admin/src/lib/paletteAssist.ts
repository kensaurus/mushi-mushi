/**
 * FILE: apps/admin/src/lib/paletteAssist.ts
 * PURPOSE: Client helper for Cmd+K navigate-mode Ask Mushi (structured steps + nav targets).
 */

import { apiFetch } from './supabase'
import type { AskMushiContextPayload, AskMushiSendResponse, NavStep, NavTarget } from './askMushiTypes'

export interface PaletteAssistRequest {
  query: string
  route: string
  context: AskMushiContextPayload | null
  threadId?: string
  signal?: AbortSignal
}

export interface PaletteAssistResult {
  threadId: string
  text: string
  steps?: NavStep[]
  navTargets?: NavTarget[]
  clarify?: { question: string; options: string[] }
  langfuseTraceId?: string | null
}

export async function sendPaletteAssist(
  req: PaletteAssistRequest,
): Promise<{ ok: true; data: PaletteAssistResult } | { ok: false; error: string }> {
  const res = await apiFetch<AskMushiSendResponse>('/v1/admin/ask-mushi/messages', {
    method: 'POST',
    signal: req.signal,
    body: JSON.stringify({
      threadId: req.threadId,
      route: req.route,
      mode: 'navigate',
      intent: 'default',
      context: req.context,
      messages: [{ role: 'user', content: req.query.trim() }],
    }),
  })

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error?.message ?? 'Ask failed' }
  }

  const { data } = res
  const reply = data.reply
  if (reply.kind === 'clarify') {
    return {
      ok: true,
      data: {
        threadId: data.threadId,
        text: reply.question,
        clarify: { question: reply.question, options: reply.options },
        langfuseTraceId: (data.meta?.langfuseTraceId as string) ?? null,
      },
    }
  }

  return {
    ok: true,
    data: {
      threadId: data.threadId,
      text: reply.text,
      steps: reply.steps,
      navTargets: reply.navTargets,
      langfuseTraceId: (data.meta?.langfuseTraceId as string) ?? null,
    },
  }
}

export async function submitAssistFeedback(traceId: string, helpful: boolean): Promise<void> {
  const res = await apiFetch<{ recorded?: boolean }>('/v1/admin/ask-mushi/feedback', {
    method: 'POST',
    body: JSON.stringify({ traceId, helpful }),
  })
  if (!res.ok) {
    throw new Error(res.error?.message ?? 'Feedback failed')
  }
}
