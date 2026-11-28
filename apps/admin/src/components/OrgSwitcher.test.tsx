import { describe, expect, it } from 'vitest'
import { orgPillLabel, type OrganizationSummary } from './OrgSwitcher'

const team = (over: Partial<OrganizationSummary> = {}): OrganizationSummary => ({
  id: 'org-1',
  slug: 'personal',
  name: 'Personal workspace',
  plan_id: 'free_cloud',
  role: 'owner',
  ...over,
})

describe('orgPillLabel', () => {
  it('names the hosted plan on Mushi Mushi Cloud', () => {
    expect(orgPillLabel(team(), 'cloud')).toBe('Free')
    expect(orgPillLabel(team({ plan_id: 'pro' }), 'cloud')).toBe('Studio')
    expect(orgPillLabel(team({ plan_id: 'custom_x' }), 'cloud')).toBe('custom_x')
  })

  it('says Self-hosted on a self-hosted install, where no plan or limit applies', () => {
    expect(orgPillLabel(team(), 'self-hosted')).toBe('Self-hosted')
    expect(orgPillLabel(team({ plan_id: 'pro' }), 'self-hosted')).toBe('Self-hosted')
  })

  it('says a complimentary team is free, in words, either way', () => {
    expect(orgPillLabel(team({ billing_mode: 'complimentary', plan_id: 'pro' }), 'cloud')).toBe('Studio · free')
    expect(orgPillLabel(team({ billing_mode: 'complimentary', plan_id: 'pro' }), 'self-hosted')).toBe('Studio · free')
  })
})
