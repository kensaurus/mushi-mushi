import { describe, expect, it } from 'vitest'
import { buildCursorDeeplink, buildVsCodeDeeplink } from './cursorDeeplink'

describe('cursorDeeplink', () => {
  const projectId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const projectName = 'My Project'
  const apiKey = 'mcp-test-key'
  const apiEndpoint = 'https://example.supabase.co/functions/v1/api'

  it('buildCursorDeeplink base64-encodes config under the Cursor deeplink authority', () => {
    const url = buildCursorDeeplink(projectId, projectName, apiKey, apiEndpoint)
    expect(url).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?/)

    const params = new URLSearchParams(url.split('?')[1]!)
    const config = JSON.parse(atob(decodeURIComponent(params.get('config')!)))
    expect(config.env.MUSHI_API_ENDPOINT).toBe(apiEndpoint)
    expect(config.env.MUSHI_API_KEY).toBe(apiKey)
  })

  it('buildVsCodeDeeplink uses vscode:mcp/install with URL-encoded JSON config', () => {
    const url = buildVsCodeDeeplink(projectId, projectName, apiKey, apiEndpoint)
    expect(url.startsWith('vscode:mcp/install?')).toBe(true)
    expect(url).not.toContain('anysphere.cursor-deeplink')
    expect(url).not.toMatch(/config=[A-Za-z0-9+/=]+/) // not raw base64 in query

    const params = new URLSearchParams(url.slice('vscode:mcp/install?'.length))
    expect(params.get('name')).toBeTruthy()
    const config = JSON.parse(decodeURIComponent(params.get('config')!))
    expect(config.type).toBe('stdio')
    expect(config.env.MUSHI_API_ENDPOINT).toBe(apiEndpoint)
    expect(config.env.MUSHI_API_KEY).toBe(apiKey)
  })
})
