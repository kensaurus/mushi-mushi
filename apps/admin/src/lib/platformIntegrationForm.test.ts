import { describe, expect, it } from 'vitest'
import {
  draftFromSaved,
  parseListInput,
  platformSaveBody,
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
    expect(body).toEqual({ sentry_project_slug: 'web', sentry_extra_project_slugs: ['api', 'worker'] })
  })

  it('sends an emptied list as [] and omits an unchanged one', () => {
    expect(platformSaveBody(sentry, { sentry_extra_project_slugs: '' }, saved)).toEqual({ sentry_extra_project_slugs: [] })
    expect(platformSaveBody(sentry, { sentry_project_slug: 'web', sentry_extra_project_slugs: 'api' }, saved)).toEqual({
      sentry_project_slug: 'web',
    })
    // Never saved (column missing before the migration): an empty draft is unchanged.
    expect(platformSaveBody(sentry, { sentry_extra_project_slugs: '' }, {})).toEqual({})
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
