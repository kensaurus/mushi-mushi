import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiKeyPlaceholderFor,
  buildHostedMcpServerBlock,
  buildMcpServerBlock,
  buildMcpServerName,
  printKeyExportHint,
  writeMcpServerEntry,
} from './mcp-config.js'
import { MUSHI_MCP_PIN_SPEC } from './version.js'

describe('buildMcpServerName', () => {
  it('uses legacy mushi key when requested', () => {
    expect(buildMcpServerName({ legacy: true })).toBe('mushi')
  })

  it('slugifies project names', () => {
    expect(buildMcpServerName({ projectName: 'My Cool App!' })).toBe('mushi-my-cool-app')
  })

  it('falls back to project id prefix', () => {
    expect(buildMcpServerName({ projectId: 'abcdef12-3456-7890-abcd-ef1234567890' })).toBe('mushi-abcdef12')
  })
})

describe('buildHostedMcpServerBlock', () => {
  it('carries type "http" — Claude Code skips a url entry without it', () => {
    expect(buildHostedMcpServerBlock('https://x.supabase.co/functions/v1/mcp')).toEqual({
      type: 'http',
      url: 'https://x.supabase.co/functions/v1/mcp',
    })
  })
})

describe('apiKeyPlaceholderFor', () => {
  it("uses Cursor's ${env:NAME} form for cursor", () => {
    expect(apiKeyPlaceholderFor('cursor')).toBe('${env:MUSHI_API_KEY}')
  })

  it('uses an empty default for claude so an unset var falls back to the CLI config', () => {
    expect(apiKeyPlaceholderFor('claude')).toBe('${MUSHI_API_KEY:-}')
  })

  it('writes no placeholder for clients with no documented expansion', () => {
    expect(apiKeyPlaceholderFor('continue')).toBeNull()
    expect(apiKeyPlaceholderFor('zed')).toBeNull()
  })
})

describe('buildMcpServerBlock', () => {
  const base = {
    endpoint: 'https://api.example.test',
    projectId: 'proj-1',
    apiKey: 'mushi_live_supersecret',
  }

  it('never writes the literal key by default, whatever the client', () => {
    for (const client of ['cursor', 'claude', 'continue', 'zed'] as const) {
      expect(JSON.stringify(buildMcpServerBlock({ ...base, client }))).not.toContain('mushi_live_supersecret')
    }
  })

  it('writes the client-specific placeholder for cursor and claude', () => {
    expect(buildMcpServerBlock({ ...base, client: 'cursor' }).env.MUSHI_API_KEY).toBe('${env:MUSHI_API_KEY}')
    expect(buildMcpServerBlock({ ...base, client: 'claude' }).env.MUSHI_API_KEY).toBe('${MUSHI_API_KEY:-}')
  })

  it('omits MUSHI_API_KEY for zed and continue so the server reads the saved CLI key', () => {
    expect(buildMcpServerBlock({ ...base, client: 'zed' }).env).not.toHaveProperty('MUSHI_API_KEY')
    expect(buildMcpServerBlock({ ...base, client: 'continue' }).env).not.toHaveProperty('MUSHI_API_KEY')
  })

  it('builds the full canonical npx mcp server block with inlineKey: true', () => {
    expect(buildMcpServerBlock({ ...base, apiKey: 'mushi_test_key', client: 'cursor', inlineKey: true })).toEqual({
      command: 'npx',
      args: ['-y', MUSHI_MCP_PIN_SPEC],
      env: {
        MUSHI_API_ENDPOINT: 'https://api.example.test',
        MUSHI_PROJECT_ID: 'proj-1',
        MUSHI_API_KEY: 'mushi_test_key',
        MUSHI_FEATURES: 'triage,fixes,inventory,setup,docs',
      },
    })
  })

  it('pins the MCP package to an exact version (never @latest)', () => {
    expect(MUSHI_MCP_PIN_SPEC).toMatch(/^@mushi-mushi\/mcp@\d+\.\d+\.\d+/)
    expect(MUSHI_MCP_PIN_SPEC).not.toContain('@latest')
  })
})

