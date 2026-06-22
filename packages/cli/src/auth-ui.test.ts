/**
 * FILE: packages/cli/src/auth-ui.test.ts
 * PURPOSE: Unit tests for the anti-paste auth banner helpers in auth-ui.ts.
 *
 * OVERVIEW:
 *   Verifies that printAuthBanner/printAuthApproved/printAuthFailed write the
 *   correct lines to console.log/console.error, including the critical
 *   "do NOT" anti-paste message and the verification code + URL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { printAuthApproved, printAuthBanner, printAuthFailed } from './auth-ui.js'

let logs: string[]
let errors: string[]

beforeEach(() => {
  logs = []
  errors = []
  vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(String(args[0] ?? '')))
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(String(args[0] ?? '')))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('printAuthBanner', () => {
  const CODE = 'TGKX-PBXP'
  const URL = 'https://example.com/admin/cli-auth?code=TGKX-PBXP'

  it('includes the verification code in the output', () => {
    printAuthBanner(CODE, URL)
    const all = logs.join('\n')
    expect(all).toContain(CODE)
  })

  it('includes the verification URL', () => {
    printAuthBanner(CODE, URL)
    const all = logs.join('\n')
    expect(all).toContain(URL.slice(0, 51))
  })

  it('contains an explicit anti-paste guard', () => {
    printAuthBanner(CODE, URL)
    const all = logs.join('\n')
    // Must warn against pasting/typing in the terminal
    expect(all.toLowerCase()).toMatch(/do not (paste|type)/i)
  })

  it('includes a "waiting" message to indicate the terminal is polling', () => {
    printAuthBanner(CODE, URL)
    const all = logs.join('\n')
    expect(all.toLowerCase()).toMatch(/waiting/i)
  })

  it('includes the 3-step guide', () => {
    printAuthBanner(CODE, URL)
    const all = logs.join('\n')
    expect(all).toContain('1.')
    expect(all).toContain('2.')
    expect(all).toContain('3.')
  })
})

describe('printAuthApproved', () => {
  it('outputs an affirmative approval line', () => {
    printAuthApproved()
    const all = logs.join('\n')
    expect(all).toMatch(/approved|approved/i)
  })
})

describe('printAuthFailed', () => {
  it('outputs a denial message for "denied" reason', () => {
    printAuthFailed('denied')
    const all = errors.join('\n')
    expect(all.toLowerCase()).toMatch(/denied/)
  })

  it('outputs a timeout message for "timeout" reason', () => {
    printAuthFailed('timeout')
    const all = errors.join('\n')
    expect(all.toLowerCase()).toMatch(/timed out|timeout/i)
  })

  it('includes the detail string for "error" reason', () => {
    printAuthFailed('error', 'network unavailable')
    const all = errors.join('\n')
    expect(all).toContain('network unavailable')
  })
})
