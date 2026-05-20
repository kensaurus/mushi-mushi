import { afterEach, describe, expect, it, vi } from 'vitest'

import { docsUrl, getDocsBase } from './docsUrl'

describe('docsUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses production base when not in dev and no override', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_DOCS_URL', '')
    expect(getDocsBase()).toBe('https://kensaur.us/mushi-mushi/docs')
    expect(docsUrl()).toBe('https://kensaur.us/mushi-mushi/docs/')
    expect(docsUrl('/concepts/architecture')).toBe(
      'https://kensaur.us/mushi-mushi/docs/concepts/architecture',
    )
  })

  it('uses localhost in dev when no override', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_DOCS_URL', '')
    expect(getDocsBase()).toBe('http://localhost:3000')
    expect(docsUrl('/cloud#plans')).toBe('http://localhost:3000/cloud#plans')
  })

  it('honours VITE_DOCS_URL override', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_DOCS_URL', 'http://localhost:3001/')
    expect(getDocsBase()).toBe('http://localhost:3001')
    expect(docsUrl()).toBe('http://localhost:3001/')
  })
})
