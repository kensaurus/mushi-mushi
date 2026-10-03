/**
 * FILE: sentry-extra-project-slugs.test.ts
 * PURPOSE: One Mushi project can import from several Sentry projects
 *          (sbc front + back). Locks the PUT validation of
 *          `sentry_extra_project_slugs`, the platform GET values (fields the
 *          effective-settings resolver does not track used to come back null,
 *          and a console save then wiped them), and that the list field stays
 *          out of the org-default / apply-to-all field list.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MAX_SENTRY_EXTRA_PROJECT_SLUGS,
  parseSentryExtraProjectSlugs,
  SENTRY_PROJECT_SLUG_RE,
} from '../../supabase/functions/_shared/integration-validation.ts'
import { platformCardValues, PROJECT_LIST_FIELDS_BY_KIND } from '../../supabase/functions/_shared/platform-config.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')

describe('parseSentryExtraProjectSlugs', () => {
  it('accepts a slug array, trimming and deduping', () => {
    expect(parseSentryExtraProjectSlugs(['sbc-be', ' sbc-worker ', 'sbc-be', ''])).toEqual({
      ok: true,
      slugs: ['sbc-be', 'sbc-worker'],
    })
  })

  it('clears to an empty array for null, empty string and []', () => {
    expect(parseSentryExtraProjectSlugs(null)).toEqual({ ok: true, slugs: [] })
    expect(parseSentryExtraProjectSlugs('')).toEqual({ ok: true, slugs: [] })
    expect(parseSentryExtraProjectSlugs([])).toEqual({ ok: true, slugs: [] })
  })

  it('refuses non-arrays, non-strings, bad slugs and more than 10', () => {
    expect(parseSentryExtraProjectSlugs('sbc-be')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    expect(parseSentryExtraProjectSlugs(['ok', 3])).toMatchObject({ ok: false })
    const bad = parseSentryExtraProjectSlugs(['Has Space'])
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.message).toContain('Has Space')
    expect(parseSentryExtraProjectSlugs(['UPPER'])).toMatchObject({ ok: false })
    const eleven = Array.from({ length: MAX_SENTRY_EXTRA_PROJECT_SLUGS + 1 }, (_, i) => `p${i}`)
    expect(parseSentryExtraProjectSlugs(eleven)).toMatchObject({ ok: false })
    expect(parseSentryExtraProjectSlugs(eleven.slice(0, 10))).toMatchObject({ ok: true })
  })

  it('uses the same slug rule as the import route', () => {
    const importSrc = readFileSync(resolve(FUNCTIONS, '_shared/sentry-import.ts'), 'utf-8')
    expect(importSrc).toContain(`const SLUG_RE = ${SENTRY_PROJECT_SLUG_RE.toString()};`)
  })
})

describe('platformCardValues (platform GET)', () => {
  const fields = ['sentry_org_slug', 'sentry_project_slug', 'sentry_auth_token_ref', 'sentry_seer_enabled']
  const tracked = { sentry_org_slug: 'org', sentry_auth_token_ref: 'project' }

  it('takes resolver fields from the effective settings and the rest from the project row', () => {
    const out = platformCardValues(
      'sentry',
      fields,
      { sentry_org_slug: 'acme', sentry_auth_token_ref: 'vault://x' },
      tracked,
      { sentry_org_slug: null, sentry_project_slug: 'web', sentry_seer_enabled: true, sentry_extra_project_slugs: ['api'] },
    )
    expect(out).toEqual({
      sentry_org_slug: 'acme',
      sentry_project_slug: 'web',
      sentry_auth_token_ref: 'vault://x',
      sentry_seer_enabled: true,
      sentry_extra_project_slugs: ['api'],
    })
  })

  it('returns [] for the list field when the column is missing (migration not applied yet)', () => {
    const out = platformCardValues('sentry', fields, {}, tracked, { sentry_project_slug: 'web' })
    expect(out.sentry_extra_project_slugs).toEqual([])
    expect(platformCardValues('sentry', fields, {}, tracked, null).sentry_project_slug).toBeNull()
    expect(platformCardValues('langfuse', ['langfuse_host'], {}, {}, null)).toEqual({ langfuse_host: null })
  })
})

describe('integrations route wiring', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'api/routes/integrations.ts'), 'utf-8')

  it('keeps the list field out of PLATFORM_KIND_FIELDS (org defaults and apply-to-all iterate it)', () => {
    const block = src.slice(src.indexOf('const PLATFORM_KIND_FIELDS'), src.indexOf('const PLATFORM_API_KINDS'))
    expect(block).not.toContain('sentry_extra_project_slugs')
    expect(PROJECT_LIST_FIELDS_BY_KIND.sentry).toEqual(['sentry_extra_project_slugs'])
  })

  it('parses the list on the project PUT before the NO_FIELDS check', () => {
    const put = src.slice(src.indexOf("app.put('/v1/admin/integrations/platform/:kind'"))
    const parseAt = put.indexOf('parseSentryExtraProjectSlugs(body.sentry_extra_project_slugs)')
    const noFieldsAt = put.indexOf("code: 'NO_FIELDS'")
    expect(parseAt).toBeGreaterThan(0)
    expect(parseAt).toBeLessThan(noFieldsAt)
  })

  it('the platform GET builds card values from the project row too', () => {
    expect(src).toContain('platformCardValues(')
    expect(src).toContain(".from('project_settings').select('*')")
  })

  it('the platform GET refuses to serve null card values when the project row is unreadable', () => {
    const get = src.slice(src.indexOf("app.get('/v1/admin/integrations/platform'"), src.indexOf('const maskField'))
    // The error branch must end the request before projectRow is read.
    const onError = get.slice(get.indexOf('if (rawRowRes.error)'), get.indexOf('const projectRow'))
    expect(onError).toContain('return c.json(')
    expect(onError).toContain("code: 'SETTINGS_UNREADABLE'")
    expect(onError).toMatch(/\s500,\s/)
  })
})
