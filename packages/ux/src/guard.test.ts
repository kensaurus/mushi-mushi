// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { isDestructiveLabel, isRequestAllowed } from './guard.js'

describe('isRequestAllowed', () => {
  it('lets reads through and blocks writes by default', () => {
    expect(isRequestAllowed('GET', 'http://localhost:3000/api/items', [])).toBe(true)
    expect(isRequestAllowed('OPTIONS', 'http://localhost:3000/api/items', [])).toBe(true)
    expect(isRequestAllowed('POST', 'http://localhost:3000/api/items', [])).toBe(false)
    expect(isRequestAllowed('DELETE', 'http://localhost:3000/api/items/1', [])).toBe(false)
    expect(isRequestAllowed('PATCH', 'http://localhost:3000/api/items/1', [])).toBe(false)
  })

  it('honours method-scoped and any-method allow rules', () => {
    const allow = ['POST /rest/v1/rpc/*', '/graphql']
    expect(isRequestAllowed('POST', 'https://x.supabase.co/rest/v1/rpc/get_stats', allow)).toBe(true)
    expect(isRequestAllowed('DELETE', 'https://x.supabase.co/rest/v1/rpc/get_stats', allow)).toBe(false)
    expect(isRequestAllowed('POST', 'http://localhost/graphql', allow)).toBe(true)
    expect(isRequestAllowed('POST', 'http://localhost/graphql/mutate', allow)).toBe(false)
  })

  it('blocks a write it cannot parse', () => {
    expect(isRequestAllowed('POST', 'not a url', ['*'])).toBe(false)
  })
})

describe('isDestructiveLabel', () => {
  it.each(['Delete account', 'Remove repo', 'Log out', 'Sign out', 'Pay now', 'Send invite', 'Merge PR', 'Submit'])(
    'refuses %s',
    (label) => expect(isDestructiveLabel(label)).toBe(true),
  )
  it.each(['Details', 'Invite people', 'Settings', 'Open menu', 'Overview'])('allows %s', (label) =>
    expect(isDestructiveLabel(label)).toBe(false),
  )
})