describe('printKeyExportHint', () => {
  it('names the CLI config fallback and never prints a key', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    printKeyExportHint('cursor', '/home/dev/.config/mushi/config.json')
    const output = spy.mock.calls.flat().join('\n')
    expect(output).toContain('/home/dev/.config/mushi/config.json')
    expect(output).toContain('MUSHI_API_KEY')
    expect(output).toContain('--inline-key')
    expect(output).not.toMatch(/mushi_[A-Za-z0-9]/)
    spy.mockRestore()
  })
})

describe('writeMcpServerEntry', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function tempConfig(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'mushi-mcp-'))
    dirs.push(dir)
    return join(dir, 'mcp.json')
  }

  it('creates a new mcp.json when missing (placeholder key)', async () => {
    const configPath = await tempConfig()

    const result = await writeMcpServerEntry({
      configPath,
      serverName: 'mushi-demo',
      serverBlock: buildMcpServerBlock({
        endpoint: 'https://api.example.test',
        projectId: 'proj-1',
        apiKey: 'mushi_live_supersecret',
        client: 'cursor',
      }),
    })

    expect(result.created).toBe(true)
    const raw = await readFile(configPath, 'utf8')
    expect(raw).toContain('${env:MUSHI_API_KEY}')
    expect(raw).not.toContain('mushi_live_supersecret')
    const parsed = JSON.parse(raw) as { mcpServers: Record<string, unknown> }
    expect(parsed.mcpServers['mushi-demo']).toBeTruthy()
  })

  it('merges without clobbering other servers or top-level keys', async () => {
    const configPath = await tempConfig()
    await writeFile(
      configPath,
      JSON.stringify({ _comment: 'team servers', mcpServers: { other: { command: 'echo' } } }, null, 2) + '\n',
      'utf8',
    )

    const result = await writeMcpServerEntry({
      configPath,
      serverName: 'mushi-demo',
      serverBlock: buildHostedMcpServerBlock('https://x.supabase.co/functions/v1/mcp'),
    })

    expect(result.created).toBe(false)
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as {
      _comment: string
      mcpServers: Record<string, { command?: string; type?: string; url?: string }>
    }
    expect(parsed._comment).toBe('team servers')
    expect(parsed.mcpServers.other.command).toBe('echo')
    expect(parsed.mcpServers['mushi-demo']).toEqual({ type: 'http', url: 'https://x.supabase.co/functions/v1/mcp' })
  })

  it('refuses to overwrite a file that is not valid JSON', async () => {
    const configPath = await tempConfig()
    const broken = '{ "mcpServers": { "other": { "command": "echo" }, } }'
    await writeFile(configPath, broken, 'utf8')

    await expect(
      writeMcpServerEntry({
        configPath,
        serverName: 'mushi-demo',
        serverBlock: buildHostedMcpServerBlock('https://x.supabase.co/functions/v1/mcp'),
      }),
    ).rejects.toThrow(/not valid JSON/)
    expect(await readFile(configPath, 'utf8')).toBe(broken)
  })

  it('refuses an mcpServers field that is not an object', async () => {
    const configPath = await tempConfig()
    await writeFile(configPath, JSON.stringify({ mcpServers: [] }), 'utf8')

    await expect(
      writeMcpServerEntry({
        configPath,
        serverName: 'mushi-demo',
        serverBlock: buildHostedMcpServerBlock('https://x.supabase.co/functions/v1/mcp'),
      }),
    ).rejects.toThrow(/mcpServers/)
  })

  it('treats an empty file as a fresh config', async () => {
    const configPath = await tempConfig()
    await writeFile(configPath, '', 'utf8')

    await writeMcpServerEntry({
      configPath,
      serverName: 'mushi-demo',
      serverBlock: buildHostedMcpServerBlock('https://x.supabase.co/functions/v1/mcp'),
    })
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(parsed.mcpServers)).toEqual(['mushi-demo'])
  })
})
