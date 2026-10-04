/**
 * Settings → Health "Rotate key" revoked every active key of the project
 * (suspected-bugs entry 27). Rotation now names one key, revokes only that
 * one, and its successor keeps the label and scopes.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseRotateBody,
  parseRotateTarget,
  pickRotationTarget,
  type RotatableKeyRow,
} from '../../supabase/functions/_shared/api-key-rotation.ts'

const SDK: RotatableKeyRow = { id: '11111111-1111-4111-8111-111111111111', key_prefix: 'mushi_aaa111', label: 'sdk-ingest', scopes: ['report:write'] }
const MCP: RotatableKeyRow = { id: '22222222-2222-4222-8222-222222222222', key_prefix: 'mushi_bbb222', label: 'mcp-readwrite', scopes: ['mcp:read', 'mcp:write'] }

describe('parseRotateTarget', () => {
  it('keeps the legacy rotate-everything path when no key is named', () => {
    expect(parseRotateTarget(null)).toBeNull()
    expect(parseRotateTarget({})).toBeNull()
    expect(parseRotateTarget('nope')).toBeNull()
  })

  it('accepts a key id or a key prefix', () => {
    expect(parseRotateTarget({ key_id: SDK.id })).toEqual({ keyId: SDK.id })
    expect(parseRotateTarget({ key_prefix: 'mushi_aaa111' })).toEqual({ keyPrefix: 'mushi_aaa111' })
  })

  it('treats a prefix sent as an id (a row minted moments ago) as a prefix', () => {
    expect(parseRotateTarget({ key_id: 'mushi_aaa111' })).toEqual({ keyPrefix: 'mushi_aaa111' })
  })

  it('refuses a malformed key instead of rotating everything', () => {
    expect(parseRotateTarget({ key_id: 'drop table' })).toHaveProperty('error')
    expect(parseRotateTarget({ key_prefix: '' })).toHaveProperty('error')
    expect(parseRotateTarget({ key_prefix: 'x' })).toHaveProperty('error')
  })
})

describe('parseRotateBody', () => {
  it('reads an empty body as the legacy rotate-everything call', () => {
    expect(parseRotateBody('')).toBeNull()
    expect(parseRotateBody('   ')).toBeNull()
    expect(parseRotateBody('{}')).toBeNull()
  })

  it('refuses a body that is not a JSON object instead of rotating everything', () => {
    expect(parseRotateBody('{"key_prefix": "mushi_a')).toHaveProperty('error')
    expect(parseRotateBody('mushi_aaa111')).toHaveProperty('error')
    expect(parseRotateBody('null')).toHaveProperty('error')
    expect(parseRotateBody('["mushi_aaa111"]')).toHaveProperty('error')
  })

  it('passes a named key through', () => {
    expect(parseRotateBody('{"key_prefix":"mushi_aaa111"}')).toEqual({ keyPrefix: 'mushi_aaa111' })
  })
})

describe('pickRotationTarget', () => {
  it('picks exactly the named key', () => {
    expect(pickRotationTarget([SDK, MCP], { keyId: MCP.id })).toEqual({ ok: true, row: MCP })
    expect(pickRotationTarget([SDK, MCP], { keyPrefix: 'mushi_aaa111' })).toEqual({ ok: true, row: SDK })
  })

  it('says plainly when the key is gone', () => {
    const pick = pickRotationTarget([SDK], { keyId: MCP.id })
    expect(pick).toMatchObject({ ok: false, code: 'NOT_FOUND', status: 404 })
  })

  it('never rotates more than one key when two share a prefix', () => {
    const twin = { ...SDK, id: '33333333-3333-4333-8333-333333333333' }
    expect(pickRotationTarget([SDK, twin], { keyPrefix: SDK.key_prefix })).toMatchObject({ ok: false, code: 'AMBIGUOUS', status: 409 })
  })
})

describe('POST /v1/admin/projects/:id/keys/rotate wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/project-keys.ts'), 'utf8')
  const start = src.indexOf("app.post('/v1/admin/projects/:id/keys/rotate'")
  const body = src.slice(start, src.indexOf("app.delete('/v1/admin/projects/:id/keys/:keyId'"))

  it('narrows the revoke to the picked key when one was named', () => {
    expect(body).toContain("parseRotateBody(await c.req.text().catch(() => ''))")
    expect(body).toContain("if (target) revoke = revoke.eq('id', existing[0]!.id)")
  })

  it('keeps the label and scopes and records the lineage', () => {
    expect(body).toContain('label: successor.label')
    expect(body).toContain('scopes: successor.scopes')
    // Best effort, after the insert, so a missing column never fails a rotation.
    expect(body).toContain('.update({ rotated_from: successor.rotatedFrom })')
  })

  it('returns the new key scopes and the revoked prefixes', () => {
    expect(body).toContain('scopes: newScopes')
    expect(body).toContain('revoked_prefixes: existing.map((row) => row.key_prefix)')
  })
})
