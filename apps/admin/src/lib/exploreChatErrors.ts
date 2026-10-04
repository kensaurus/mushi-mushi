/**
 * FILE: apps/admin/src/lib/exploreChatErrors.ts
 * PURPOSE: What the Ask tab shows when an answer fails. Only NO_LLM_KEY and
 *          INDEX_DISABLED used to surface; every other failure (rate limit,
 *          LLM error, forbidden, a stream cut mid-answer) deleted the empty
 *          bubble or left a half answer spinning forever, and the user saw
 *          nothing.
 */

import { apiErrorMessage } from './humanizeApiError'

export interface ChatTurnLike {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  /** Plain-English failure shown under (or instead of) the answer. */
  error?: string
}

/** One sentence for a failed Ask, from the stream's `{ code, message }`. */
export function askErrorMessage(err: { code: string; message: string }): string {
  const code = err.code.toUpperCase()
  if (code === 'HTTP_429') return apiErrorMessage({ code: 'RATE_LIMITED', message: err.message }, '')
  if (code === 'STREAM_NETWORK') return apiErrorMessage({ code: 'NETWORK_ERROR', message: err.message }, '')
  if (code.startsWith('STREAM_')) return 'The answer stopped before it finished. Ask again.'
  if (/^HTTP_5\d\d$/.test(code)) return 'Something went wrong on our side. Ask again in a moment.'
  return apiErrorMessage(err, 'The question could not be answered. Ask again in a moment.')
}

/**
 * Close the in-flight assistant bubble with the error: an empty bubble
 * becomes the error, a partly streamed one keeps its text, stops streaming
 * and carries the error under it.
 */
export function applyAskError<T extends ChatTurnLike>(turns: T[], message: string): T[] {
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'assistant' || !last.streaming) return turns
  const next = [...turns]
  next[next.length - 1] = { ...last, streaming: false, error: message }
  return next
}
