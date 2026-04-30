/**
 * FILE: packages/server/supabase/functions/_shared/invoice.ts
 * PURPOSE: Pure helpers for resolving fields off a Stripe Invoice payload
 *          regardless of API version. Lives in its OWN module (with zero
 *          imports — no `Deno.env`, no `./logger.ts`, no fetch wrappers)
 *          so both the Deno Edge runtime AND Vitest in Node can import
 *          the real implementation directly.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `_shared/stripe.ts` is the canonical Stripe wrapper, but it imports a
 * Deno-aware logger and reads `Deno.env` (inside a function — never at
 * module init). Vitest in Node could import it, but the .ts → .ts
 * relative imports plus the `declare const Deno` global make that path
 * fragile. The PR-77 review (Copilot) flagged a regression risk: the
 * test file was re-implementing `subscriptionIdFromInvoice` in a sibling
 * helper, so a future production change could silently pass the test.
 *
 * Splitting the pure helper out closes that gap: production reads the
 * exact same function the test asserts on. If the resolver gains a
 * third location (say, Stripe ships another parent-shape change in
 * 2027), updating this one file fixes both call-sites at once.
 */

/**
 * Resolve the Subscription id from an Invoice payload regardless of API
 * version. The Basil 2025-03-31 release deprecated the top-level
 * `invoice.subscription` field and moved it under `parent.subscription_details`;
 * see https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects.
 *
 * Reading only the legacy field silently breaks dunning on every account
 * pinned to 2025-03-31.basil or later — `payment_failed` and
 * `payment_succeeded` webhooks would no-op and customers with a declined
 * card would keep their paid quota until manual remediation. We read both
 * locations so test fixtures from either era continue to work.
 */
export function subscriptionIdFromInvoice(
  invoice: Record<string, unknown>,
): string | null {
  const parent = invoice.parent as
    | { type?: string; subscription_details?: { subscription?: string | null } }
    | null
    | undefined
  if (parent?.type === 'subscription_details') {
    const fromParent = parent.subscription_details?.subscription
    if (typeof fromParent === 'string' && fromParent.length > 0) return fromParent
  }
  // Fallback for fixtures and any pre-Basil event still in flight.
  const legacy = invoice.subscription
  if (typeof legacy === 'string' && legacy.length > 0) return legacy
  return null
}
