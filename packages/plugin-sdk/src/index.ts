// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * @mushi-mushi/plugin-sdk
 *
 * Public SDK for building third-party Mushi Mushi plugins. Plugins are
 * stand-alone HTTPS services that receive signed event webhooks from the
 * Mushi platform and may optionally call back into the Mushi REST API to
 * mutate reports / fixes.
 *
 * The SDK is intentionally thin: it provides typed event payloads, an HMAC
 * verifier, and small framework adapters (Express, Hono). Plugin authors own
 * the rest of the stack — language, deployment, persistence.
 *
 * Wire format: every webhook is a POST with JSON body and these headers:
 *   X-Mushi-Event:       <event name>            // e.g. report.created
 *   X-Mushi-Signature:   t=<unix-ms>,v1=<hex>     // Stripe-style (legacy)
 *   X-Mushi-Project:     <project_id>            // UUID
 *   X-Mushi-Plugin:      <plugin_slug>           // matches the marketplace listing
 *   X-Mushi-Delivery:    <uuid>                  // unique per delivery, for de-dup
 *   webhook-id:          <uuid>                  // Standard Webhooks: same as X-Mushi-Delivery
 *   webhook-timestamp:   <unix-secs>             // Standard Webhooks: seconds since epoch
 *   webhook-signature:   v1,<base64-hmac>         // Standard Webhooks: signed payload
 *
 * Signature (v1):  HMAC_SHA256(secret, `${t}.${rawBody}`).hex()
 * Standard Webhooks: HMAC_SHA256(secret, `${webhook-id}.${webhook-timestamp}.${rawBody}`).base64()
 * Tolerance is configurable; the default 5-minute window is hard-coded into
 * `verifySignature` / `verifyStandardWebhooksSignature` to discourage replay.
 */

export * from './types.js'
export * from './sign.js'
export * from './handler.js'
export * from './client.js'
export * from './event-schema.js'
export * from './retry.js'
export * from './validate.js'
export * from './retry.js'
