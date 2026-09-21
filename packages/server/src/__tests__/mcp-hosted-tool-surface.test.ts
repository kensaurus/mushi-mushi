/**
 * FILE: mcp-hosted-tool-surface.test.ts
 * PURPOSE: What a client sees on the bare hosted MCP URL — the URL every
 *          published config uses. It used to list 94 tools, 11 of them
 *          deprecated duplicate aliases (fix_suggest beside suggest_fix),
 *          because a missing `?features=` meant "all" and unmapped names
 *          matched every filter. It now gets the same lean default as stdio,
 *          aliases stay callable but unlisted, and the five linear_* tools
 *          that a later TOOLS assignment silently discarded are gone.
 *
 *          index.ts imports Deno globals, so the wiring is asserted at the
 *          source level (same pattern as mcp-http-scope-filter.test.ts); the
 *          filter itself runs for real against the hosted feature map.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_FEATURE_GROUPS,
  DEPRECATED_TOOL_ALIASES,
  TOOL_FEATURE_MAP,
  toolMatchesFeatures,
} from '../../supabase/functions/mcp/feature-groups.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const SOURCE = readFileSync(resolve(FUNCTIONS, 'mcp/index.ts'), 'utf8')
const MANIFEST = JSON.parse(
  readFileSync(resolve(FUNCTIONS, '_shared/mcp-hosted-tool-manifest.json'), 'utf8'),
) as Record<string, unknown>

/** Tool names the hosted server registers: BASE_TOOLS keys + manifest keys + alias shims. */
function hostedToolNames(): string[] {
  const base = SOURCE.split('const BASE_TOOLS')[1]?.split('/** Full catalog')[0] ?? ''
  const baseNames = [...base.matchAll(/^ {2}([a-z_]+): \{/gm)].map((m) => m[1])
  const registered = new Set([...baseNames, ...Object.keys(MANIFEST)])
  const aliases = Object.entries(DEPRECATED_TOOL_ALIASES)
    .filter(([, target]) => registered.has(target))
    .map(([alias]) => alias)
  return [...registered, ...aliases]
}

describe('hosted MCP tool surface', () => {
  const names = hostedToolNames()
  const isAlias = (n: string) => Object.prototype.hasOwnProperty.call(DEPRECATED_TOOL_ALIASES, n)

  it('finds the registered tools (sanity check on the source parse)', () => {
    expect(names).toContain('triage_issue')
    expect(names).toContain('dispatch_fix')
    expect(names).toContain('merge_fix')
    expect(names.length).toBeGreaterThan(60)
  })

  it('maps every non-alias hosted tool to a feature group', () => {
    const unmapped = names.filter((n) => !isAlias(n) && !(n in TOOL_FEATURE_MAP))
    expect(unmapped).toEqual([])
  })

  it('lists no deprecated alias on the default surface', () => {
    const listed = names.filter((n) => !isAlias(n) && toolMatchesFeatures(n, DEFAULT_FEATURE_GROUPS))
    expect(listed.filter(isAlias)).toEqual([])
    expect(listed).toContain('triage_issue')
    expect(listed).toContain('use_mushi')
    // The lean default is a strict subset of the full surface.
    expect(listed.length).toBeLessThan(names.filter((n) => !isAlias(n)).length)
  })

  it('defaults a request without ?features= to DEFAULT_FEATURE_GROUPS', () => {
    expect(SOURCE).toMatch(
      /url\.searchParams\.has\('features'\)\s*\?\s*parseFeaturesParam\(url\.searchParams\.get\('features'\)\)\s*:\s*DEFAULT_FEATURE_GROUPS/,
    )
  })

  it('leaves aliases out of tools/list unless `legacy` is requested, and resolves them on call', () => {
    const list = SOURCE.split('function handleToolsList')[1]?.split('\nfunction ')[0] ?? ''
    expect(list).toMatch(/listLegacy \|\| !Object\.prototype\.hasOwnProperty\.call\(DEPRECATED_TOOL_ALIASES, name\)/)
    const call = SOURCE.split('async function handleToolsCall')[1]?.split('\nasync function ')[0] ?? ''
    expect(call).toMatch(/toolMatchesFeatures\(DEPRECATED_TOOL_ALIASES\[name\] \?\? name, ctx\.features\)/)
  })

  it('no longer carries the unreachable linear_* tools', () => {
    expect(SOURCE).not.toMatch(/LINEAR_TOOLS|linear_search_issues/)
  })
})
