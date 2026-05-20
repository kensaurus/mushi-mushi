import { afterEach, describe, expect, it, vi } from 'vitest'

// Re-import after each env stub so Vitest picks up the updated import.meta.env
// values. Vitest patches the live import.meta.env object (not compile-time
// replacements), so the module must be re-evaluated after stubbing.

describe('docsUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses production base when not in dev and no override', async () => {
    vi.stubEnv('DEV', 'false')
    vi.stubEnv('VITE_DOCS_URL', '')
    const { getDocsBase, docsUrl } = await import('./docsUrl')
    expect(getDocsBase()).toBe('https://kensaur.us/mushi-mushi/docs')
    expect(docsUrl()).toBe('https://kensaur.us/mushi-mushi/docs/')
    expect(docsUrl('/concepts/architecture')).toBe(
      'https://kensaur.us/mushi-mushi/docs/concepts/architecture',
    )
  })

  it('uses localhost in dev when no override', async () => {
    vi.stubEnv('DEV', 'true')
    vi.stubEnv('VITE_DOCS_URL', '')
    const { getDocsBase, docsUrl } = await import('./docsUrl')
    expect(getDocsBase()).toBe('http://localhost:3000')
    expect(docsUrl('/cloud#plans')).toBe('http://localhost:3000/cloud#plans')
  })

  it('honours VITE_DOCS_URL override regardless of DEV mode', async () => {
    vi.stubEnv('DEV', 'true')
    vi.stubEnv('VITE_DOCS_URL', 'http://localhost:3001/')
    const { getDocsBase, docsUrl } = await import('./docsUrl')
    expect(getDocsBase()).toBe('http://localhost:3001')
    expect(docsUrl()).toBe('http://localhost:3001/')
  })
})
