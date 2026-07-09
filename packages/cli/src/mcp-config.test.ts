import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildMcpServerBlock,
  buildMcpServerName,
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

describe('buildMcpServerBlock', () => {
  it('builds the canonical npx mcp server block', () => {
    expect(buildMcpServerBlock({
      endpoint: 'https://api.example.test',
      projectId: 'proj-1',
      apiKey: 'mushi_test_key',
    })).toEqual({
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

describe('writeMcpServerEntry', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('creates a new mcp.json when missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mushi-mcp-'))
    dirs.push(dir)
    const configPath = join(dir, 'mcp.json')

    const result = await writeMcpServerEntry({
      configPath,
      serverName: 'mushi-demo',
      serverBlock: buildMcpServerBlock({
        endpoint: 'https://api.example.test',
        projectId: 'proj-1',
        apiKey: 'mushi_test_key',
      }),
    })

    expect(result.created).toBe(true)
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(parsed.mcpServers['mushi-demo']).toBeTruthy()
  })

  it('merges without clobbering other servers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mushi-mcp-'))
    dirs.push(dir)
    const configPath = join(dir, 'mcp.json')
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { other: { command: 'echo' } } }, null, 2) + '\n',
      'utf8',
    )

    await writeMcpServerEntry({
      configPath,
      serverName: 'mushi-demo',
      serverBlock: buildMcpServerBlock({
        endpoint: 'https://api.example.test',
        projectId: 'proj-1',
        apiKey: 'mushi_test_key',
      }),
    })

    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as {
      mcpServers: Record<string, { command: string }>
    }
    expect(parsed.mcpServers.other.command).toBe('echo')
    expect(parsed.mcpServers['mushi-demo'].command).toBe('npx')
  })
})
