/**
 * get_widget_settings / set_widget_settings: the console's widget editor over
 * MCP. Both call the console's route (GET|PUT …/sdk-config); the write returns
 * what changed so an agent can tell the user what it did.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'
import { TOOL_CATALOG } from '../catalog.js'
import { TOOL_FEATURE_MAP } from '../feature-groups.js'
import { changedWidgetKeys, widgetSettingsBody, widgetSettingsView } from '../widget-settings.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'TEST-FIXTURE-NOT-A-REAL-SECRET'
const PROJECT_ID = '1000000a-0000-4000-8000-000000000000'
const PATH = `/v1/admin/projects/${PROJECT_ID}/sdk-config`

interface Call { url: string; method: string; body: unknown }

describe('widget settings helpers', () => {
  it('builds a body from only the fields sent; auto and "" clear', () => {
    expect(widgetSettingsBody({ accent: '#3B5BDB', position: 'bottom-left' })).toEqual({ widget: { accent: '#3B5BDB', position: 'bottom-left' } })
    expect(widgetSettingsBody({ accent: 'auto', triggerText: '  ' })).toEqual({ widget: { accent: null, triggerText: null } })
    expect(widgetSettingsBody({})).toEqual({ widget: {} })
  })

  it('fills the defaults so an unset key reads as what the widget shows', () => {
    expect(widgetSettingsView({ projectId: PROJECT_ID, enabled: true, canEdit: true, widget: {} })).toEqual({
      projectId: PROJECT_ID,
      enabled: true,
      canEdit: true,
      widget: { position: 'bottom-right', theme: 'auto', triggerText: null, accent: 'auto', accentText: null, launcher: 'auto' },
    })
  })

  it('lists the keys whose shown value changed', () => {
    const before = widgetSettingsView({ widget: {} })
    const after = widgetSettingsView({ widget: { accent: '#3b5bdb', accentText: '#ffffff' } })
    expect(changedWidgetKeys(before, after)).toEqual(['accent', 'accentText'])
  })
})

describe('widget settings tools', () => {
  let calls: Call[]
  let client: Client
  let saved: Record<string, unknown>

  beforeEach(async () => {
    calls = []
    saved = {}
    const stub = vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ url, method: init?.method ?? 'GET', body })
      if (init?.method === 'PUT') saved = { ...saved, ...(body.widget as Record<string, unknown>), accentText: '#ffffff' }
      return new Response(JSON.stringify({ ok: true, data: { projectId: PROJECT_ID, enabled: true, canEdit: true, widget: saved } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const server = createMushiServer({ version: '0.0.0-test', apiEndpoint: API_ENDPOINT, apiKey: API_KEY, projectId: PROJECT_ID, fetch: stub })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'widget-settings-test', version: '0.0.0' }, { capabilities: {} })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })
  afterEach(async () => {
    await client.close().catch(() => {})
  })

  it('declares read and write scopes in the default setup group', () => {
    const byName = new Map(TOOL_CATALOG.map((t) => [t.name, t]))
    expect(byName.get('get_widget_settings')).toMatchObject({ scope: 'mcp:read', hints: { readOnly: true } })
    expect(byName.get('set_widget_settings')).toMatchObject({ scope: 'mcp:write', hints: { readOnly: false, destructive: false } })
    expect(TOOL_FEATURE_MAP.get_widget_settings).toBe('setup')
    expect(TOOL_FEATURE_MAP.set_widget_settings).toBe('setup')
  })

  it('reads the console route', async () => {
    const res = await client.callTool({ name: 'get_widget_settings', arguments: {} })
    expect(calls.map((c) => [c.method, c.url.replace(API_ENDPOINT, '')])).toEqual([['GET', PATH]])
    expect(JSON.parse((res.content as Array<{ text: string }>)[0]!.text).widget.accent).toBe('auto')
  })

  it('reads, writes, and returns before, after and what changed', async () => {
    const res = await client.callTool({ name: 'set_widget_settings', arguments: { accent: '#3b5bdb', position: 'bottom-left' } })
    expect(calls.map((c) => [c.method, c.url.replace(API_ENDPOINT, '')])).toEqual([['GET', PATH], ['PUT', PATH]])
    expect(calls[1]!.body).toEqual({ widget: { accent: '#3b5bdb', position: 'bottom-left' } })
    const out = JSON.parse((res.content as Array<{ text: string }>)[0]!.text)
    expect(out.before.widget.accent).toBe('auto')
    expect(out.after.widget).toMatchObject({ accent: '#3b5bdb', accentText: '#ffffff', position: 'bottom-left' })
    expect(out.changed).toEqual(['position', 'accent', 'accentText'])
  })

  it('refuses an empty change and a bad enum before calling the api', async () => {
    const empty = await client.callTool({ name: 'set_widget_settings', arguments: {} })
    expect(empty.isError).toBe(true)
    const bad = await client.callTool({ name: 'set_widget_settings', arguments: { position: 'middle' } })
    expect(bad.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
