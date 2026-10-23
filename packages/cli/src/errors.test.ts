/**
 * FILE: packages/cli/src/errors.test.ts
 * PURPOSE: Unit tests for the structured CLI error class and for the
 *          stderr `printAndExit` actually writes. Lock down the error
 *          codes, hints, JSON shape, exit-code mapping, and the
 *          `error [E_*]:` / `  → fix:` lines that scripts grep on.
 *
 *          `printAndExit` also appends a JSON log line when `CI=true` or
 *          `MUSHI_CLI_JSON_LOG=1`. These tests clear both so the grep
 *          contract is what gets asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MushiCliError, printAndExit } from './errors.js'

/** Same hint `printAndExit` attaches when it wraps a non-MushiCliError. */
const DEBUG_HINT =
  'this is unexpected — re-run with MUSHI_DEBUG=1 and report at https://github.com/kensaurus/mushi-mushi/issues'

/** Thrown by the `process.exit` spy so a `never` function can be asserted. */
class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`)
  }
}

/**
 * Run `printAndExit` with stderr and `process.exit` replaced.
 * Returns the captured stderr text and the exit code.
 */
function capturePrint(err: unknown, asJson = false): { stderr: string; code: number } {
  const chunks: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  })
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new ExitSignal(Number(code ?? 0))
  })
  try {
    printAndExit(err, asJson)
  } catch (caught) {
    if (caught instanceof ExitSignal) return { stderr: chunks.join(''), code: caught.code }
    throw caught
  } finally {
    vi.restoreAllMocks()
  }
}

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

describe('printAndExit', () => {
  const saved = {
    CI: process.env.CI,
    MUSHI_CLI_JSON_LOG: process.env.MUSHI_CLI_JSON_LOG,
  }

  beforeEach(() => {
    delete process.env.CI
    delete process.env.MUSHI_CLI_JSON_LOG
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (saved.CI === undefined) delete process.env.CI
    else process.env.CI = saved.CI
    if (saved.MUSHI_CLI_JSON_LOG === undefined) delete process.env.MUSHI_CLI_JSON_LOG
    else process.env.MUSHI_CLI_JSON_LOG = saved.MUSHI_CLI_JSON_LOG
  })

  it('writes the error line and the fix hint, then exits with the mapped code', () => {
    const err = new MushiCliError('E_AUTH_MISSING', 'no key', 'run mushi init')
    const { stderr, code } = capturePrint(err)
    expect(stderr).toBe('error [E_AUTH_MISSING]: no key\n  → fix: run mushi init\n')
    expect(code).toBe(err.exitCode)
    expect(code).toBe(2)
  })

  it('writes only the error line when there is no hint', () => {
    const err = new MushiCliError('E_FILE_NOT_FOUND', 'missing')
    const { stderr, code } = capturePrint(err)
    expect(stderr).toBe('error [E_FILE_NOT_FOUND]: missing\n')
    expect(code).toBe(err.exitCode)
  })

  it('wraps a string as E_INTERNAL with the MUSHI_DEBUG hint', () => {
    const { stderr, code } = capturePrint('boom')
    expect(stderr).toBe(`error [E_INTERNAL]: boom\n  → fix: ${DEBUG_HINT}\n`)
    expect(code).toBe(1)
  })

  it('wraps a plain Error as E_INTERNAL with the MUSHI_DEBUG hint', () => {
    const { stderr, code } = capturePrint(new Error('disk failed'))
    expect(stderr).toBe(`error [E_INTERNAL]: disk failed\n  → fix: ${DEBUG_HINT}\n`)
    expect(code).toBe(1)
  })

  it('writes one JSON line from toJSON and exits with that code', () => {
    const err = new MushiCliError('E_NETWORK', 'down', 'check the endpoint')
    const { stderr, code } = capturePrint(err, true)
    expect(stderr).toBe(`${JSON.stringify(err.toJSON())}\n`)
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'E_NETWORK', message: 'down', hint: 'check the endpoint' },
    })
    expect(code).toBe(err.exitCode)
    expect(code).toBe(3)
  })

  it('json-encodes an unknown error as E_INTERNAL including the debug hint', () => {
    const { stderr, code } = capturePrint(new TypeError('nope'), true)
    expect(stderr.endsWith('\n')).toBe(true)
    expect(stderr.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'E_INTERNAL', message: 'nope', hint: DEBUG_HINT },
    })
    expect(code).toBe(1)
  })
})
