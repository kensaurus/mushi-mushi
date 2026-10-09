/**
 * Text Postgres will store. A NUL character, sent as JSON `\u0000`, and a
 * lone UTF-16 surrogate are both refused by `text` / `jsonb` with
 * "unsupported Unicode escape sequence", which fails the whole row.
 *
 * The repo indexer hit it on 2026-10-04 (Sentry MUSHI-MUSHI-SERVER-2B): a
 * source file held a literal NUL, and a 600-char preview slice can also split
 * an emoji's surrogate pair.
 */
export function pgSafeText(s: string): string {
  return s.replaceAll('\u0000', '').toWellFormed()
}

/** First `max` UTF-16 units of `s`, never ending on half a surrogate pair. */
export function pgSafeSlice(s: string, max: number): string {
  return pgSafeText(s.slice(0, max))
}
