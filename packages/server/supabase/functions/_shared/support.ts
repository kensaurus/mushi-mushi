/**
 * FILE: _shared/support.ts
 * PURPOSE: Single source of truth for the support contact address used in:
 *   - Stripe Checkout `custom_text`
 *   - Stripe Billing Portal headline
 *   - The /v1/support/contact endpoint's reply-to header
 *   - The admin BillingPage "Need help?" panel (via /v1/admin/support/info)
 *
 * Override with SUPPORT_EMAIL env var (required for self-hosters who don't
 * want to expose mushimushi.dev to their tenants).
 */

const DEFAULT_SUPPORT_EMAIL = 'support@mushimushi.dev'
const DEFAULT_SUPPORT_URL = 'https://mushimushi.dev/support'

export const SUPPORT_EMAIL =
  (Deno.env.get('SUPPORT_EMAIL') ?? '').trim() || DEFAULT_SUPPORT_EMAIL

export const SUPPORT_URL =
  (Deno.env.get('SUPPORT_URL') ?? '').trim() || DEFAULT_SUPPORT_URL

declare const Deno: { env: { get(name: string): string | undefined } }
