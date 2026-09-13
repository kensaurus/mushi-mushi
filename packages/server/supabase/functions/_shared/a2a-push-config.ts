// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/server/supabase/functions/_shared/a2a-push-config.ts
 * PURPOSE: Parse the A2A push-notification configuration a client sends on
 *          POST /v1/a2a/tasks into the shape stored on
 *          `fix_dispatch_jobs.push_notification_config` (read by
 *          `a2a-push-notify`). Pure so the 1.0-vs-0.3 alias handling has a
 *          unit test; the route just maps the result to a 400 or a row.
 *
 *   A2A 1.0  configuration.taskPushNotificationConfig
 *              { id?, url, token?, authentication?: { scheme, credentials? } }
 *   A2A 0.3  configuration.pushNotificationConfig      (deprecated alias)
 *              { url, token?, authentication?: { schemes: [..], credentials? } }
 *
 * The 1.0 key wins when both are present; `schemes[]` collapses to its first
 * entry as the singular `scheme`. `token` (0.3) is kept verbatim so existing
 * rows and clients keep working — a2a-push-notify sends it as `Bearer`.
 */

import { assertSafeOutboundUrl } from './inventory-guards.ts'

/** Stored on fix_dispatch_jobs.push_notification_config. */
export interface A2APushNotificationConfig {
  url: string
  /** Legacy 0.3 bearer token — kept so existing rows/clients keep working. */
  token?: string
  /** Client-chosen config id (A2A 1.0 `PushNotificationConfig.id`). */
  id?: string
  /** A2A 1.0 `authentication: { scheme, credentials? }` → `Authorization: {scheme} {credentials}`. */
  authentication?: { scheme: string; credentials?: string }
}

export type PushConfigParseResult =
  | { ok: true; config: A2APushNotificationConfig | null; deprecatedAlias: boolean }
  | {
      ok: false
      code: 'INVALID_PUSH_URL' | 'UNSAFE_PUSH_URL' | 'INVALID_PUSH_TOKEN' | 'INVALID_PUSH_AUTH'
      message: string
    }

export const PUSH_TOKEN_MAX = 4096
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/

export function parsePushNotificationConfig(configuration: unknown): PushConfigParseResult {
  const cfg = (configuration ?? {}) as {
    taskPushNotificationConfig?: unknown
    pushNotificationConfig?: unknown
  }
  const deprecatedAlias =
    cfg.taskPushNotificationConfig === undefined && cfg.pushNotificationConfig !== undefined
  const raw = (cfg.taskPushNotificationConfig ?? cfg.pushNotificationConfig) as
    | {
        id?: unknown
        url?: unknown
        token?: unknown
        authentication?: { scheme?: unknown; schemes?: unknown; credentials?: unknown } | null
      }
    | null
    | undefined
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') {
    return { ok: true, config: null, deprecatedAlias: false }
  }
  const field = deprecatedAlias
    ? 'configuration.pushNotificationConfig'
    : 'configuration.taskPushNotificationConfig'

  let parsed: URL | null = null
  try {
    parsed = new URL(raw.url)
  } catch {
    parsed = null
  }
  if (!parsed || parsed.protocol !== 'https:') {
    return { ok: false, code: 'INVALID_PUSH_URL', message: `${field}.url must be a valid https:// URL` }
  }
  const safePushUrl = assertSafeOutboundUrl(parsed.toString(), {})
  if (!safePushUrl.ok) {
    return {
      ok: false,
      code: 'UNSAFE_PUSH_URL',
      message: safePushUrl.reason ?? 'Push notification URL is not allowed',
    }
  }

  const config: A2APushNotificationConfig = { url: parsed.toString() }
  if (typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 256) config.id = raw.id
  if (typeof raw.token === 'string' && raw.token.length > 0) {
    if (raw.token.length > PUSH_TOKEN_MAX) {
      return { ok: false, code: 'INVALID_PUSH_TOKEN', message: `${field}.token exceeds ${PUSH_TOKEN_MAX} chars` }
    }
    config.token = raw.token
  }
  const auth = raw.authentication
  if (auth && typeof auth === 'object') {
    const scheme =
      typeof auth.scheme === 'string' && auth.scheme.length > 0
        ? auth.scheme
        : Array.isArray(auth.schemes) && typeof auth.schemes[0] === 'string'
          ? (auth.schemes[0] as string)
          : null
    if (!scheme) {
      return {
        ok: false,
        code: 'INVALID_PUSH_AUTH',
        message: `${field}.authentication.scheme is required when authentication is set`,
      }
    }
    if (!SCHEME_RE.test(scheme)) {
      return {
        ok: false,
        code: 'INVALID_PUSH_AUTH',
        message: `${field}.authentication.scheme is not a valid HTTP auth scheme`,
      }
    }
    if (auth.credentials !== undefined && auth.credentials !== null) {
      if (typeof auth.credentials !== 'string' || auth.credentials.length > PUSH_TOKEN_MAX) {
        return {
          ok: false,
          code: 'INVALID_PUSH_AUTH',
          message: `${field}.authentication.credentials must be a string ≤ ${PUSH_TOKEN_MAX} chars`,
        }
      }
      config.authentication = { scheme, credentials: auth.credentials }
    } else {
      config.authentication = { scheme }
    }
  }
  return { ok: true, config, deprecatedAlias }
}
