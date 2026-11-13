import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// `mushi-mushi/eslint` bundles the (now private) eslint-plugin-mushi-mushi.
// Read the built files the way a consumer resolves the subpath.
const dist = (file: string) => new URL(`../dist/${file}`, import.meta.url)

type Plugin = {
  meta: { name: string }
  rules: Record<string, unknown>
  configs: Record<string, { plugins?: Record<string, unknown>; rules: Record<string, unknown> }>
}

describe('mushi-mushi/eslint', () => {
  it('exports the plugin as default and recommended from the same object (ESM)', async () => {
    const mod = (await import(dist('eslint.js').href)) as { default: Plugin; recommended: unknown }
    expect(Object.keys(mod.default.rules)).toEqual(expect.arrayContaining(['no-dead-handler', 'no-mock-leak']))
    expect(mod.recommended).toBe(mod.default.configs.recommended)
    // One plugin instance: the preset registers the default export itself, so
    // a config using both never hits "Cannot redefine plugin".
    expect(mod.default.configs.recommended.plugins?.['mushi-mushi']).toBe(mod.default)
    expect(Object.keys(mod.default.configs.recommended.rules)).toEqual([
      'mushi-mushi/no-dead-handler',
      'mushi-mushi/no-mock-leak',
      'mushi-mushi/no-allowlist-jsx-textnode',
    ])
  })

  it('works from CommonJS', () => {
    const require = createRequire(import.meta.url)
    const mod = require(fileURLToPath(dist('eslint.cjs'))) as {
      default: Plugin
      recommended: unknown
    }
    expect(mod.recommended).toBe(mod.default.configs.recommended)
  })

  it('bundles the plugin instead of importing it (it is no longer published)', () => {
    for (const file of ['eslint.js', 'eslint.cjs', 'eslint.d.ts', 'eslint.d.cts']) {
      expect(readFileSync(dist(file), 'utf-8')).not.toMatch(/from ['"]eslint-plugin-mushi-mushi|require\(['"]eslint-plugin-mushi-mushi/)
    }
  })
})
