/**
 * FILE: packages/server/supabase/functions/_shared/callback-signature.ts
 * PURPOSE: Which header carries an app's signed callback to Mushi (ADR 0072).
 *          `X-Mushi-Signature` is the name, the same one Mushi signs its own
 *          outbound webhooks with. `X-Glotit-Signature` is the legacy name a
 *          webhook deployed before 2026-11-27 may still send: accepted,
 *          deprecated, never needed by a new integration. Pure.
 */

/** Signature headers in the order they are read: the current name first. */
export const CALLBACK_SIGNATURE_HEADERS = ['X-Mushi-Signature', 'X-Glotit-Signature'] as const

/** The callback's signature from the first signature header present, or ''. */
export function callbackSignature(header: (name: string) => string | undefined): string {
  for (const name of CALLBACK_SIGNATURE_HEADERS) {
    const v = header(name)?.trim()
    if (v) return v
  }
  return ''
}
