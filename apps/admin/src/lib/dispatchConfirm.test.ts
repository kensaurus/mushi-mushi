import { describe, expect, it } from 'vitest'
import { dispatchConfirmBody, featureRequestDispatchBlock } from './dispatchConfirm'

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
