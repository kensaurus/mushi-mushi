/**
 * FILE: plan-app-limit.test.ts
 * PURPOSE: The plan app limit (docs/plan-pricing.md, 2026-10-28): Free 1,
 *          Builder 3, Studio 10, Enterprise none. Only a new app is refused,
 *          and the refusal names the plan that fits.
 */

import { describe, expect, it } from 'vitest'
import { appLimitDenial } from '../../supabase/functions/_shared/plan-app-limit.ts'

const FREE = { id: 'free_cloud', display_name: 'Free', max_projects: 1 }
const BUILDER = { id: 'indie', display_name: 'Builder', max_projects: 3 }
const STUDIO = { id: 'pro', display_name: 'Studio', max_projects: 10 }
const ENTERPRISE = { id: 'enterprise', display_name: 'Enterprise', max_projects: null }

describe('appLimitDenial', () => {
  it('lets a team add apps up to its plan limit', () => {
    expect(appLimitDenial(FREE, 0)).toBeNull()
    expect(appLimitDenial(BUILDER, 2)).toBeNull()
    expect(appLimitDenial(STUDIO, 9)).toBeNull()
  })

  it('refuses one more app at the limit and points at the next plan', () => {
    expect(appLimitDenial(FREE, 1)).toMatchObject({ code: 'PLAN_APP_LIMIT', limit: 1, used: 1, upgradeTo: 'indie' })
    expect(appLimitDenial(FREE, 1)!.message).toBe('Free watches 1 app, and this team has 1. Move to Builder (3 apps) to add another, or remove an app you no longer use.')
    expect(appLimitDenial(BUILDER, 3)).toMatchObject({ upgradeTo: 'pro', limit: 3 })
    expect(appLimitDenial(STUDIO, 12)).toMatchObject({ upgradeTo: 'enterprise', used: 12 })
  })

  it('has no limit on Enterprise or a plan row without max_projects (before the migration)', () => {
    expect(appLimitDenial(ENTERPRISE, 500)).toBeNull()
    expect(appLimitDenial({ id: 'pro', display_name: 'Studio' }, 500)).toBeNull()
  })
})
