/**
 * SSO "Add provider" with OpenID Connect (suspected-bugs entry 119): the
 * issuer and client ID were posted and dropped. They are now kept (in the
 * metadata_url / entity_id columns) and the client secret is never stored.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { oidcRecordFields } from '../../supabase/functions/_shared/sso-oidc-record.ts'

describe('oidcRecordFields', () => {
  it('keeps the issuer and client ID the admin typed', () => {
    expect(oidcRecordFields({ issuerUrl: ' https://accounts.google.com ', clientId: ' abc.apps ' })).toEqual({
      ok: true,
      metadata_url: 'https://accounts.google.com',
      entity_id: 'abc.apps',
    })
  })

  it('needs an https issuer and a client ID, in plain words', () => {
    expect(oidcRecordFields({ issuerUrl: 'http://idp.example', clientId: 'x' })).toMatchObject({ ok: false, code: 'MISSING_ISSUER' })
    expect(oidcRecordFields({ issuerUrl: 'not a url', clientId: 'x' })).toMatchObject({ ok: false, code: 'MISSING_ISSUER' })
    expect(oidcRecordFields({ issuerUrl: 'https://idp.example', clientId: '  ' })).toMatchObject({ ok: false, code: 'MISSING_CLIENT_ID' })
  })

  it('refuses a client secret instead of storing it', () => {
    expect(oidcRecordFields({ issuerUrl: 'https://idp.example', clientId: 'x', clientSecret: 's3cret' })).toMatchObject({
      ok: false,
      code: 'SECRET_NOT_STORED',
    })
  })
})

describe('POST /v1/admin/sso wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/sso-audit.ts'), 'utf8')

  it('writes the OIDC fields into the row it inserts', () => {
    expect(src).toContain('const record = oidcRecordFields(body)')
    expect(src).toContain('metadata_url: oidc ? oidc.metadata_url : body.metadataUrl ?? null')
    expect(src).toContain('entity_id: oidc ? oidc.entity_id : body.entityId ?? null')
  })
})
