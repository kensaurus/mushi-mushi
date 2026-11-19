/**
 * FILE: instance-mode.test.ts
 * PURPOSE: GET /health reports `mode` so the console sidebar can say
 *          "Hosted" or "Self-hosted" from the server, not from its own build.
 */
import { describe, expect, it } from 'vitest'
import { CLOUD_PROJECT_REF, instanceModeFrom } from '../../supabase/functions/_shared/instance-mode.ts'

describe('instanceModeFrom', () => {
  it('reads Mushi Cloud from its Supabase URL', () => {
    expect(instanceModeFrom(undefined, `https://${CLOUD_PROJECT_REF}.supabase.co`)).toBe('hosted')
  })

  it('treats any other backend as self-hosted', () => {
    expect(instanceModeFrom(undefined, 'https://abcd.supabase.co')).toBe('self-hosted')
    expect(instanceModeFrom(undefined, 'http://kong:8000')).toBe('self-hosted')
    expect(instanceModeFrom(undefined, undefined)).toBe('self-hosted')
  })

  it('lets MUSHI_INSTANCE_MODE override the URL guess', () => {
    expect(instanceModeFrom('self-hosted', `https://${CLOUD_PROJECT_REF}.supabase.co`)).toBe('self-hosted')
    expect(instanceModeFrom('hosted', 'http://kong:8000')).toBe('hosted')
    expect(instanceModeFrom(' Cloud ', 'http://kong:8000')).toBe('hosted')
  })

  it('ignores an unknown override and falls back to the URL', () => {
    expect(instanceModeFrom('banana', `https://${CLOUD_PROJECT_REF}.supabase.co`)).toBe('hosted')
  })
})
