/**
 * FILE: sentry-webhook-verify.ts
 * PURPOSE: Verify one inbound Sentry integration-platform webhook delivery
 *          before the route touches its payload.
 *
 * Sentry sends four headers with every integration-platform webhook
 * (docs.sentry.io/organization/integrations/integration-platform/webhooks/):
 *   - `Sentry-Hook-Signature`  HMAC-SHA256 hex of the raw body, keyed by the
 *                              integration's client secret
 *   - `Request-ID`             unique per delivery
 *   - `Sentry-Hook-Timestamp`  unix time the delivery was sent
 *   - `Sentry-Hook-Resource`   issue | event_alert | …
 *
 * Checks, in order: secret configured → signature present → signature valid
 * → timestamp fresh → not a delivery we already accepted (by Request-ID or by
 * the signed body). Only the body is covered by the signature, so the body
 * hash is the replay key a caller cannot rotate; Request-ID is the cheap one.
 *
 * Pure apart from the injected `isReplay` lookup, so vitest covers every
 * branch without a Hono harness or a database.
 */

/** How far a delivery's timestamp may drift from our clock, either way. */
export const SENTRY_HOOK_MAX_SKEW_SEC = 300;

export interface SentryHookHeaders {
  signature: string | null;
  requestId: string | null;
  timestamp: string | null;
}

/** Read the delivery headers. `X-Sentry-Hook-Signature` stays accepted for
 *  hand-signed test deliveries that used that name. */
export function readSentryHookHeaders(get: (name: string) => string | undefined): SentryHookHeaders {
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    signature: clean(get('Sentry-Hook-Signature')) ?? clean(get('X-Sentry-Hook-Signature')),
    requestId: clean(get('Request-ID')),
    timestamp: clean(get('Sentry-Hook-Timestamp')),
  };
}

/** Parse `Sentry-Hook-Timestamp` to epoch ms. Sentry sends whole seconds; a
 *  13-digit value is treated as ms. Returns null when it is not a number. */
export function parseSentryHookTimestamp(raw: string | null): number | null {
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1e12 ? Math.round(n) : Math.round(n * 1000);
}

export async function sentryHmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256HexOf(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string compare (length difference folded into the result). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0, n = Math.max(a.length, b.length); i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type SentryDeliveryVerdict =
  | { ok: true; requestId: string | null; bodyHash: string }
  | {
      ok: false;
      status: 401 | 403 | 409;
      code:
        | 'NO_SECRET'
        | 'MISSING_SIGNATURE'
        | 'INVALID_SIGNATURE'
        | 'MISSING_TIMESTAMP'
        | 'STALE_TIMESTAMP'
        | 'DUPLICATE';
      auditOutcome: 'error' | 'rejected_signature' | 'rejected_replay';
      message: string;
    };

export async function verifySentryDelivery(
  input: {
    headers: SentryHookHeaders;
    body: string;
    /** The plaintext secret, already read out of Vault. Null = not configured
     *  or unreadable; both reject. */
    secret: string | null;
    nowMs: number;
  },
  deps: {
    /** True when a delivery with this Request-ID or this body hash was
     *  already accepted. */
    isReplay: (key: { requestId: string | null; bodyHash: string }) => Promise<boolean>;
  },
): Promise<SentryDeliveryVerdict> {
  const { headers, body, secret, nowMs } = input;

  if (!secret) {
    return {
      ok: false,
      status: 403,
      code: 'NO_SECRET',
      auditOutcome: 'error',
      message: 'Sentry webhook secret not configured for this project',
    };
  }
  if (!headers.signature) {
    return {
      ok: false,
      status: 401,
      code: 'MISSING_SIGNATURE',
      auditOutcome: 'rejected_signature',
      message: 'Missing signature',
    };
  }
  const expected = await sentryHmacHex(secret, body);
  if (!timingSafeEqualStr(expected, headers.signature.toLowerCase())) {
    return {
      ok: false,
      status: 401,
      code: 'INVALID_SIGNATURE',
      auditOutcome: 'rejected_signature',
      message: 'Invalid signature',
    };
  }

  const sentAt = parseSentryHookTimestamp(headers.timestamp);
  if (sentAt === null) {
    return {
      ok: false,
      status: 401,
      code: 'MISSING_TIMESTAMP',
      auditOutcome: 'rejected_signature',
      message: 'Missing or malformed Sentry-Hook-Timestamp',
    };
  }
  if (Math.abs(nowMs - sentAt) > SENTRY_HOOK_MAX_SKEW_SEC * 1000) {
    return {
      ok: false,
      status: 401,
      code: 'STALE_TIMESTAMP',
      auditOutcome: 'rejected_signature',
      message: `Sentry-Hook-Timestamp outside the ${SENTRY_HOOK_MAX_SKEW_SEC}s window`,
    };
  }

  const bodyHash = await sha256HexOf(body);
  if (await deps.isReplay({ requestId: headers.requestId, bodyHash })) {
    return {
      ok: false,
      status: 409,
      code: 'DUPLICATE',
      auditOutcome: 'rejected_replay',
      message: 'Duplicate delivery',
    };
  }
  return { ok: true, requestId: headers.requestId, bodyHash };
}
