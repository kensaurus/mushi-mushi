/**
 * Which projects one hosted MCP connection acts on (ADR 0026):
 *   - an account connection (account key / console session, no pin) always
 *     lists list_projects + get_account_overview and tells the agent to pass
 *     projectId;
 *   - `?project=<uuid>` pins every call to one project and hides the account
 *     tools.
 * The pure rules are tested directly; mcp/index.ts cannot be imported in
 * Node (it calls Deno.serve), so its wiring is asserted at the source level,
 * as in mcp-http-scope-filter.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ACCOUNT_MODE_INSTRUCTIONS,
  ACCOUNT_TOOLS,
  ORG_WIDE_TOOLS,
  applyPinnedProject,
  instructionsForConnection,
  parsePinnedProject,
  toolEnabledForConnection,
  withAccountModeHint,
} from '../../supabase/functions/_shared/mcp-connection-scope.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const OTHER = '1000000b-0000-4000-8000-000000000000'
const url = (q: string) => new URL(`https://kensaur.us/mushi-mushi/hosted-mcp/${q}`)

describe('parsePinnedProject', () => {
  it('reads ?project= and normalizes case; absent or blank is no pin', () => {
    expect(parsePinnedProject(url(`?project=${P.toUpperCase()}&features=all`))).toEqual({ ok: true, projectId: P })
    expect(parsePinnedProject(url('?features=all'))).toEqual({ ok: true, projectId: null })
    expect(parsePinnedProject(url('?project='))).toEqual({ ok: true, projectId: null })
  })

  it('rejects a value that is not a UUID instead of silently unpinning', () => {
    expect(parsePinnedProject(url('?project=glot-it'))).toMatchObject({ ok: false })
  })
})

describe('toolEnabledForConnection', () => {
  const lean = (n: string) => n === 'get_recent_reports'
  it('an account connection always lists the account tools, whatever ?features= says', () => {
    for (const name of ACCOUNT_TOOLS) expect(toolEnabledForConnection(name, { accountMode: true }, lean)).toBe(true)
    expect(toolEnabledForConnection('get_recent_reports', { accountMode: true }, lean)).toBe(true)
    expect(toolEnabledForConnection('merge_fix', { accountMode: true }, lean)).toBe(false)
  })

  it('a project connection keeps the ?features= rule', () => {
    expect(toolEnabledForConnection('list_projects', {}, lean)).toBe(false)
    expect(toolEnabledForConnection('list_projects', {}, () => true)).toBe(true)
  })

  it('a pinned connection hides the account tools even with features=all', () => {
    expect(toolEnabledForConnection('list_projects', { pinnedProjectId: P }, () => true)).toBe(false)
    expect(toolEnabledForConnection('get_account_overview', { pinnedProjectId: P }, () => true)).toBe(false)
  })
})

describe('organization-wide tools on a narrowed connection', () => {
  it('are hidden when pinned or limited to selected projects, and listed otherwise', () => {
    for (const name of ORG_WIDE_TOOLS) {
      expect(toolEnabledForConnection(name, { accountMode: true }, () => true), name).toBe(true)
      expect(toolEnabledForConnection(name, { pinnedProjectId: P }, () => true), name).toBe(false)
      expect(toolEnabledForConnection(name, { accountMode: true, limitedToProjects: true }, () => true), name).toBe(false)
    }
  })

  it('names only real hosted tools that call /v1/admin/orgs/', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/mcp/index.ts'), 'utf8')
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../supabase/functions/_shared/mcp-hosted-tool-manifest.json'), 'utf8'),
    ) as Record<string, { path?: string }>
    for (const name of ORG_WIDE_TOOLS) {
      const handler = src.split(`\n  ${name}: {\n`)[1]?.split('\n  },\n')[0] ?? ''
      const viaManifest = manifest[name]?.path ?? ''
      expect(`${handler}${viaManifest}`, name).toMatch(/\/v1\/admin\/orgs\//)
    }
  })
})

describe('applyPinnedProject', () => {
  it('fills projectId on tools that take it and leaves others alone', () => {
    expect(applyPinnedProject({ reportId: 'r' }, P, true)).toEqual({ ok: true, args: { reportId: 'r', projectId: P } })
    expect(applyPinnedProject({ reportId: 'r' }, P, false)).toEqual({ ok: true, args: { reportId: 'r' } })
    expect(applyPinnedProject({ projectId: P.toUpperCase() }, P, true)).toEqual({ ok: true, args: { projectId: P } })
  })

  it('refuses a call that names another project', () => {
    const out = applyPinnedProject({ projectId: OTHER }, P, true)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.message).toContain(P)
  })

  it('does nothing without a pin', () => {
    const args = { projectId: OTHER }
    expect(applyPinnedProject(args, undefined, true)).toEqual({ ok: true, args })
  })
})

describe('account-mode guidance', () => {
  it('adds the list_projects step to the instructions and to project-required errors only on an account connection', () => {
    expect(instructionsForConnection('Base.', { accountMode: true })).toBe(`Base. ${ACCOUNT_MODE_INSTRUCTIONS}`)
    expect(instructionsForConnection('Base.', {})).toBe('Base.')
    expect(withAccountModeHint('projectId is required for get_inventory', { accountMode: true })).toContain('call list_projects')
    expect(withAccountModeHint('projectId is required for get_inventory', {})).toBe('projectId is required for get_inventory')
    expect(withAccountModeHint('Report not found', { accountMode: true })).toBe('Report not found')
  })
})

describe('mcp/index.ts wiring', () => {
  const SRC = readFileSync(resolve(__dirname, '../../supabase/functions/mcp/index.ts'), 'utf8')
  const fn = (name: string) => SRC.split(`function ${name}(`)[1]?.split('\nfunction ')[0]?.split('\nasync function ')[0] ?? ''

  it('resolveAuth never forwards an account key\'s NULL project as X-Mushi-Project-Id', () => {
    const auth = fn('resolveAuth')
    expect(auth).not.toMatch(/'X-Mushi-Project-Id': row\.project_id/)
    expect(auth).toMatch(/projectId \? \{ \.\.\.keyHeaders, 'X-Mushi-Project-Id': projectId \} : keyHeaders/)
    expect(auth).toMatch(/select=project_id,scopes,owner_user_id,id,is_org_scoped,allowed_project_ids/)
    expect(auth).toMatch(/limitedToProjects: Array\.isArray\(row\.allowed_project_ids\)/)
    expect(auth).toMatch(/accountMode: !projectId/)
  })

  it('checks a pin against what the credential reaches before trusting it', () => {
    expect(fn('resolveAuth')).toMatch(/if \(!row\.project_id && pinnedProjectId\) await assertPinnedProjectReachable/)
    expect(fn('resolveAuth')).toMatch(/if \(pinnedProjectId\) await assertPinnedProjectReachable\(\{ Authorization: auth \}/)
  })

  it('tools/list and tools/call share the connection rule, and tools/call applies the pin', () => {
    expect(fn('handleToolsList')).toMatch(/toolEnabledForConnection\(name, ctx,/)
    const call = fn('handleToolsCall')
    expect(call).toMatch(/toolEnabledForConnection\(DEPRECATED_TOOL_ALIASES\[name\] \?\? name, ctx,/)
    expect(call).toMatch(/applyPinnedProject\(/)
  })

  it('a bad ?project= is a 400/403 without an OAuth challenge, at both auth sites', () => {
    expect(SRC.match(/return authFailureResponse\(req, err\)/g)).toHaveLength(2)
    expect(fn('authFailureResponse')).toMatch(/err instanceof ConnectionConfigError/)
  })

  it('initialize and server/discover send the per-connection instructions', () => {
    expect(SRC).toMatch(/instructions: instructionsForConnection\(SERVER_INSTRUCTIONS, ctx\)/)
    expect(SRC).toMatch(/buildServerDiscoverResult\(\{ serverInfo: SERVER_INFO, instructions: instructionsForConnection\(SERVER_INSTRUCTIONS, ctx\) \}\)/)
  })
})
