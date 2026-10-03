import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MushiCliError } from './errors.js'
import { readTextFileCapped, writeUserOutputFile } from './file-io.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mushi-file-io-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readTextFileCapped', () => {
  it('reads a regular file under the cap', () => {
    const p = join(dir, 'bill.csv')
    writeFileSync(p, 'date,service,cost\n2026-10-01,db,1.5\n')
    expect(readTextFileCapped(p, 1024)).toEqual({ kind: 'file', text: 'date,service,cost\n2026-10-01,db,1.5\n' })
  })

  it('is absent for a missing path and for a directory, without throwing', () => {
    expect(readTextFileCapped(join(dir, 'nope.csv'), 1024)).toEqual({ kind: 'absent' })
    const sub = join(dir, 'folder')
    mkdirSync(sub)
    expect(readTextFileCapped(sub, 1024)).toEqual({ kind: 'absent' })
  })

  it('is too_large over the cap, and reads exactly the cap', () => {
    const p = join(dir, 'big.csv')
    writeFileSync(p, 'x'.repeat(2048))
    expect(readTextFileCapped(p, 2047)).toEqual({ kind: 'too_large', size: 2048 })
    expect(readTextFileCapped(p, 2048)).toEqual({ kind: 'file', text: 'x'.repeat(2048) })
  })

  it('reads a file larger than one chunk', () => {
    const p = join(dir, 'chunks.txt')
    const body = 'ab'.repeat(100_000)
    writeFileSync(p, body)
    expect(readTextFileCapped(p, 1_000_000)).toEqual({ kind: 'file', text: body })
  })
})

describe('writeUserOutputFile', () => {
  it('writes the text to the named path only', () => {
    const out = join(dir, 'digest.txt')
    writeUserOutputFile(out, 'hello\n', { maxBytes: 1024 })
    expect(readFileSync(out, 'utf8')).toBe('hello\n')
    expect(readdirSync(dir)).toEqual(['digest.txt'])
  })

  it('refuses a body that is not text, or is over the cap, and writes nothing', () => {
    const out = join(dir, 'export.md')
    expect(() => writeUserOutputFile(out, { not: 'text' }, { maxBytes: 1024 })).toThrow(MushiCliError)
    expect(() => writeUserOutputFile(out, 'x'.repeat(2048), { maxBytes: 1024 })).toThrow(/nothing was written/)
    expect(readdirSync(dir)).toEqual([])
  })

  it('reports an unwritable path as a file permission error', () => {
    const out = join(dir, 'missing-folder', 'x.md')
    try {
      writeUserOutputFile(out, 'x', { maxBytes: 1024 })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(MushiCliError)
      expect((err as MushiCliError).code).toBe('E_FILE_PERMISSION')
    }
  })
})
