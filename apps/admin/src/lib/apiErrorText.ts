/**
 * FILE: apps/admin/src/lib/apiErrorText.ts
 * PURPOSE: One plain-English sentence for a failed mutation (toast or inline
 *          alert). apiFetch errors are `{ code, message }` objects; passing
 *          one to `new Error()` or a toast printed "[object Object]".
 *
 *          The server's own message wins when it is written for people
 *          ("Viewers can't mark items shipped"). humanizeApiError only fills
 *          in when the message is empty, is just a code, or comes from a
 *          transport/database failure whose text is not meant for a toast.
 */

import { humanizeApiError } from './humanizeApiError'

type ApiErrorLike = { code?: string | null; message?: string | null } | string | null | undefined

/** Codes whose message is a transport or database detail, never user copy. */
const GENERIC_CODES = new Set(['HTTP_ERROR', 'NETWORK_ERROR', 'DB_ERROR', 'INTERNAL', 'INTERNAL_ERROR', 'RPC_ERROR', 'INVALID_RESPONSE'])

const CODE_ONLY = /^[A-Z][A-Z0-9_]{1,64}$/

export function apiErrorText(error: ApiErrorLike, fallback: string): string {
  const parsed = typeof error === 'string' ? { code: null, message: error } : (error ?? { code: null, message: null })
  const code = (parsed.code ?? '').toUpperCase() || null
  const message = (parsed.message ?? '').trim()
  const messageIsCopy = message.length > 0 && !CODE_ONLY.test(message) && message !== '[object Object]'

  if (messageIsCopy && !(code && GENERIC_CODES.has(code))) return message

  if (code && code !== 'ERROR') {
    const human = humanizeApiError(message || code, code)
    // The generic page-load fallback ("Could not load this page.") is wrong
    // in a mutation toast; only use the mapping when it names the problem.
    if (human && human.title !== 'Could not load this page.') {
      return `${human.title} ${human.hint}`.trim()
    }
  }
  return fallback
}
