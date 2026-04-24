/**
 * FILE: _shared/support.ts
 * PURPOSE: Single source of truth for the support contact address used in:
 *   - Stripe Checkout `custom_text`
 *   - Stripe Billing Portal headline
 *   - The /v1/support/contact endpoint's reply-to header
 *   - The admin BillingPage "Need help?" panel (via /v1/admin/support/info)
 *
 * NOTE: There is no real `*@mushimushi.dev` mailbox — that domain is used
 * for branding/URLs only. The default below is the maintainer's actual
 * inbox. Self-hosters should override with the SUPPORT_EMAIL env var so
 * their tenants don't email the upstream maintainer; we keep a real
 * fallback rather than a placeholder so a forgotten env var still routes
 * mail somewhere a human reads.
 */

const DEFAULT_SUPPORT_EMAIL = 'kensaurus@gmail.com'
const DEFAULT_SUPPORT_URL = 'https://mushimushi.dev/support'

export const SUPPORT_EMAIL =
  (Deno.env.get('SUPPORT_EMAIL') ?? '').trim() || DEFAULT_SUPPORT_EMAIL

export const SUPPORT_URL =
  (Deno.env.get('SUPPORT_URL') ?? '').trim() || DEFAULT_SUPPORT_URL

declare const Deno: { env: { get(name: string): string | undefined } }
