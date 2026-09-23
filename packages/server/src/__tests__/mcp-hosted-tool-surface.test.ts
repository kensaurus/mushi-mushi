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
import { HOSTED_RESOURCE_URIS, hostedResourceTarget } from '../../supabase/functions/mcp/hosted-resources.ts'

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

/**
 * project_dashboard, project_stats, project_settings, privacy_status,
 * evolution_history, project_integration_health and inventory_current were
 * hosted *tools* (listed under ?features=all) while stdio served them as
 * resources, and hosted resources/list carried only four URIs. They are
 * resources on both transports now.
 */
describe('hosted MCP resources', () => {
  const DISCOVERY = JSON.parse(
    readFileSync(resolve(FUNCTIONS, '_shared/mcp-discovery-tools.json'), 'utf8'),
  ) as { tools: Record<string, unknown>; resources: Array<{ name: string; uri: string }> }
  const resourceOnly = DISCOVERY.resources.filter((r) => !(r.name in DISCOVERY.tools))

  it('lists no resource-shaped tool in the hosted tool manifest', () => {
    expect(resourceOnly.map((r) => r.name)).toEqual(
      expect.arrayContaining(['project_dashboard', 'privacy_status', 'inventory_current']),
    )
    expect(resourceOnly.filter((r) => r.name in MANIFEST).map((r) => r.name)).toEqual([])
    expect(hostedToolNames().filter((n) => resourceOnly.some((r) => r.name === n))).toEqual([])
  })

  it('resolves every catalog resource URI to an api route', () => {
    expect([...HOSTED_RESOURCE_URIS].sort()).toEqual(DISCOVERY.resources.map((r) => r.uri).sort())
    for (const { uri } of DISCOVERY.resources) {
      const target = hostedResourceTarget(uri, '11111111-1111-4111-8111-111111111111')
      expect(target && 'path' in target ? target.path : null, uri).toMatch(/^\/v1\/admin\//)
    }
  })

  it('names the missing project instead of reading project-scoped resources without one', () => {
    expect(hostedResourceTarget('inventory://current')).toEqual({ error: expect.stringMatching(/X-Mushi-Project-Id/) })
    expect(hostedResourceTarget('evolution://history')).toEqual({ error: expect.stringMatching(/project/) })
    expect(hostedResourceTarget('project://stats')).toEqual({ path: '/v1/admin/stats' })
    expect(hostedResourceTarget('nope://x')).toBeNull()
  })

  it('builds resources/list from the generated catalog and resources/read from the route table', () => {
    const list = SOURCE.split('function handleResourcesList')[1]?.split('\nasync function ')[0] ?? ''
    expect(list).toMatch(/MCP_DISCOVERY\.resources/)
    const read = SOURCE.split('async function handleResourcesRead')[1]?.split('\nfunction ')[0] ?? ''
    expect(read).toMatch(/hostedResourceTarget\(uri, ctx\.projectIdHint\)/)
  })
})
