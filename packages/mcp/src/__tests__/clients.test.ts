/**
 * FILE: packages/mcp/src/__tests__/clients.test.ts
 * PURPOSE: Unit tests for the shared MCP client registry builders.
 *
 * OVERVIEW:
 * - Asserts each builder returns the correct `kind`.
 * - Guards Windsurf `serverUrl` (NOT `url`) footgun.
 * - Guards Cursor base64 payload has no `name` at the config root.
 * - Guards VS Code includes `name` as a query param and `type:'stdio'`.
 * - Confirms org-level builds (no projectId) omit MUSHI_PROJECT_ID.
 */

import { describe, it, expect } from 'vitest'
import { MCP_CLIENTS, getMcpClient, projectServerName } from '../clients.js'

const SAMPLE_INPUT = {
  projectId: 'abc123-def456-ghi789',
  projectName: 'My App',
  apiKey: 'mushi_key_test',
  endpoint: 'https://test.supabase.co/functions/v1/api',
  mcpHttpUrl: 'https://test.supabase.co/functions/v1/api/v1/mcp',
}

const ORG_INPUT = {
  projectName: 'My Org',
  apiKey: 'mushi_key_org',
  endpoint: 'https://test.supabase.co/functions/v1/api',
  mcpHttpUrl: 'https://test.supabase.co/functions/v1/api/v1/mcp',
}

describe('MCP_CLIENTS registry', () => {
  it('exports exactly 9 clients', () => {
    expect(MCP_CLIENTS).toHaveLength(9)
  })

  it('has no duplicate ids', () => {
    const ids = MCP_CLIENTS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getMcpClient throws for unknown id', () => {
    // @ts-expect-error — intentional bad id
    expect(() => getMcpClient('nonexistent')).toThrow()
  })
})

describe('projectServerName', () => {
  it('builds a stable slug', () => {
    const name = projectServerName('abc123-def456', 'My Cool App')
    // idSuffix = 'abc123def456'.replace(/-/g,'').slice(0,6) = 'abc123'
    expect(name).toBe('mushi-my-cool-app-abc123')
  })

  it('strips leading/trailing dashes from name part', () => {
    const name = projectServerName('id', '---app---')
    expect(name).not.toMatch(/mushi--/)
  })
})

