/**
 * FILE: packages/mcp/src/__tests__/feature-groups.test.ts
 * PURPOSE: The feature map decides what a lean install sees. An unmapped
 *          name used to match every filter, which put all 11 deprecated
 *          aliases on the hosted default surface; it now matches none, so
 *          every registered tool must be mapped or it silently disappears.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_CATALOG, TDD_TOOL_CATALOG, CODEBASE_TOOL_CATALOG } from '../catalog.js'
import {
  DEFAULT_FEATURE_GROUPS,
  DEPRECATED_TOOL_ALIASES,
  FEATURE_GROUPS,
  PRESET_TOOLS,
  TOOL_FEATURE_MAP,
  parseFeaturesParam,
  toolMatchesFeatures,
} from '../feature-groups.js'

const ALL_TOOLS = [...TOOL_CATALOG, ...TDD_TOOL_CATALOG, ...CODEBASE_TOOL_CATALOG]

describe('TOOL_FEATURE_MAP', () => {
  it('maps every catalog tool to a group', () => {
    const unmapped = ALL_TOOLS.map((t) => t.name).filter((n) => !(n in TOOL_FEATURE_MAP))
    expect(unmapped).toEqual([])
  })

  it('maps only to declared groups, and never maps a deprecated alias', () => {
    for (const [name, group] of Object.entries(TOOL_FEATURE_MAP)) {
      expect(FEATURE_GROUPS, name).toContain(group)
      expect(Object.keys(DEPRECATED_TOOL_ALIASES), name).not.toContain(name)
    }
  })

  it('maps tools only — resources are not feature-filtered and have no entry', () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name))
    expect(Object.keys(TOOL_FEATURE_MAP).filter((n) => !names.has(n))).toEqual([])
  })

  it('points every deprecated alias at a real tool', () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name))
    for (const [alias, target] of Object.entries(DEPRECATED_TOOL_ALIASES)) {
      expect(names.has(target), `${alias} → ${target}`).toBe(true)
    }
  })

  it('is byte-identical to the hosted copy', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const stdio = readFileSync(resolve(here, '../feature-groups.ts'), 'utf8')
    const hosted = readFileSync(
      resolve(here, '../../../server/supabase/functions/mcp/feature-groups.ts'),
      'utf8',
    )
    expect(hosted).toBe(stdio)
  })
})

describe('toolMatchesFeatures', () => {
  it('hides unmapped names under any group filter', () => {
    expect(toolMatchesFeatures('not_a_tool', DEFAULT_FEATURE_GROUPS)).toBe(false)
    expect(toolMatchesFeatures('not_a_tool', 'all')).toBe(true)
  })

  it('treats deprecated aliases as the legacy group', () => {
    for (const alias of Object.keys(DEPRECATED_TOOL_ALIASES)) {
      expect(toolMatchesFeatures(alias, DEFAULT_FEATURE_GROUPS), alias).toBe(false)
      expect(toolMatchesFeatures(alias, ['legacy']), alias).toBe(true)
    }
  })

  it('keeps the orientation router and the next-steps tool on the lean default', () => {
    expect(toolMatchesFeatures('use_mushi', DEFAULT_FEATURE_GROUPS)).toBe(true)
    expect(toolMatchesFeatures('triage_next_steps', DEFAULT_FEATURE_GROUPS)).toBe(true)
  })

  it('does not treat inherited object keys as tool names', () => {
    expect(toolMatchesFeatures('toString', DEFAULT_FEATURE_GROUPS)).toBe(false)
    expect(toolMatchesFeatures('constructor', ['legacy'])).toBe(false)
    expect(toolMatchesFeatures('toString', ['vibe'])).toBe(false)
  })
})

/**
 * `?features=vibe` is what the Lovable connector guide and the one-paste
 * Claude Code / Cursor installs use: a chat connector with ~90 tools picks
 * badly, and Cursor stops sending tools to the model past about 40.
 */
describe('the vibe preset', () => {
  const vibe = PRESET_TOOLS.vibe ?? []
  const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]))

  it('names only real, mapped catalog tools and stays small', () => {
    expect(vibe.length).toBeGreaterThanOrEqual(8)
    expect(vibe.length).toBeLessThanOrEqual(12)
    expect(new Set(vibe).size).toBe(vibe.length)
    for (const name of vibe) {
      expect(byName.has(name), name).toBe(true)
      expect(TOOL_FEATURE_MAP[name], name).toBeDefined()
    }
  })

  it('covers the broken-app loop: what came in, why, the fix prompt, mark fixed, setup', () => {
    for (const name of ['get_recent_reports', 'get_report_detail', 'get_fix_context', 'transition_status', 'diagnose_setup']) {
      expect(vibe, name).toContain(name)
    }
  })

  it('is a preset, not a group: no tool maps to it and `all` does not include it', () => {
    expect(Object.values(TOOL_FEATURE_MAP)).not.toContain('vibe')
    expect(FEATURE_GROUPS).toContain('vibe')
  })

  it('lists exactly the preset, and unions with a named group', () => {
    expect(parseFeaturesParam('vibe')).toEqual(['vibe'])
    const listed = ALL_TOOLS.map((t) => t.name).filter((n) => toolMatchesFeatures(n, ['vibe']))
    expect([...listed].sort()).toEqual([...vibe].sort())
    const withQa = ALL_TOOLS.map((t) => t.name).filter((n) => toolMatchesFeatures(n, ['vibe', 'qa']))
    expect(withQa).toEqual(expect.arrayContaining([...vibe, 'run_qa_story']))
    for (const alias of Object.keys(DEPRECATED_TOOL_ALIASES)) {
      expect(toolMatchesFeatures(alias, ['vibe']), alias).toBe(false)
    }
  })

  it('marks every read tool read-only, so Lovable runs it without an approval card', () => {
    for (const name of vibe) {
      const tool = byName.get(name)!
      if (tool.scope === 'mcp:read') expect(tool.hints?.readOnly, name).toBe(true)
    }
  })
})
