import { describe, expect, it } from 'vitest'
import { dispatchConfirmBody, shortRepoName } from './dispatchConfirm'

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
})

describe('shortRepoName', () => {
  it('reduces GitHub URLs to owner/repo', () => {
    expect(shortRepoName('https://github.com/acme/shop.git')).toBe('acme/shop')
    expect(shortRepoName('https://gitlab.example.com/acme/shop')).toBe('gitlab.example.com/acme/shop')
  })
})
