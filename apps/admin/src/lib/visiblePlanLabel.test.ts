/**
 * FILE: apps/admin/src/lib/visiblePlanLabel.test.ts
 * PURPOSE: Complimentary plan labels stay identical across the three surfaces
 *          that used to disagree (header "COMP", green Team-page "Pro",
 *          sidebar "Admin").
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { visiblePlanLabel, visiblePlanLabelOr } from './visiblePlanLabel'

const root = resolve(__dirname, '..')

describe('visiblePlanLabel', () => {
  it('leaves a paid plan name untouched', () => {
    expect(visiblePlanLabel({ name: 'Pro' })).toBe('Pro')
    expect(visiblePlanLabel({ name: 'pro', complimentary: false })).toBe('pro')
  })

  it('uses the same words for a display name and a plan id', () => {
    expect(visiblePlanLabel({ name: 'Pro', complimentary: true })).toBe('Comp · Pro')
    expect(visiblePlanLabel({ name: 'pro', complimentary: true })).toBe('Comp · Pro')
    expect(visiblePlanLabel({ name: 'Enterprise', complimentary: true })).toBe('Comp · Enterprise')
  })

  it('does not call a complimentary org a bare paid tier or a role', () => {
    const label = visiblePlanLabel({ name: 'Pro', complimentary: true })
    expect(label).not.toBe('Pro')
    expect(label).not.toMatch(/admin/i)
  })

  it('falls back when the tier is missing', () => {
    expect(visiblePlanLabel({ name: null, complimentary: true })).toBe('Comp')
    expect(visiblePlanLabel({ name: '  ', complimentary: false })).toBe('Hobby')
    expect(visiblePlanLabelOr(null, true, '—')).toBe('Comp')
    expect(visiblePlanLabelOr(null, false, '—')).toBe('—')
    expect(visiblePlanLabelOr('Pro', true, '—')).toBe('Comp · Pro')
  })

  it('is the label the header, Team page, and sidebar render', () => {
    const files = [
      'components/OrgSwitcher.tsx',
      'components/PlanBadge.tsx',
      'pages/OrganizationSettingsPage.tsx',
    ]
    for (const file of files) {
      const text = readFileSync(resolve(root, file), 'utf8')
      expect(text, file).toContain('visiblePlanLabel')
    }
    const header = readFileSync(resolve(root, 'components/OrgSwitcher.tsx'), 'utf8')
    expect(header).not.toMatch(/billing_mode === 'complimentary' \? 'comp'/)
  })
})