describe('Cursor builder', () => {
  it('returns kind:deeplink', () => {
    const cursor = getMcpClient('cursor')
    const result = cursor.build(SAMPLE_INPUT)
    expect(result.kind).toBe('deeplink')
  })

  it('deeplink starts with cursor://', () => {
    const cursor = getMcpClient('cursor')
    const result = cursor.build(SAMPLE_INPUT)
    expect(result.kind).toBe('deeplink')
    if (result.kind === 'deeplink') {
      expect(result.url).toMatch(/^cursor:\/\//)
    }
  })

  it('config payload (base64 decoded) has no top-level `name` key', () => {
    const cursor = getMcpClient('cursor')
    const result = cursor.build(SAMPLE_INPUT)
    if (result.kind !== 'deeplink') throw new Error('expected deeplink')
    const url = new URL(result.url)
    const encoded = url.searchParams.get('config') ?? ''
    const decoded = JSON.parse(atob(encoded)) as Record<string, unknown>
    expect('name' in decoded).toBe(false)
  })

  it('config payload includes MUSHI_API_KEY env var', () => {
    const cursor = getMcpClient('cursor')
    const result = cursor.build(SAMPLE_INPUT)
    if (result.kind !== 'deeplink') throw new Error('expected deeplink')
    const url = new URL(result.url)
    const encoded = url.searchParams.get('config') ?? ''
    const decoded = JSON.parse(atob(encoded)) as { env?: Record<string, string> }
    expect(decoded.env?.MUSHI_API_KEY).toBe(SAMPLE_INPUT.apiKey)
  })

  it('omits MUSHI_PROJECT_ID when projectId not given', () => {
    const cursor = getMcpClient('cursor')
    const result = cursor.build(ORG_INPUT)
    if (result.kind !== 'deeplink') throw new Error('expected deeplink')
    const url = new URL(result.url)
    const encoded = url.searchParams.get('config') ?? ''
    const decoded = JSON.parse(atob(encoded)) as { env?: Record<string, string> }
    expect(decoded.env?.MUSHI_PROJECT_ID).toBeUndefined()
  })
})

describe('VS Code builder', () => {
  it('returns kind:deeplink starting with vscode:', () => {
    const vscode = getMcpClient('vscode')
    const result = vscode.build(SAMPLE_INPUT)
    expect(result.kind).toBe('deeplink')
    if (result.kind === 'deeplink') {
      expect(result.url).toMatch(/^vscode:/)
    }
  })

  it('config includes type:stdio', () => {
    const vscode = getMcpClient('vscode')
    const result = vscode.build(SAMPLE_INPUT)
    if (result.kind !== 'deeplink') throw new Error('expected deeplink')
    const url = new URL(result.url.replace('vscode:', 'https://vscode'))
    const configStr = url.searchParams.get('config') ?? ''
    const config = JSON.parse(decodeURIComponent(configStr)) as { type?: string }
    expect(config.type).toBe('stdio')
  })

  it('name is a separate query param (not inside config)', () => {
    const vscode = getMcpClient('vscode')
    const result = vscode.build(SAMPLE_INPUT)
    if (result.kind !== 'deeplink') throw new Error('expected deeplink')
    const url = new URL(result.url.replace('vscode:', 'https://vscode'))
    expect(url.searchParams.has('name')).toBe(true)
  })
})

describe('VS Code Insiders builder', () => {
  it('deeplink starts with vscode-insiders:', () => {
    const insiders = getMcpClient('vscode-insiders')
    const result = insiders.build(SAMPLE_INPUT)
    expect(result.kind).toBe('deeplink')
    if (result.kind === 'deeplink') {
      expect(result.url).toMatch(/^vscode-insiders:/)
    }
  })
})

describe('Windsurf builder', () => {
  it('returns kind:config', () => {
    const windsurf = getMcpClient('windsurf')
    const result = windsurf.build(SAMPLE_INPUT)
    expect(result.kind).toBe('config')
  })

  it('uses serverUrl (not url) in config — critical footgun guard', () => {
    const windsurf = getMcpClient('windsurf')
    const result = windsurf.build(SAMPLE_INPUT)
    if (result.kind !== 'config') throw new Error('expected config')
    const parsed = JSON.parse(result.json) as {
      mcpServers: Record<string, Record<string, unknown>>
    }
    const serverKey = Object.keys(parsed.mcpServers)[0]!
    const serverEntry = parsed.mcpServers[serverKey]!
    expect('serverUrl' in serverEntry).toBe(true)
    expect('url' in serverEntry).toBe(false)
  })

  it('filePath points to ~/.codeium/windsurf/mcp_config.json', () => {
    const windsurf = getMcpClient('windsurf')
    const result = windsurf.build(SAMPLE_INPUT)
    if (result.kind !== 'config') throw new Error('expected config')
    expect(result.filePath).toContain('.codeium/windsurf/mcp_config.json')
  })
})

describe('Cline builder', () => {
  it('returns kind:config with mcpServers key', () => {
    const cline = getMcpClient('cline')
    const result = cline.build(SAMPLE_INPUT)
    if (result.kind !== 'config') throw new Error('expected config')
    const parsed = JSON.parse(result.json) as { mcpServers?: unknown }
    expect(parsed.mcpServers).toBeDefined()
  })
})

describe('Claude Code builder', () => {
  it('returns kind:command', () => {
    const cc = getMcpClient('claude-code')
    const result = cc.build(SAMPLE_INPUT)
    expect(result.kind).toBe('command')
  })

  it('command includes --transport http', () => {
    const cc = getMcpClient('claude-code')
    const result = cc.build(SAMPLE_INPUT)
    if (result.kind !== 'command') throw new Error('expected command')
    expect(result.text).toContain('--transport http')
  })

  it('command includes the api key', () => {
    const cc = getMcpClient('claude-code')
    const result = cc.build(SAMPLE_INPUT)
    if (result.kind !== 'command') throw new Error('expected command')
    expect(result.text).toContain(SAMPLE_INPUT.apiKey)
  })
})

describe('Claude Desktop builder', () => {
  it('returns kind:config with mcpServers key', () => {
    const cd = getMcpClient('claude-desktop')
    const result = cd.build(SAMPLE_INPUT)
    if (result.kind !== 'config') throw new Error('expected config')
    const parsed = JSON.parse(result.json) as { mcpServers?: unknown }
    expect(parsed.mcpServers).toBeDefined()
  })
})

describe('Zed builder', () => {
  it('returns kind:config', () => {
    const zed = getMcpClient('zed')
    const result = zed.build(SAMPLE_INPUT)
    expect(result.kind).toBe('config')
  })

  it('uses context_servers key (Zed format)', () => {
    const zed = getMcpClient('zed')
    const result = zed.build(SAMPLE_INPUT)
    if (result.kind !== 'config') throw new Error('expected config')
    const parsed = JSON.parse(result.json) as { context_servers?: unknown }
    expect(parsed.context_servers).toBeDefined()
  })

  it('command uses path (not command) key', () => {
    const zed = getMcpClient('zed')
    const result = zed.build(SAMPLE_INPUT)
    if (result.kind !== 'config') throw new Error('expected config')
    const parsed = JSON.parse(result.json) as {
      context_servers: Record<string, { command?: { path?: string } }>
    }
    const server = Object.values(parsed.context_servers)[0]!
    expect(server.command?.path).toBe('npx')
  })
})

describe('Any MCP client builder', () => {
  it('returns kind:remote-url', () => {
    const any = getMcpClient('any')
    const result = any.build(SAMPLE_INPUT)
    expect(result.kind).toBe('remote-url')
  })

  it('includes Authorization header snippet', () => {
    const any = getMcpClient('any')
    const result = any.build(SAMPLE_INPUT)
    if (result.kind !== 'remote-url') throw new Error('expected remote-url')
    expect(result.headerSnippet).toContain('Authorization: Bearer')
    expect(result.headerSnippet).toContain(SAMPLE_INPUT.apiKey)
  })
})
