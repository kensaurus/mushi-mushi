import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSetupServerBlock,
  deriveHostedMcpUrl,
  resolveLoginEndpoint,
  resolveMcpConfigTarget,
} from './setup.js'

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

describe('resolveMcpConfigTarget', () => {
  const cwd = join('/work', 'app')
  const home = join('/home', 'dev')

  it('writes Claude Code servers to .mcp.json at the repo root, never .claude/mcp.json', () => {
    const target = resolveMcpConfigTarget('claude', cwd, home)
    expect(target.path).toBe(join(cwd, '.mcp.json'))
    expect(target.path).not.toContain(join('.claude', 'mcp.json'))
    expect(target).toMatchObject({ format: 'mcp-json', repoLocal: true })
  })

  it('writes Cursor servers to .cursor/mcp.json', () => {
    expect(resolveMcpConfigTarget('cursor', cwd, home).path).toBe(join(cwd, '.cursor', 'mcp.json'))
  })

  it("writes Zed servers to the user's settings, outside the repo", () => {
    expect(resolveMcpConfigTarget('zed', cwd, home)).toMatchObject({
      path: join(home, '.config', 'zed', 'settings.json'),
      format: 'zed',
      repoLocal: false,
    })
  })
})

describe('deriveHostedMcpUrl', () => {
  it('maps the api function to its mcp sibling', () => {
    expect(deriveHostedMcpUrl('https://x.supabase.co/functions/v1/api')).toBe('https://x.supabase.co/functions/v1/mcp')
    expect(deriveHostedMcpUrl('https://x.supabase.co/functions/v1/api/')).toBe('https://x.supabase.co/functions/v1/mcp')
  })

  it('returns null when the endpoint does not end in /api', () => {
    expect(deriveHostedMcpUrl('https://mushi.example.com/v1')).toBeNull()
  })
})

describe('buildSetupServerBlock', () => {
  const base = {
    endpoint: 'https://x.supabase.co/functions/v1/api',
    projectId: 'proj-1',
    apiKey: 'mushi_secret_key_123',
    stdio: false,
    allProjects: false,
    inlineKey: false,
  }

  it('gives Claude Code a typed hosted entry by default', () => {
    expect(buildSetupServerBlock({ ...base, ide: 'claude' })).toEqual({
      block: { type: 'http', url: 'https://x.supabase.co/functions/v1/mcp' },
      hosted: true,
    })
  })

  it('gives Cursor the same typed hosted entry', () => {
    expect(buildSetupServerBlock({ ...base, ide: 'cursor' }).block).toEqual({
      type: 'http',
      url: 'https://x.supabase.co/functions/v1/mcp',
    })
  })

  it('falls back to stdio with a note when no hosted URL can be derived', () => {
    const result = buildSetupServerBlock({ ...base, ide: 'claude', endpoint: 'https://mushi.example.com/v1' })
    expect(result.hosted).toBe(false)
    expect(result.note).toContain('cannot derive the hosted MCP URL')
    expect(result.block).toHaveProperty('command', 'npx')
  })

  it('--stdio writes the client placeholder, never the key', () => {
    const result = buildSetupServerBlock({ ...base, ide: 'claude', stdio: true })
    expect(result.hosted).toBe(false)
    expect(JSON.stringify(result.block)).not.toContain('mushi_secret_key_123')
    expect(result.block).toMatchObject({ env: { MUSHI_API_KEY: '${MUSHI_API_KEY:-}' } })
  })

  it('--inline-key writes the literal key into the stdio entry', () => {
    const result = buildSetupServerBlock({ ...base, ide: 'cursor', stdio: true, inlineKey: true })
    expect(result.block).toMatchObject({ env: { MUSHI_API_KEY: 'mushi_secret_key_123' } })
  })

  it('continue and zed only get stdio entries', () => {
    expect(buildSetupServerBlock({ ...base, ide: 'continue' }).hosted).toBe(false)
    expect(buildSetupServerBlock({ ...base, ide: 'zed' }).hosted).toBe(false)
  })
})
