import { describe, expect, it } from 'vitest'
import { resolveLoginEndpoint } from './setup.js'

describe('resolveLoginEndpoint', () => {
  it('prefers an explicit --endpoint flag over everything else', () => {
    expect(resolveLoginEndpoint('https://flag.example', 'https://config.example', 'https://env.example')).toBe(
      'https://flag.example',
    )
  })

  it('falls back to a pre-configured self-hosted endpoint when no flag is passed', () => {
    expect(resolveLoginEndpoint(undefined, 'https://config.example', 'https://env.example')).toBe(
      'https://config.example',
    )
  })

  it('falls back to MUSHI_API_ENDPOINT when there is no flag or existing config', () => {
    expect(resolveLoginEndpoint(undefined, undefined, 'https://env.example')).toBe('https://env.example')
  })

  it('trims whitespace from MUSHI_API_ENDPOINT', () => {
    expect(resolveLoginEndpoint(undefined, undefined, '  https://env.example  ')).toBe('https://env.example')
  })

  it('returns undefined when nothing is set, letting runLogin use the default cloud endpoint', () => {
    expect(resolveLoginEndpoint(undefined, undefined, undefined)).toBeUndefined()
  })
})
