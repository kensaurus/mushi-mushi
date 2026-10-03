/**
 * FILE: supabase-link.test.ts
 * PURPOSE: Linking a project's Supabase from the console (ADR 0016). The link
 *          is `project_settings.supabase_project_ref` plus a BYOK `supabase`
 *          token. Both used to be unreachable: the ref was not on the
 *          settings PATCH allowlist and the provider was not a BYOK slug.
 *          The probe itself is covered by the Deno byok-validation suite.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isSupabaseProjectRef,
  parseSupabaseProjectRefSetting,
} from '../../supabase/functions/_shared/supabase-project-ref.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const read = (rel: string) => readFileSync(resolve(FUNCTIONS, rel), 'utf8')

const REF = 'abcdefghijklmnopqrst'

describe('parseSupabaseProjectRefSetting', () => {
  it('accepts a 20-character lowercase ref, trimmed', () => {
    expect(parseSupabaseProjectRefSetting(REF)).toEqual({ ok: true, value: REF })
    expect(parseSupabaseProjectRefSetting('dxptnwrhwsqckaftyymj')).toEqual({ ok: true, value: 'dxptnwrhwsqckaftyymj' })
    expect(parseSupabaseProjectRefSetting(`  ${REF}\n`)).toEqual({ ok: true, value: REF })
  })

  it('clears the link on null, empty or whitespace', () => {
    for (const v of [null, '', '   ']) expect(parseSupabaseProjectRefSetting(v)).toEqual({ ok: true, value: null })
  })

  it('rejects the wrong length', () => {
    expect(parseSupabaseProjectRefSetting(REF.slice(0, 19)).ok).toBe(false)
    expect(parseSupabaseProjectRefSetting(`${REF}a`).ok).toBe(false)
  })

  it('rejects uppercase instead of lowercasing it', () => {
    expect(parseSupabaseProjectRefSetting(REF.toUpperCase()).ok).toBe(false)
    expect(parseSupabaseProjectRefSetting(`A${REF.slice(1)}`).ok).toBe(false)
  })

  it('rejects anything that could change the Management API path or a query', () => {
    for (const v of [
      'abcdefghij/../../xyz',
      'abcdefghijklmnopqrs/',
      'abcdefghijklmnopqrs%',
      "abcdefghij' or 1=1--",
      'abcdefghijklmnopqrs\u0000',
      'https://abcdefghijklmnopqrst.supabase.co',
    ]) {
      expect(parseSupabaseProjectRefSetting(v).ok).toBe(false)
    }
  })

  it('rejects non-string values', () => {
    for (const v of [42, true, {}, [REF], undefined]) expect(parseSupabaseProjectRefSetting(v).ok).toBe(false)
  })

  it('isSupabaseProjectRef agrees with the parser', () => {
    expect(isSupabaseProjectRef(REF)).toBe(true)
    expect(isSupabaseProjectRef(null)).toBe(false)
    expect(isSupabaseProjectRef(REF.toUpperCase())).toBe(false)
  })
})

describe('PATCH /v1/admin/settings links the Supabase project', () => {
  const route = read('api/routes/settings-research.ts')
  const patch = route.slice(route.indexOf("app.patch('/v1/admin/settings'"))

  it('allows supabase_project_ref and validates it before the generic fallthrough', () => {
    const allowlist = patch.slice(patch.indexOf('const allowed = ['), patch.indexOf('];'))
    expect(allowlist).toContain("'supabase_project_ref'")
    const branch = patch.slice(
      patch.indexOf("if (key === 'supabase_project_ref')"),
      patch.indexOf("if (key === 'voice_intake_enabled')"),
    )
    expect(branch).toContain('requireProjectAdmin(c, project)')
    expect(branch).toContain('parseSupabaseProjectRefSetting(value)')
    expect(branch).toContain("code: 'VALIDATION_ERROR'")
    expect(branch).toContain('updates[key] = verdict.value')
    // The generic fallthrough is the loop's last write.
    const loopEnd = patch.indexOf('const { error } = await db')
    expect(patch.indexOf("if (key === 'supabase_project_ref')")).toBeLessThan(patch.lastIndexOf('updates[key] = value;', loopEnd))
  })

  it('probes a Supabase token against the linked ref on add and on test', () => {
    expect(route.match(/await supabaseProbeOptions\(db, project\.id, /g)?.length).toBe(2)
  })
})

describe('Supabase as a BYOK provider', () => {
  it('is a pooled provider slug with a read-only probe', () => {
    const validation = read('_shared/byok-validation.ts')
    const providers = validation.slice(validation.indexOf('export const BYOK_PROVIDERS'), validation.indexOf('] as const;'))
    expect(providers).toContain("'supabase'")
    expect(validation).toContain('/database/query/read-only')
  })

  it('the audit log accepts the supabase provider (migration)', () => {
    const sql = read('../migrations/20261003190000_byok_audit_log_supabase_provider.sql')
    expect(sql).toMatch(/CHECK \(provider IN \('anthropic', 'openai', 'firecrawl', 'browserbase', 'cursor', 'supabase'\)\)/)
  })

  it('the connector shares the ref rule and no longer claims PATs cannot be scoped', () => {
    const connector = read('_shared/connectors/supabase.ts')
    expect(connector).toContain("from '../supabase-project-ref.ts'")
    expect(connector).not.toMatch(/cannot be (scoped|limited)/)
  })

  it('creating a supabase connector points at the real settings, not a missing one', () => {
    const connectors = read('api/routes/connectors.ts')
    expect(connectors).toContain('Settings → General → Supabase project')
    expect(connectors).toContain('Settings → AI keys → Supabase')
  })
})

describe('Supabase MCP requests', () => {
  it('every caller accepts JSON and SSE, as Streamable HTTP requires', () => {
    for (const file of ['_shared/supabase-mcp-client.ts', '_shared/connectors/supabase.ts']) {
      expect(read(file), file).toContain('application/json, text/event-stream')
    }
  })
})
