/**
 * FILE: apps/admin/src/lib/integrationOAuthReturn.test.ts
 * PURPOSE: Every OAuth / install return lands as one plain-English toast.
 *          Slack's `slack_connected` / `slack_error` used to be ignored.
 */
import { describe, expect, it } from 'vitest'
import { readIntegrationOAuthReturn } from './integrationOAuthReturn'

describe('readIntegrationOAuthReturn', () => {
  it('ignores a URL with no return params', () => {
    expect(readIntegrationOAuthReturn('?project=abc')).toBeNull()
  })

  it('confirms a Slack install', () => {
    const r = readIntegrationOAuthReturn('?slack_connected=1&project=abc')
    expect(r?.toast.tone).toBe('success')
    expect(r?.toast.title).toMatch(/Slack connected/)
    expect(r?.consumedKeys).toEqual(['slack_connected'])
  })

  it('explains a cancelled Slack install and what to do', () => {
    const r = readIntegrationOAuthReturn('?slack_error=access_denied')
    expect(r?.toast.tone).toBe('error')
    expect(r?.toast.description).toMatch(/cancelled/)
    expect(r?.toast.description).toMatch(/Add to Slack/)
    expect(r?.consumedKeys).toEqual(['slack_error'])
  })

  it('never shows a raw Slack reason', () => {
    const r = readIntegrationOAuthReturn(`?slack_error=${encodeURIComponent('Error: weird_internal_code')}`)
    expect(r?.toast.description).not.toMatch(/weird_internal_code/)
  })

  it('covers a token that could not be saved', () => {
    expect(readIntegrationOAuthReturn('?slack_error=token_not_saved')?.toast.description).toMatch(/could not save/)
  })

  it('keeps GitHub and Linear results', () => {
    expect(readIntegrationOAuthReturn('?github_connected=1&installation_id=9')?.consumedKeys).toEqual([
      'github_connected',
      'installation_id',
    ])
    expect(readIntegrationOAuthReturn('?connected=linear')?.toast.tone).toBe('success')
    const linear = readIntegrationOAuthReturn(`?linear_error=${encodeURIComponent('Token exchange failed (HTTP 400)')}`)
    expect(linear?.toast.description).not.toMatch(/HTTP 400/)
  })
})
