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
  TOOL_FEATURE_MAP,
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
  })
})
