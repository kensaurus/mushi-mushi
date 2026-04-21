import type { MushiCaptureEventInput } from '@mushi-mushi/core'

/**
 * Wave G4 — adapter contract.
 *
 * Every adapter exports:
 *   - `translate(raw)` — pure mapper from the source's event shape to
 *     `MushiCaptureEventInput`. Keeps side-effect-free for unit testing.
 *   - `createWebhookHandler(deps)` — ingress that verifies the source's
 *     signature, calls `translate`, and forwards to Mushi via the
 *     capture sink injected by the caller (usually `Mushi.captureEvent`
 *     or `MushiNodeClient.captureReport`).
 */
export type MushiCaptureSink = (input: MushiCaptureEventInput) => Promise<string | null | void>

export interface WebhookResponse {
  status: number
  body: unknown
}
