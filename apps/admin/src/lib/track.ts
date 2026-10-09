/**
 * FILE: apps/admin/src/lib/track.ts
 * PURPOSE: Fire-and-forget product-analytics helpers for the admin console.
 *          Wrap the dogfooded Mushi web SDK (`mushi-self.ts`) so call sites
 *          can emit events without caring whether the SDK is enabled, loaded,
 *          or consented.
 *
 * Two entry points:
 *
 *   trackSelf(event, props)  — funnel events from the Mushi taxonomy
 *     (`packages/core/src/analytics-taxonomy.ts`, MUSHI_EVENTS). The console
 *     surface owns `signup_completed`, `report_opened`, `fix_context_pulled`,
 *     `fix_dispatched`, `invite_sent`, `upgrade_clicked`, `test_report_sent`
 *     and `loop_signup`. Only taxonomy names, and each event's `required`
 *     properties must be present and non-null. The types enforce both at
 *     compile time. At runtime, a name outside the taxonomy that reaches here
 *     through a cast is dropped, and a missing required property is reported
 *     but the event is still sent — a funnel row with a gap beats a silently
 *     dropped one.
 *
 *   trackAdHoc(name, props)  — anything else: one-off UI measurements and
 *     experiments. The name must match EVENT_NAME_RE and must not be a
 *     taxonomy name (those go through trackSelf so their required properties
 *     are checked). Ad-hoc events land in product_events for the self
 *     project and show up in Users & Funnels, but company_funnel_weekly never
 *     reads them: they do not count toward any funnel step.
 *
 * Diagnostics go to the admin debug channel (`debugWarn`, visible with
 * `?debug=true` / `mushi:debug`, dev or prod) rather than a bare
 * `console.warn`, so they add no residue to scripts/check-residue-ratchet.mjs.
 *
 * Guarantees: never throws, never blocks UI, no-op when the SDK is disabled
 * (env vars absent), DNT active, or consent denied — the SDK tracker
 * enforces the last two itself.
 */

import { EVENT_NAME_RE, MUSHI_EVENTS, type MushiEventName } from '@mushi-mushi/core'
import { debugWarn } from './debug'
import { getMushiSelf, initMushiSelf, isMushiSelfEnabled } from './mushi-self'

type TrackValue = string | number | boolean | null

type TrackProps = Record<string, TrackValue>

/** The property keys the taxonomy marks `required` for event `E`. */
type RequiredKey<E extends MushiEventName> = (typeof MUSHI_EVENTS)[E]['required'][number]

/**
 * Properties for event `E`: free-form extras plus every required key with a
 * non-null value. Events with no required keys take an optional bag.
 */
type TrackArgs<E extends MushiEventName> = [RequiredKey<E>] extends [never]
  ? [props?: TrackProps]
  : [props: TrackProps & { [K in RequiredKey<E>]: Exclude<TrackValue, null> }]

/**
 * A literal taxonomy name is a compile error for trackAdHoc; a widened
 * `string` passes the types and is checked at runtime.
 */
type AdHocName<N extends string> = N extends MushiEventName ? never : N

function isTaxonomyEvent(name: string): name is MushiEventName {
  return Object.prototype.hasOwnProperty.call(MUSHI_EVENTS, name)
}

function missingRequired(event: MushiEventName, props: TrackProps): string[] {
  const required: readonly string[] = MUSHI_EVENTS[event].required
  return required.filter((key) => props[key] === undefined || props[key] === null)
}

/** debugWarn reads localStorage, which throws when site data is blocked. */
function warn(message: string, data: Record<string, unknown>): void {
  try {
    debugWarn('track', message, data)
  } catch {
    /* a diagnostic must never cost the event itself */
  }
}

/**
 * Hand an event to the SDK. The SDK loads lazily, so an event fired before it
 * resolves is handed to the init promise rather than dropped.
 */
function send(name: string, props: TrackProps): void {
  const sdk = getMushiSelf()
  if (sdk) {
    sdk.track(name, props)
    return
  }
  // Post-signup and deep-link landings can fire before the lazy import
  // resolves. Still a no-op when disabled.
  if (!isMushiSelfEnabled()) return
  void initMushiSelf()
    .then((late) => {
      try {
        late?.track(name, props)
      } catch {
        /* analytics must never surface as an app error */
      }
    })
    .catch(() => {
      /* init failure already reported by mushi-self */
    })
}

/** Emit a console funnel event from the Mushi taxonomy. */
export function trackSelf<E extends MushiEventName>(event: E, ...args: TrackArgs<E>): void {
  try {
    if (!isTaxonomyEvent(event)) {
      warn(`${String(event)} is not a Mushi taxonomy event; use trackAdHoc for non-funnel events`, { event })
      return
    }
    const props: TrackProps = args[0] ?? {}
    const missing = missingRequired(event, props)
    if (missing.length > 0) {
      warn(`${event} is missing required properties: ${missing.join(', ')}`, { event, missing })
    }
    send(event, props)
  } catch {
    /* never throw from analytics */
  }
}

/**
 * Emit an event that is NOT part of the Mushi taxonomy. It is stored and
 * browsable in Users & Funnels but never counted by company_funnel_weekly.
 * Dropped (with a debug diagnostic) when the name fails EVENT_NAME_RE or is a
 * taxonomy name — use trackSelf for those.
 */
export function trackAdHoc<N extends string>(name: AdHocName<N>, props: TrackProps = {}): void {
  try {
    if (!EVENT_NAME_RE.test(name)) {
      warn(`${name} is not a valid event name (lowercase snake_case, 2-64 chars)`, { event: name })
      return
    }
    if (isTaxonomyEvent(name)) {
      warn(`${name} is a Mushi taxonomy event; use trackSelf so its required properties are checked`, {
        event: name,
      })
      return
    }
    send(name, props)
  } catch {
    /* never throw from analytics */
  }
}
