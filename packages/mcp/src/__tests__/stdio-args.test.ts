import { describe, expect, it } from 'vitest'
import { stdioArgsAction, stdioUsage } from '../stdio-args.js'

describe('stdioArgsAction', () => {
  it('answers --help and -h instead of starting the server', () => {
    expect(stdioArgsAction(['--help'])).toBe('help')
    expect(stdioArgsAction(['-h'])).toBe('help')
    expect(stdioArgsAction(['--stdio', '--help'])).toBe('help')
  })

  it('answers --version and -v', () => {
    expect(stdioArgsAction(['--version'])).toBe('version')
    expect(stdioArgsAction(['-v'])).toBe('version')
  })

  it('help wins over version', () => {
    expect(stdioArgsAction(['-v', '-h'])).toBe('help')
  })

  it('serves with no args, and ignores unknown args as before', () => {
    expect(stdioArgsAction([])).toBe('serve')
    expect(stdioArgsAction(['--stdio'])).toBe('serve')
  })
})

describe('stdioUsage', () => {
  it('names the version, the env vars and the setup command', () => {
    const usage = stdioUsage('9.9.9')
    expect(usage).toContain('@mushi-mushi/mcp 9.9.9')
    for (const name of ['MUSHI_API_KEY', 'MUSHI_PROJECT_ID', 'MUSHI_API_ENDPOINT', 'MUSHI_FEATURES']) {
      expect(usage).toContain(name)
    }
    expect(usage).toContain('npx mushi-mushi setup --ide cursor')
  })
})
