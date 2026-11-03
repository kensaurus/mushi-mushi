import { describe, expect, it } from 'vitest'
import { cleanLlmModel } from '../../supabase/functions/_shared/pending-fix.ts'

describe('cleanLlmModel', () => {
  it('keeps a local Cursor model id and drops anything that is not one', () => {
    expect(cleanLlmModel('composer-2.5')).toBe('composer-2.5')
    expect(cleanLlmModel(' claude-sonnet-4 ')).toBe('claude-sonnet-4')
    expect(cleanLlmModel('composer 2')).toBeNull()
    expect(cleanLlmModel('')).toBeNull()
    expect(cleanLlmModel(null)).toBeNull()
  })
})
