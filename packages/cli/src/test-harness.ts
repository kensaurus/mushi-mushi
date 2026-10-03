/**
 * FILE: packages/cli/src/test-harness.ts
 * PURPOSE: Test-only harness that runs one registered command group the way
 *          `mushi` would: a fresh Commander program, a stubbed `fetch` that
 *          records every request and answers from a script, captured
 *          stdout/stderr, and `process.exit` turned into a thrown value.
 *          Imported only by *.test.ts files; never part of the bundle.
 *
 *          Tests mock `./config.js` themselves (vi.mock is hoisted per file).
 */

import { Command, CommanderError } from 'commander'
import { vi } from 'vitest'
import { setGlobalOutputFormat } from './cli-shared.js'
import { MushiCliError } from './errors.js'

export const TEST_ENDPOINT = 'https://api.test/functions/v1/api'
export const TEST_PROJECT_ID = '11111111-2222-4333-8444-555555555555'
export const TEST_API_KEY = 'mushi_test_key_0123'
export const TEST_CONFIG = { apiKey: TEST_API_KEY, endpoint: TEST_ENDPOINT, projectId: TEST_PROJECT_ID }

export interface RecordedCall {
  /** Path after the endpoint, query included. */
  path: string
  method: string
  body: unknown
  headers: Record<string, string>
}

export interface ScriptedReply {
  status?: number
  body: unknown
}

export type Responder = (call: RecordedCall) => ScriptedReply

export interface CliRun {
  calls: RecordedCall[]
  stdout: string
  stderr: string
  /** process.exit(code) or process.exitCode; 0 when neither was set. */
  exitCode: number
  /** A MushiCliError the action threw (index.ts prints these via printAndExit). */
  error: MushiCliError | null
}

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`)
  }
}

/** Answer every request with `{ ok: true, data }`. */
export function okReply(data: unknown, extra: Record<string, unknown> = {}): ScriptedReply {
  return { body: { ok: true, data, ...extra } }
}

export function errorReply(status: number, code: string, message: string, extra: Record<string, unknown> = {}): ScriptedReply {
  return { status, body: { ok: false, error: { code, message, ...extra } } }
}

export async function runCli(
  register: (program: Command) => void,
  argv: string[],
  respond: Responder = () => okReply({}),
): Promise<CliRun> {
  const calls: RecordedCall[] = []
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  let error: MushiCliError | null = null

  setGlobalOutputFormat('text')
  const previousExitCode = process.exitCode
  process.exitCode = undefined

  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>))
    const call: RecordedCall = {
      path: String(url).startsWith(TEST_ENDPOINT) ? String(url).slice(TEST_ENDPOINT.length) : String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      body: typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined,
      headers,
    }
    calls.push(call)
    const reply = respond(call)
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout += `${args.map(String).join(' ')}\n`
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr += `${args.map(String).join(' ')}\n`
  })
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  })
  const errWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk)
    return true
  })
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new ExitSignal(Number(code ?? 0))
  })

  const program = new Command().name('mushi').exitOverride()
  program.configureOutput({
    writeOut: (s) => { stdout += s },
    writeErr: (s) => { stderr += s },
  })
  register(program)

  try {
    await program.parseAsync(['node', 'mushi', ...argv])
    exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0
  } catch (err) {
    if (err instanceof ExitSignal) exitCode = err.code
    else if (err instanceof MushiCliError) {
      error = err
      exitCode = err.exitCode
    } else if (err instanceof CommanderError) {
      exitCode = err.exitCode
      stderr += err.message
    } else {
      throw err
    }
  } finally {
    logSpy.mockRestore()
    errSpy.mockRestore()
    outSpy.mockRestore()
    errWriteSpy.mockRestore()
    exitSpy.mockRestore()
    vi.unstubAllGlobals()
    process.exitCode = previousExitCode
  }
  return { calls, stdout, stderr, exitCode, error }
}
