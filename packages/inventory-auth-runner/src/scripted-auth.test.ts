/**
 * Mushi report 1a4bd5c8: the runner read `parsed.auth`, but the inventory
 * schema nests the block under `app.auth`, so every real inventory.yaml
 * read as "no auth.scripted block". This test parses a real inventory.yaml
 * with @mushi-mushi/inventory-schema (the shape the server stores) and
 * loads it through the runner the way `refresh` does.
 */
import { readFileSync } from 'node:fs'
import { parseInventory } from '@mushi-mushi/inventory-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __test } from './index.js'

const yaml = readFileSync(new URL('./__fixtures__/inventory.yaml', import.meta.url), 'utf8')
const opts = { apiEndpoint: 'https://api.test', apiKey: 'k', projectId: 'p1' }

function serveSnapshot(parsed: unknown): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    ok: true,
    data: { snapshot: { parsed }, summary: {}, updatedAt: null },
  })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('scripted auth from a real inventory.yaml', () => {
  it('finds the app.auth scripted block the schema produces', async () => {
    const parsed = parseInventory(yaml)
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true)
    serveSnapshot(parsed.inventory)
    const auth = __test.scriptedAuthOf(await __test.loadInventory(opts))
    expect(auth.type).toBe('scripted')
    expect(auth.config.login_path).toBe('/login')
    expect(auth.config.script).toContain("page.click('[data-testid=login]')")
  })

  it('says plainly when the inventory has no scripted app.auth', async () => {
    const parsed = parseInventory(yaml.replace(/ {2}auth:[\s\S]*?(?=pages:)/, ''))
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true)
    expect(() => __test.scriptedAuthOf({ parsed: parsed.inventory } as never)).toThrow(/no `app.auth` block of type `scripted`/)
  })
})
