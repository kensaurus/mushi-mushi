import { describe, it, expect } from 'vitest'
import { ENCRYPTED_PREFIX } from '../storage/secure-storage'

describe('secure storage queue format', () => {
  it('uses a versioned encrypted prefix for at-rest queue blobs', () => {
    expect(ENCRYPTED_PREFIX).toBe('mushi_enc_v1:')
  })
})
