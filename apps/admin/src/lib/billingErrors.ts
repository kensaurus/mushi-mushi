/**
 * FILE: apps/admin/src/lib/billingErrors.ts
 * PURPOSE: Plain-English text for billing checkout and portal failures
 *          (suspected-bugs entry 254: the toast read "NO_STRIPE_CUSTOMER").
 *
 * A server message is used when there is one. When the server sent only a
 * code (apiEnvelope then copies the code into `message`), the code is
 * translated here, so a raw code never reaches the user.
 */

const BILLING_ERROR_TEXT: Record<string, string> = {
  NO_STRIPE_CUSTOMER:
    'This project has no billing account yet, so there is nothing to manage. Pick a plan to start one.',
  FORBIDDEN: 'Only the people who own this project can change its billing. Ask an owner to do it.',
  INVALID_BODY: 'The request was missing the project. Reload the page and try again.',
  STRIPE_NOT_CONFIGURED: 'Payments are not set up on this Mushi server yet, so plans cannot be bought here.',
  PLAN_NOT_CONFIGURED: 'That plan is not ready to buy yet. Try another plan, or email support.',
  PLAN_NOT_PURCHASABLE: 'That plan is free, so there is nothing to buy.',
  PLAN_SALES_LED: 'That plan is arranged with our team. Use "Email sales" on the Plans tab.',
  COMPLIMENTARY_ACCOUNT: 'This account is on a free complimentary plan, so there is nothing to pay.',
  ALREADY_SUBSCRIBED:
    'This project already has a paid plan. To switch plans, cancel it in Manage billing, or email support and we will switch it for you.',
  CHECKOUT_UNAVAILABLE: 'Stripe could not open checkout. Nothing was charged. Try again in a minute, or email support.',
  NETWORK_ERROR: 'Mushi could not be reached. Check your connection and try again.',
}

const FALLBACK = 'Something went wrong on our side. Nothing was charged; try again in a moment.'

export function describeBillingError(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? ''
  const message = error?.message?.trim() ?? ''
  const messageIsJustTheCode = message === '' || message === code || /^[A-Z][A-Z0-9_]+$/.test(message)
  if (!messageIsJustTheCode && !/^\d{3}:/.test(message)) return message
  return BILLING_ERROR_TEXT[code] ?? FALLBACK
}
