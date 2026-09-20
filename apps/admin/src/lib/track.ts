/**
 * FILE: apps/admin/src/lib/track.ts
 * PURPOSE: Fire-and-forget product-analytics helper for the admin console.
 *          Wraps the dogfooded Mushi web SDK (`mushi-self.ts`) so call sites
 *          can emit funnel events (`report_opened`, `fix_dispatched`, …)
 *          without caring whether the SDK is enabled, loaded, or consented.
 *
 * Vocabulary: `packages/core/src/analytics-taxonomy.ts` (MUSHI_EVENTS) —
 * the console surface owns `signup_completed`, `report_opened`,
 * `fix_context_pulled`, `fix_dispatched`, `invite_sent`, `upgrade_clicked`,
 * `test_report_sent` and `loop_signup`.
 *
 * Guarantees: never throws, never blocks UI, no-op when the SDK is disabled
 * (env vars absent), DNT active, or consent denied — the SDK tracker
 * enforces the last two itself.
 */

import type { MushiEventName } from '@mushi-mushi/core'
import { getMushiSelf, initMushiSelf, isMushiSelfEnabled } from './mushi-self'

export type TrackProps = Record<string, string | number | boolean | null>

/**
 * Emit a console funnel event. Accepts any string so ad-hoc events don't need
 * a taxonomy round-trip, but prefer `MushiEventName` members — the server
 * validates names against the same regex either way.
 */
export function trackSelf(event: MushiEventName | string, props?: TrackProps): void {
  try {
    const sdk = getMushiSelf()
    if (sdk) {
      sdk.track(event, props ?? {})
      return
    }
    // The SDK loads lazily (dynamic import). Post-signup and deep-link
    // landings can fire before it resolves, so hand the event to the init
    // promise instead of dropping it. Still a no-op when disabled.
    if (!isMushiSelfEnabled()) return
    void initMushiSelf()
      .then((late) => {
        try {
          late?.track(event, props ?? {})
        } catch {
          /* analytics must never surface as an app error */
        }
      })
      .catch(() => {
        /* init failure already reported by mushi-self */
      })
  } catch {
    /* never throw from analytics */
  }
}
