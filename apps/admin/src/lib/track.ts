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
 * Contract: only taxonomy events, and each event's `required` properties
 * must be present and non-null. The types enforce both at compile time; in
 * dev builds a missing required property also logs a warning, for callers
 * that reach here through a cast. The event is still sent — a funnel row
 * with a gap beats a silently dropped one.
 *
 * Guarantees: never throws, never blocks UI, no-op when the SDK is disabled
 * (env vars absent), DNT active, or consent denied — the SDK tracker
 * enforces the last two itself.
 */

import { MUSHI_EVENTS, type MushiEventName } from '@mushi-mushi/core'
import { getMushiSelf, initMushiSelf, isMushiSelfEnabled } from './mushi-self'

type TrackValue = string | number | boolean | null

export type TrackProps = Record<string, TrackValue>

/** The property keys the taxonomy marks `required` for event `E`. */
type RequiredKey<E extends MushiEventName> = (typeof MUSHI_EVENTS)[E]['required'][number]

/**
 * Properties for event `E`: free-form extras plus every required key with a
 * non-null value. Events with no required keys take an optional bag.
 */
type TrackArgs<E extends MushiEventName> = [RequiredKey<E>] extends [never]
  ? [props?: TrackProps]
  : [props: TrackProps & { [K in RequiredKey<E>]: Exclude<TrackValue, null> }]

function missingRequired(event: MushiEventName, props: TrackProps): string[] {
  const required: readonly string[] = MUSHI_EVENTS[event]?.required ?? []
  return required.filter((key) => props[key] === undefined || props[key] === null)
}

/**
 * Emit a console funnel event from the Mushi taxonomy. The SDK loads lazily,
 * so an event fired before it resolves is handed to the init promise rather
 * than dropped.
 */
export function trackSelf<E extends MushiEventName>(event: E, ...args: TrackArgs<E>): void {
  try {
    const props: TrackProps = args[0] ?? {}
    if (import.meta.env.DEV) {
      const missing = missingRequired(event, props)
      if (missing.length > 0) {
        console.warn(`[track] ${event} is missing required properties: ${missing.join(', ')}`)
      }
    }
    const sdk = getMushiSelf()
    if (sdk) {
      sdk.track(event, props)
      return
    }
    // Post-signup and deep-link landings can fire before the lazy import
    // resolves. Still a no-op when disabled.
    if (!isMushiSelfEnabled()) return
    void initMushiSelf()
      .then((late) => {
        try {
          late?.track(event, props)
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
