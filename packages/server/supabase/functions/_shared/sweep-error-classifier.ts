/**
 * FILE: packages/server/supabase/functions/_shared/sweep-error-classifier.ts
 * PURPOSE: Decide whether a sweep/indexer failure is a real server bug
 *          (route to Sentry) or an expected operator-config / upstream
 *          condition (log only, don't page).
 *
 *          Lives in `_shared` so the unit test can import it without
 *          dragging in Deno-only top-level statements from
 *          `webhooks-github-indexer/index.ts`. Pure — no I/O, no Deno
 *          globals, no Sentry SDK references.
 *
 * REGRESSION HISTORY: Sentry MUSHI-MUSHI-SERVER-B kept regressing for ~30
 * days because the dogfood repo's PAT was revoked and every hourly cron
 * tick re-emitted `log.error('sweep: repo index failed', error: 'tree fetch
 * 401')`. The structured logger forwards `.error` to Sentry as a captured
 * message, which creates an Issue per Sentry's docs:
 *   https://docs.sentry.io/platforms/javascript/usage/#capturing-messages
 *   ("Messages show up as issues on your issue stream")
 * Demoting auth/permission/transient failures to `.warn` skips the Sentry
 * forwarder while still leaving a queryable structured row in Supabase Logs
 * and the per-repo `last_index_error` for the admin UI to surface.
 */

export type SweepErrorKind = 'auth' | 'permission' | 'transient' | 'unknown';

/**
 * Classify an error thrown anywhere in the sweep pipeline.
 *
 * Heuristics are ordered narrowest → broadest so an unambiguous match wins:
 *   1. Explicit "no_token" / "Bad credentials" / "requires authentication"
 *      → auth (the operator must reconnect GitHub before retries help).
 *   2. Bare 401 / 403 status → auth.
 *   3. "Resource not accessible" / 404 → permission (token is valid but
 *      the project lost access to the specific repo; same operator action).
 *   4. 5xx, network failures, OpenAI TPM hits → transient (the hourly cron
 *      will retry; warn so a sustained spike is still detectable in
 *      Supabase Logs by counting `kind=transient` rows).
 *   5. Everything else → unknown (route to Sentry as a real bug).
 *
 * @param err - The thrown value (Error, string, or unknown).
 * @returns A categorical tag that callers map to `log.warn` vs `log.error`.
 */
export function classifyIndexerError(err: unknown): SweepErrorKind {
  const msg = err instanceof Error ? err.message : String(err);
  // Order matters: a "no_token: ..." message may also contain digits, so
  // check the unambiguous auth phrases before the bare 4xx/5xx digit rules.
  if (/no[_\s]?token|bad credentials|requires authentication/i.test(msg)) return 'auth';
  if (/resource not accessible|not\s+accessible/i.test(msg)) return 'permission';
  if (/\b(401)\b/.test(msg)) return 'auth';
  if (/\b(403)\b/.test(msg)) return 'auth';
  if (/\b(404)\b/.test(msg)) return 'permission';
  // Transient signals worth retrying on the next cron tick:
  //   - 5xx GitHub responses              (\b5\d\d\b, e.g. "tree fetch 502")
  //   - Deno fetch / DNS / TCP failures   (fetch failed, ENOTFOUND, ECONN)
  //   - Embedding call timeouts           (timeout)
  //   - OpenAI rate-limit phrases:        TPM, "rate limit", "request too
  //     large" — the last one fires when a single embedding batch overshoots
  //     the per-minute token cap; see the MUSHI-MUSHI-INDEXER-429 comment in
  //     webhooks-github-indexer/index.ts for the full story.
  if (
    /\b(5\d\d)\b|fetch failed|network|ENOTFOUND|ECONN|timeout|TPM|rate limit|request too large/i.test(
      msg,
    )
  ) {
    return 'transient';
  }
  return 'unknown';
}
