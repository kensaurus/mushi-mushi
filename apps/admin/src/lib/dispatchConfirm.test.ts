import { describe, expect, it } from 'vitest'
import { dispatchBlock, dispatchConfirmBody, dispatchErrorText, featureRequestDispatchBlock } from './dispatchConfirm'

describe('featureRequestDispatchBlock (console mirror of the server gate)', () => {
  const widgetFeature = { user_category: 'other', user_intent: 'Feature request' }

  it('disables Dispatch on a feature request the classifier categorized (469f6962)', () => {
    expect(
      featureRequestDispatchBlock({ ...widgetFeature, category: 'visual', stage1_classification: { category: 'visual' } }),
    ).toMatch(/Feature request/)
    expect(featureRequestDispatchBlock({ user_category: 'feature', category: 'other' })).not.toBeNull()
  })

  it('enables it after a human re-categorization, and never blocks a bug', () => {
    expect(
      featureRequestDispatchBlock({ ...widgetFeature, category: 'bug', stage1_classification: { category: 'other' } }),
    ).toBeNull()
    expect(featureRequestDispatchBlock({ user_category: 'bug', category: 'bug' })).toBeNull()
  })

  it("enables it once a person confirms a category, even the classifier's own", () => {
    expect(
      featureRequestDispatchBlock({ ...widgetFeature, category: 'visual', stage2_analysis: { category: 'visual' }, category_confirmed_at: '2026-10-08T12:00:00Z' }),
    ).toBeNull()
  })
})

describe('dispatchConfirmBody', () => {
  it('names the target repo, the base branch and the draft PR', () => {
    const body = dispatchConfirmBody({
      repoUrl: 'https://github.com/kensaurus/mushi-mushi',
      baseBranch: 'master',
    })
    expect(body).toContain('kensaurus/mushi-mushi')
    expect(body).toContain('the master branch')
    expect(body).toContain('opens a draft PR')
    expect(body).toContain('LLM budget')
  })

  it('stays honest when the repo or branch is unknown', () => {
    const body = dispatchConfirmBody({ repoUrl: null, baseBranch: null })
    expect(body).toContain('the connected repo')
    expect(body).toContain('its default branch')
  })

  it('reduces repo URLs to a short name', () => {
    expect(dispatchConfirmBody({ repoUrl: 'https://github.com/acme/shop.git', baseBranch: 'main' })).toContain(
      'on acme/shop against',
    )
    expect(dispatchConfirmBody({ repoUrl: 'https://gitlab.example.com/acme/shop', baseBranch: 'main' })).toContain(
      'on gitlab.example.com/acme/shop against',
    )
  })
})

describe('dispatchBlock (one gate for every dispatch control, #19)', () => {
  const ready = { loading: false, ready: true, failing: [] }
  it('blocks fixed and dismissed reports', () => {
    expect(dispatchBlock({ report: { status: 'fixed' }, preflight: ready }).blocked).toBe(true)
    expect(dispatchBlock({ report: { status: 'dismissed' }, preflight: ready }).reason).toMatch(/dismissed/)
  })
  it('blocks a feature request until it is re-categorized', () => {
    const r = dispatchBlock({ report: { status: 'new', user_category: 'feature', category: 'other' }, preflight: ready })
    expect(r.reason).toMatch(/Feature request/)
  })
  it('blocks on failing preflight and names what is missing', () => {
    const r = dispatchBlock({
      report: { status: 'new' },
      preflight: { loading: false, ready: false, failing: [{ label: 'Autofix enabled' }] },
    })
    expect(r).toEqual({ blocked: true, reason: 'Set up first: Autofix enabled.' })
  })
  it('blocks without a reason while a dispatch is in flight, and allows otherwise', () => {
    expect(dispatchBlock({ report: { status: 'new' }, preflight: ready, busy: true })).toEqual({ blocked: true, reason: null })
    expect(dispatchBlock({ report: { status: 'classified' }, preflight: ready })).toEqual({ blocked: false, reason: null })
    // Preflight still loading never blocks on its own.
    expect(dispatchBlock({ report: { status: 'new' }, preflight: { loading: true, ready: false, failing: [] } }).blocked).toBe(false)
  })
})

describe('dispatchErrorText (#86)', () => {
  it('never shows the error code', () => {
    for (const code of ['AUTOFIX_DISABLED', 'FEATURE_REQUEST', 'ALREADY_DISPATCHED', 'DISPATCH_FAILED', undefined]) {
      const text = dispatchErrorText({ code, message: 'Enable Autofix in project settings first' })
      expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]+/)
    }
    expect(dispatchErrorText({ code: 'AUTOFIX_DISABLED' })).toMatch(/Auto-fix is off/)
  })
})
