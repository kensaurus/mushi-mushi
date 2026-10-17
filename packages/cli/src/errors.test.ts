/**
 * FILE: packages/cli/src/errors.test.ts
 * PURPOSE: Unit tests for the structured CLI error class. Lock down
 *          the error codes, hints, JSON shape and exit-code mapping that
 *          scripts grep on.
 */

import { describe, expect, it } from 'vitest'
import { MushiCliError } from './errors.js'

describe('MushiCliError', () => {
  it('embeds the code in toString via name + message', () => {
    const err = new MushiCliError('E_AUTH_MISSING', 'no key', 'run mushi init')
    expect(err.name).toBe('MushiCliError')
    expect(err.code).toBe('E_AUTH_MISSING')
    expect(err.hint).toBe('run mushi init')
  })

  it('omits the hint key entirely when none is provided', () => {
    const err = new MushiCliError('E_INTERNAL', 'unexpected')
    expect(err.toJSON()).toEqual({
      error: { code: 'E_INTERNAL', message: 'unexpected' },
    })
  })

  it('exposes the right exit code for each category', () => {
    expect(new MushiCliError('E_AUTH_MISSING', 'x').exitCode).toBe(2)
    expect(new MushiCliError('E_NETWORK', 'x').exitCode).toBe(3)
    expect(new MushiCliError('E_INTERRUPTED', 'x').exitCode).toBe(130)
    expect(new MushiCliError('E_FILE_NOT_FOUND', 'x').exitCode).toBe(1)
    expect(new MushiCliError('E_INTERNAL', 'x').exitCode).toBe(1)
  })

  it('toJSON includes the hint when provided', () => {
    const err = new MushiCliError('E_AUTH_INVALID', 'denied', 'rotate the key')
    expect(err.toJSON()).toEqual({
      error: {
        code: 'E_AUTH_INVALID',
        message: 'denied',
        hint: 'rotate the key',
      },
    })
  })
})
