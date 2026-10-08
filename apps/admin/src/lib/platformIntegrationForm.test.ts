import { describe, expect, it } from 'vitest'
import {
  draftFromSaved,
  parseListInput,
  platformSaveBody,
  projectStoredSecretFields,
  sentryProjectsFromConfig,
} from './platformIntegrationForm'
import { PLATFORM_DEFS } from '../components/integrations/types'
import { resolveValidator } from './validators'

const sentry = PLATFORM_DEFS.find((d) => d.kind === 'sentry')!

describe('Sentry card list field', () => {
  it('declares the extra project slugs as a validated list field', () => {
    const field = sentry.fields.find((f) => f.name === 'sentry_extra_project_slugs')
    expect(field).toMatchObject({ list: true, validator: 'sentrySlugList' })
    const validate = resolveValidator('sentrySlugList')!
    expect(validate('api, worker')).toBeNull()
    expect(validate('')).toBeNull()
    expect(validate('Api')).not.toBeNull()
    expect(validate(Array.from({ length: 11 }, (_, i) => `p${i}`).join(','))).not.toBeNull()
  })
})

describe('draftFromSaved', () => {
  it('joins lists and stringifies scalars without turning values into blanks', () => {
    expect(
      draftFromSaved({
        sentry_project_slug: 'web',
        sentry_extra_project_slugs: ['api', 'worker'],
        sentry_seer_enabled: true,
        sentry_dsn: null,
      }),
    ).toEqual({
      sentry_project_slug: 'web',
      sentry_extra_project_slugs: 'api, worker',
      sentry_seer_enabled: 'true',
      sentry_dsn: '',
    })
  })
})

describe('platformSaveBody', () => {
  const saved = { sentry_project_slug: 'web', sentry_extra_project_slugs: ['api'] }

  it('sends a changed list as an array', () => {
    const body = platformSaveBody(sentry, { sentry_project_slug: 'web', sentry_extra_project_slugs: 'api, worker' }, saved)
    expect(body).toEqual({ sentry_extra_project_slugs: ['api', 'worker'] })
  })

  it('sends an emptied list as [] and omits an unchanged one', () => {
    expect(platformSaveBody(sentry, { sentry_extra_project_slugs: '' }, saved)).toEqual({ sentry_extra_project_slugs: [] })
    expect(platformSaveBody(sentry, { sentry_project_slug: 'web', sentry_extra_project_slugs: 'api' }, saved)).toEqual({})
    // Never saved (column missing before the migration): an empty draft is unchanged.
    expect(platformSaveBody(sentry, { sentry_extra_project_slugs: '' }, {})).toEqual({})
  })

  it('sends only edited scalars, never echoes booleans or masked secrets back as text', () => {
    const current = {
      sentry_project_slug: 'web',
      sentry_seer_enabled: true,
      sentry_auth_token_ref: '…ab12',
      sentry_dsn: null,
    }
    const draft = { ...draftFromSaved(current), sentry_project_slug: 'web-app', sentry_dsn: '' }
    expect(platformSaveBody(sentry, draft, current)).toEqual({ sentry_project_slug: 'web-app' })
    // Clearing a saved value is a change and is sent as ''.
    expect(platformSaveBody(sentry, { ...draftFromSaved(current), sentry_project_slug: '' }, current)).toEqual({
      sentry_project_slug: '',
    })
  })
})

describe('helpers', () => {
  it('parseListInput trims, splits and dedupes', () => {
    expect(parseListInput(' a, b  c,,a ')).toEqual(['a', 'b', 'c'])
  })

  it('sentryProjectsFromConfig puts the primary first and dedupes', () => {
    expect(sentryProjectsFromConfig({ sentry_project_slug: 'web', sentry_extra_project_slugs: ['api', 'web'] })).toEqual([
      'web',
      'api',
    ])
    expect(sentryProjectsFromConfig({ sentry_project_slug: null })).toEqual([])
  })
})

describe('projectStoredSecretFields (Remove key)', () => {
  it('lists secrets the project stores itself, tracked or not', () => {
    const fields = projectStoredSecretFields(
      sentry,
      { sentry_auth_token_ref: '…abcd', sentry_webhook_secret: '…wxyz', sentry_org_slug: 'acme' },
      { sentry_auth_token_ref: 'project' },
    )
    expect(fields).toEqual(['sentry_auth_token_ref', 'sentry_webhook_secret'])
  })

  it('skips a tracked secret inherited from the org or env', () => {
    expect(projectStoredSecretFields(sentry, { sentry_auth_token_ref: '…abcd' }, { sentry_auth_token_ref: 'org' })).toEqual([])
    expect(projectStoredSecretFields(sentry, {}, { sentry_auth_token_ref: 'env' })).toEqual([])
  })

  it('never lists a non-secret field', () => {
    expect(projectStoredSecretFields(sentry, { sentry_org_slug: 'acme' }, {})).toEqual([])
  })
})
