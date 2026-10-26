/**
 * FILE: apps/admin/src/lib/secretFieldMeta.test.ts
 * PURPOSE: The auth-token chip must say Saved for a vault ref, never the ref tail.
 */

import { describe, expect, it } from 'vitest'
import { normalizeSecretHint } from './secretFieldMeta'

describe('normalizeSecretHint', () => {
  it('shows Saved for a vault ref or the old ref-name tail', () => {
    const ref = 'vault://mushi/integration/11111111-2222-4333-8444-555555555555/sentry/sentry_auth_token_ref'
    expect(normalizeSecretHint(ref, 'sentry_auth_token_ref')).toBe('Saved')
    expect(normalizeSecretHint('…_ref', 'sentry_auth_token_ref')).toBe('Saved')
    expect(normalizeSecretHint('Saved', 'sentry_auth_token_ref')).toBe('Saved')
  })

  it('keeps a real key hint', () => {
    expect(normalizeSecretHint('…ab12', 'sentry_auth_token_ref')).toBe('…ab12')
    expect(normalizeSecretHint('sntrys_live_token_value', 'sentry_auth_token_ref')).toBe('sntr…alue')
  })
})
