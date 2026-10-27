/**
 * Mushi report c3ed8b60: `recommended` switched on all 19 rules, including
 * the Mushi console's design-system rules, which fail on any other app.
 * It now holds only the agentic-failure rules; the monorepo keeps the rest
 * through `internal`.
 */
import { describe, expect, it } from 'vitest'
import plugin from './index.js'
import recommendedEntry from './recommended.js'

type Preset = { rules: Record<string, unknown> }
const configs = plugin.configs as Record<string, Preset>

const RECOMMENDED = [
  'mushi-mushi/no-dead-handler',
  'mushi-mushi/no-mock-leak',
  'mushi-mushi/no-allowlist-jsx-textnode',
]

describe('presets', () => {
  it('recommended holds only the agentic-failure rules, as errors', () => {
    expect(configs.recommended.rules).toEqual(Object.fromEntries(RECOMMENDED.map((r) => [r, 'error'])))
  })

  it('legacy and the /recommended entry match recommended', () => {
    expect(configs.legacy.rules).toEqual(configs.recommended.rules)
    expect((recommendedEntry as Preset).rules).toEqual(configs.recommended.rules)
  })

  it('internal turns on every rule the plugin ships', () => {
    const all = Object.keys(plugin.rules).map((r) => `mushi-mushi/${r}`).sort()
    expect(Object.keys(configs.internal.rules).sort()).toEqual(all)
    for (const r of RECOMMENDED) expect(configs.internal.rules[r]).toBe('error')
  })
})
