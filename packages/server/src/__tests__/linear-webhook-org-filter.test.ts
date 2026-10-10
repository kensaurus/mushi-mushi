/**
 * FILE: linear-webhook-org-filter.test.ts
 * PURPOSE: webhooks-linear read `organizationId` but both lookup branches ran
 *          the same unfiltered query, so every delivery dereferenced Vault and
 *          computed an HMAC for every installed project. linear-oauth-callback
 *          now records the organization id and the webhook narrows candidates
 *          by it (plus legacy null rows) before checking signatures.
 *
 *          Both functions import Deno globals, so the wiring is asserted at
 *          the source level (same pattern as mcp-hosted-tool-surface.test.ts).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SUPABASE = resolve(__dirname, '../../supabase')
const read = (rel: string) => readFileSync(resolve(SUPABASE, rel), 'utf8')

describe('Linear webhook organization filter', () => {
  const webhook = read('functions/webhooks-linear/index.ts')
  const callback = read('functions/linear-oauth-callback/index.ts')
  const migration = read('migrations/20261010180700_project_settings_linear_organization_id.sql')

  it('adds the nullable column the filter reads', () => {
    expect(migration).toMatch(
      /alter table public\.project_settings\s+add column if not exists linear_organization_id text;/,
    )
  })

  it('records the organization id at OAuth install, in its own best-effort write', () => {
    expect(callback).toMatch(/\.update\(\{ linear_organization_id: linearOrgId \}\)/)
    // Not in the main settings update: deployed before the migration, the
    // unknown column would fail every Linear install.
    const updates = callback.split('const updates')[1]?.split('\n  }\n')[0] ?? ''
    expect(updates).not.toContain('linear_organization_id')
  })

  it('narrows candidates by organization id and keeps legacy null rows', () => {
    expect(webhook).toMatch(/\.eq\('linear_organization_id', linearOrgId\)/)
    expect(webhook).toMatch(/\.is\('linear_organization_id', null\)/)
  })

  it('never treats a teamId as an organization id or interpolates the unverified id', () => {
    expect(webhook).not.toMatch(/payload\.teamId/)
    expect(webhook).not.toMatch(/\.or\([^)]*linearOrgId/)
  })
})
