/**
 * FILE: apps/admin/src/components/rewards/WebhookSecretReveal.tsx
 * PURPOSE: One-time reveal of a reward webhook's signing secret.
 *
 *   POST /v1/admin/rewards/webhooks mints a `mushi_whk_…` secret when the
 *   operator leaves the field blank, stores it in Vault and returns it once in
 *   `meta.secret`. It can never be read back, so this panel is the only chance
 *   to copy it.
 *
 * SECURITY: the secret lives only in the parent's React state. It is never
 *   logged, never written to storage, and is dropped on dismiss or unmount.
 *   The value sits under [data-auth-token], which the console's self-reporting
 *   SDK blocks from screenshots.
 */

import { Btn, Callout, CodeValue } from '../ui'

export interface RevealedWebhookSecret {
  url: string
  secret: string
  /** False when the Vault write failed and the env-var fallback is needed. */
  vaulted: boolean
  /** Server instruction that goes with the secret (Vault fallback steps). */
  message: string | null
}

/** Reads the one-time secret out of a create-webhook response's `meta`. */
export function revealedSecretFromMeta(
  url: string,
  meta: Record<string, unknown> | undefined,
): RevealedWebhookSecret | null {
  const secret = meta?.secret
  if (typeof secret !== 'string' || secret.length === 0) return null
  return {
    url,
    secret,
    vaulted: meta?.vaulted !== false,
    message: typeof meta?.message === 'string' ? meta.message : null,
  }
}

export function WebhookSecretReveal({
  revealed,
  onDismiss,
}: {
  revealed: RevealedWebhookSecret
  onDismiss: () => void
}) {
  return (
    <div
      className="mb-3 space-y-2 rounded-md border border-warn/40 bg-warn/5 p-3"
      data-testid="reward-webhook-secret-reveal"
    >
      <Callout tone="warn" label="Copy this signing secret now — you won't see it again">
        <p className="text-2xs text-fg-secondary leading-snug">
          Set it as <code className="font-mono">MUSHI_REWARD_WEBHOOK_SECRET</code> on the server behind{' '}
          <span className="font-mono wrap-anywhere">{revealed.url}</span>, then verify the{' '}
          <code className="font-mono">X-Mushi-Signature</code> header with{' '}
          <code className="font-mono">createMushiRewardsHandler</code> from{' '}
          <code className="font-mono">@mushi-mushi/node</code>. If you lose it, delete this webhook and add it again.
        </p>
      </Callout>
      {/* data-auth-token: the console's own Mushi SDK blocks this element from
          bug-report screenshots (lib/mushi-self.ts privacy.blockSelectors). */}
      <div data-auth-token="">
        <CodeValue value={revealed.secret} copyable multiline />
      </div>
      {!revealed.vaulted && revealed.message && (
        <Callout tone="danger" label="Extra step needed">
          <p className="text-2xs text-fg-secondary leading-snug wrap-anywhere">{revealed.message}</p>
        </Callout>
      )}
      <div className="flex justify-end">
        <Btn variant="cancel" size="sm" onClick={onDismiss}>
          I've stored it — hide
        </Btn>
      </div>
    </div>
  )
}
