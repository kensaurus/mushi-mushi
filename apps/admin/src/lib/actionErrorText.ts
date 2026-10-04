/**
 * FILE: apps/admin/src/lib/actionErrorText.ts
 * PURPOSE: The body of an error toast after a button press (dispatch,
 *          retry, remove, run). The page-load counterpart is PageLoadError.
 *
 * The API's own sentence wins when it has one ("Only team owners and admins
 * can change the digest."): it names what was refused. A bare code, or no
 * message at all, goes through humanizeApiError so the user never reads
 * "FORBIDDEN" or "(DB_ERROR)".
 */

import { humanizeApiError } from './humanizeApiError'

const GENERIC_TITLES = new Set(['Could not load this page.', 'The server returned an error.'])

function isSentence(message: string): boolean {
  // A code like INTERNAL_ERROR, or "message (CODE)" with nothing else, is not a sentence.
  if (/^[A-Z0-9_]+$/.test(message)) return false
  return /\s/.test(message) && /[a-z]/.test(message)
}

export function actionErrorText(
  error: { code?: string | null; message?: string | null } | null | undefined,
  fallback = 'Something went wrong. Try again in a minute.',
): string {
  const message = (error?.message ?? '').trim()
  // usePageData-style "message (CODE)": keep the message, drop the code.
  const stripped = message.replace(/\s+\(([A-Z][A-Z0-9_]{1,64})\)$/, '').trim()
  if (stripped && isSentence(stripped)) return stripped
  const code = error?.code ?? null
  const humanized = humanizeApiError(message || code || null, code)
  if (humanized && !GENERIC_TITLES.has(humanized.title)) return `${humanized.title} ${humanized.hint}`
  return fallback
}
