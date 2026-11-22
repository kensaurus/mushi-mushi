/**
 * Two fix agents on 2026-10-09 ran the stdio server with an SDK key
 * (report:write): every read tool answered INSUFFICIENT_SCOPE and
 * diagnose_setup, which needs mcp:read itself, could not say why.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ALL_SCOPES } from '../catalog.js'
import { decideScopes, fetchKeyScopes, sdkKeyReport } from '../key-scopes.js'
import { createSetupModeServer, MUSHI_CONSOLE_URL } from '../server.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('decideScopes', () => {
  it('serves setup mode for an SDK key', () => {
    expect(decideScopes(['report:write'], ALL_SCOPES)).toEqual({ kind: 'sdk-key', keyScopes: ['report:write'] })
    expect(decideScopes([], ALL_SCOPES).kind).toBe('sdk-key')
  })

  it('hides write tools from a read-only key', () => {
    expect(decideScopes(['mcp:read'], ALL_SCOPES)).toEqual({ kind: 'serve', scopes: ['mcp:read'] })
  })

  it('mcp:write implies mcp:read', () => {
    expect(decideScopes(['mcp:write'], ALL_SCOPES)).toEqual({ kind: 'serve', scopes: [...ALL_SCOPES] })
  })

  it('never widens MUSHI_SCOPES', () => {
    expect(decideScopes(['mcp:read', 'mcp:write'], ['mcp:read'])).toEqual({ kind: 'serve', scopes: ['mcp:read'] })
  })

  it('unknown scopes change nothing', () => {
    expect(decideScopes(null, ALL_SCOPES)).toEqual({ kind: 'serve', scopes: ALL_SCOPES })
  })
})

describe('fetchKeyScopes', () => {
  it('reads data.scopes from /v1/sync/whoami with the key', async () => {
    let seen: { url: string; key: string | null } | null = null
    const stub = (async (url: string, init?: RequestInit) => {
      seen = { url, key: new Headers(init?.headers).get('X-Mushi-Api-Key') }
      return json({ ok: true, data: { project_id: 'p', scopes: ['report:write'] } })
    }) as unknown as typeof fetch
    expect(await fetchKeyScopes({ apiEndpoint: 'https://api.test/fn/', apiKey: 'k1', fetch: stub })).toEqual(['report:write'])
    expect(seen).toEqual({ url: 'https://api.test/fn/v1/sync/whoami', key: 'k1' })
  })

  it('is unknown (null), not empty, for an older server, an error or a network failure', async () => {
    const old = (async () => json({ ok: true, data: { project_id: 'p' } })) as unknown as typeof fetch
    const denied = (async () => json({ ok: false }, 401)) as unknown as typeof fetch
    const offline = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    for (const stub of [old, denied, offline]) {
      expect(await fetchKeyScopes({ apiEndpoint: 'https://api.test', apiKey: 'k', fetch: stub })).toBeNull()
    }
  })
})

describe('setup mode for an SDK key', () => {
  let client: Client | null = null
  afterEach(async () => {
    await client?.close()
    client = null
  })

  it('says the key cannot read reports and where to mint one', async () => {
    const report = sdkKeyReport(['report:write'], MUSHI_CONSOLE_URL)
    expect(report).toContain('This API key has scopes: report:write')
    const server = createSetupModeServer({ version: '0.0.0-test', missingKeyReport: report, reason: 'sdk-key' })
    const [ct, st] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'scopes-test', version: '0.0.0' }, { capabilities: {} })
    await Promise.all([server.connect(st), client.connect(ct)])
    expect(client.getInstructions()).toMatch(/SDK key \(report:write\)/)
    const res = (await client.callTool({ name: 'diagnose_setup', arguments: {} })) as { content: Array<{ text: string }> }
    const diagnosis = JSON.parse(res.content[0].text) as { steps: Array<{ label: string; hint: string }>; nextAction: string }
    expect(diagnosis.steps[0].label).toBe('MCP server key can read reports (mcp:read)')
    expect(diagnosis.nextAction).toContain(`${MUSHI_CONSOLE_URL}/mcp`)
  })

  it('gives one copy-paste command with the project, worded for where the key came from', async () => {
    const fromCli = sdkKeyReport(['report:write'], MUSHI_CONSOLE_URL, { projectId: 'p-123', keySource: 'cli-config' })
    expect(fromCli).toContain('npx mushi-mushi login --project-id p-123')
    expect(fromCli).toContain('then restart this server.')
    expect(fromCli).not.toContain('remove MUSHI_API_KEY')

    const fromEnv = sdkKeyReport(['report:write'], MUSHI_CONSOLE_URL, { keySource: 'env' })
    expect(fromEnv).toContain('npx mushi-mushi login\n')
    expect(fromEnv).toContain("remove MUSHI_API_KEY from this server's env block")

    const server = createSetupModeServer({
      version: '0.0.0-test',
      missingKeyReport: fromCli,
      reason: 'sdk-key',
      sdkKeyFix: { projectId: 'p-123', keySource: 'cli-config' },
    })
    const [ct, st] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'scopes-test', version: '0.0.0' }, { capabilities: {} })
    await Promise.all([server.connect(st), client.connect(ct)])
    expect(client.getInstructions()).toContain('npx mushi-mushi login --project-id p-123')
    const res = (await client.callTool({ name: 'diagnose_setup', arguments: {} })) as { content: Array<{ text: string }> }
    const diagnosis = JSON.parse(res.content[0].text) as { nextAction: string }
    expect(diagnosis.nextAction).toContain('`npx mushi-mushi login --project-id p-123`')
    expect(diagnosis.nextAction).toContain(`${MUSHI_CONSOLE_URL}/mcp`)
  })
})
