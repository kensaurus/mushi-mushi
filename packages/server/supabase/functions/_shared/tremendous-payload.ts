/**
 * FILE: packages/server/supabase/functions/_shared/tremendous-payload.ts
 * PURPOSE: What of a Tremendous order or webhook event may be stored in
 *          `tremendous_orders.raw_payload`.
 *
 * Tremendous echoes each reward's recipient (name, email, phone) and its
 * delivery block, which can carry the redeem link — a bearer credential for
 * the gift card. The tester-marketplace tables keep tester email out of
 * Postgres, so only an allowlist of order fields is persisted; anything new
 * Tremendous adds stays out until it is added here on purpose.
 */

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function pick(src: Json, keys: readonly string[]): Json {
  const out: Json = {}
  for (const k of keys) if (k in src) out[k] = src[k]
  return out
}

/** An order with ids, status and amounts only: no recipient, email or link. */
function minimalTremendousOrder(order: unknown): Json | null {
  if (!isObject(order)) return null
  const out = pick(order, ['id', 'external_id', 'status', 'created_at', 'campaign_id'])
  if (isObject(order.payment)) out.payment = pick(order.payment, ['subtotal', 'total', 'fees', 'discount'])
  if (Array.isArray(order.rewards)) {
    out.rewards = order.rewards.filter(isObject).map((r) => ({
      ...pick(r, ['id', 'order_id', 'created_at', 'value', 'products']),
      ...(isObject(r.delivery) ? { delivery: pick(r.delivery, ['method', 'status']) } : {}),
    }))
  }
  return out
}

/** A create-order response (`{ order }`) or a webhook event, reduced for storage. */
export function minimalTremendousPayload(body: unknown): Json {
  if (!isObject(body)) return {}
  const out = pick(body, ['event', 'uuid', 'created_utc'])
  if (isObject(body.payload) && isObject(body.payload.resource)) {
    out.payload = { resource: pick(body.payload.resource, ['id', 'type']) }
  }
  const order = minimalTremendousOrder(body.order)
  if (order) out.order = order
  return out
}

/** Tremendous error text can echo the request, recipient email included. */
export function scrubEmails(text: string): string {
  return text.replace(/[^\s"'<>@,;:()[\]{}]+@[^\s"'<>@,;:()[\]{}]+\.[A-Za-z]{2,}/g, '[email]')
}
