// SPDX-License-Identifier: MIT
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { literalPattern, parseStdinRequest, readStdin, syncsToConsole } from './fresh-eyes-request.js'
import { runFreshEyes } from './fresh-eyes.js'

const req = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ runId: '20261028-090000-ab12', url: 'https://glot.it/', goal: 'sign up and pick a language', sessions: 3, successText: null, dryRun: true, accounts: [], ...over })

describe('a queued run on stdin (ADR 0053 amendment)', () => {
  it('reads the run the console queued', () => {
    expect(parseStdinRequest(req())).toEqual({ runId: '20261028-090000-ab12', url: 'https://glot.it/', goal: 'sign up and pick a language', sessions: 3, successText: null, dryRun: true, accounts: [] })
  })

  it('refuses anything that is not a run', () => {
    for (const bad of ['not json', req({ runId: '../x' }), req({ url: 'file:///etc/passwd' }), req({ goal: '' }), req({ sessions: 11 }), req({ dryRun: 'no' }), req({ successText: 'a\u0000b' })]) {
      expect(() => parseStdinRequest(bad), bad).toThrow()
    }
  })

  it('takes test accounts only for a run that signs up', () => {
    const acct = { email: 'fresh-eyes-abc@synthetic.kensaur.us', password: 'aB3dE6gH9jK2-9a', name: 'Fresh Eyes' }
    expect(parseStdinRequest(req({ dryRun: false, accounts: [acct] })).accounts).toEqual([acct])
    expect(() => parseStdinRequest(req({ dryRun: true, accounts: [acct] }))).toThrow(/no account/)
    expect(() => parseStdinRequest(req({ dryRun: false, accounts: [{ ...acct, password: 'x' }] }))).toThrow(/malformed/)
  })

  it('matches the success words as written, never as a pattern', () => {
    const p = literalPattern('Done (100%)? yes.')
    expect(new RegExp(p, 'i').test('done (100%)? yes.')).toBe(true)
    expect(new RegExp(p, 'i').test('Done 100 yes!')).toBe(false)
  })

  it('reads all of stdin, and refuses a huge one', async () => {
    expect(await readStdin(Readable.from([Buffer.from('{"a":'), Buffer.from('1}')]))).toBe('{"a":1}')
    await expect(readStdin(Readable.from([Buffer.alloc(70 * 1024)]))).rejects.toThrow(/too large/)
  })

  it('a dry run still shows in the console when asked to sync (the console waits for it)', () => {
    expect(syncsToConsole({ sync: true }, true)).toBe(true)
    expect(syncsToConsole({ file: true }, true)).toBe(true)
    expect(syncsToConsole({ sync: true }, false)).toBe(false)
    expect(syncsToConsole({}, true)).toBe(false)
  })

  it("refuses a run id that is not the console's format before it opens a browser", async () => {
    await expect(runFreshEyes({ url: 'https://glot.it/', goal: 'x', success: {}, runId: '../../etc', session: async () => { throw new Error('no browser') } })).rejects.toThrow(/Bad run id/)
  })
})
