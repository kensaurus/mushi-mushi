import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  HOSTED_CONSOLE_BASE,
  consoleUrl,
  normalizeConsoleBase,
  resolveConsoleUrlFromEnv,
  resolveConsoleUrlSync,
  projectIdHint,
  apiKeyHint,
  cliSetupDeepLink,
} from './console-url.js'

describe('console-url', () => {
  const originalEnv = process.env['MUSHI_CONSOLE_URL']

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['MUSHI_CONSOLE_URL']
    else process.env['MUSHI_CONSOLE_URL'] = originalEnv
  })

  it('normalizes trailing slashes', () => {
    expect(normalizeConsoleBase('http://localhost:6464/')).toBe('http://localhost:6464')
  })

  it('builds console paths', () => {
    expect(consoleUrl('http://localhost:6464', '/projects')).toBe('http://localhost:6464/projects')
    expect(consoleUrl(HOSTED_CONSOLE_BASE, 'onboarding?tab=verify')).toBe(
      `${HOSTED_CONSOLE_BASE}/onboarding?tab=verify`,
    )
  })

  it('reads MUSHI_CONSOLE_URL from env', () => {
    process.env['MUSHI_CONSOLE_URL'] = 'http://localhost:6464/'
    expect(resolveConsoleUrlFromEnv()).toBe('http://localhost:6464')
  })

  it('resolveConsoleUrlSync falls back to hosted when not in monorepo', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/some-other-app')
    expect(resolveConsoleUrlSync()).toBe(HOSTED_CONSOLE_BASE)
    vi.restoreAllMocks()
  })

  it('projectIdHint points at projects page', () => {
    const hint = projectIdHint('http://localhost:6464')
    expect(hint).toContain('http://localhost:6464/projects')
    expect(hint).toContain('UUID')
  })

  it('apiKeyHint points at verify tab, not settings', () => {
    const hint = apiKeyHint(HOSTED_CONSOLE_BASE)
    expect(hint).toContain('/onboarding?tab=verify')
    expect(hint).toContain('report:write')
    expect(hint).not.toContain('/settings')
  })

  it('cliSetupDeepLink includes setup=cli', () => {
    expect(cliSetupDeepLink('http://localhost:6464')).toBe(
      'http://localhost:6464/onboarding?tab=steps&setup=cli',
    )
  })
})
