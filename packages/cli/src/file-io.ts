/**
 * FILE: packages/cli/src/file-io.ts
 * PURPOSE: Local file reads and writes for commands that take a path from the
 *          user. A read opens the file once and checks and reads that open
 *          file, so nothing can swap the path between the check and the read.
 *          A write goes only to the path the user named, with text of a
 *          bounded size.
 */

import { closeSync, fstatSync, openSync, readSync, writeFileSync } from 'node:fs'
import { MushiCliError } from './errors.js'

export type CappedRead =
  | { kind: 'absent' }
  | { kind: 'too_large'; size: number }
  | { kind: 'file'; text: string }

const CHUNK_BYTES = 64 * 1024

/**
 * The UTF-8 text of the regular file at `path`, or why there is none: it
 * cannot be opened or is not a regular file (`absent`), or it is over
 * `maxBytes` (`too_large`), including when it grows while being read.
 */
export function readTextFileCapped(path: string, maxBytes: number): CappedRead {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    // ENOENT, EACCES, and on Windows EISDIR/EPERM for a directory.
    return { kind: 'absent' }
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) return { kind: 'absent' }
    if (stat.size > maxBytes) return { kind: 'too_large', size: stat.size }
    const chunks: Buffer[] = []
    const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, maxBytes + 1))
    let total = 0
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null)
      if (read === 0) break
      total += read
      if (total > maxBytes) return { kind: 'too_large', size: total }
      chunks.push(Buffer.from(chunk.subarray(0, read)))
    }
    return { kind: 'file', text: Buffer.concat(chunks).toString('utf8') }
  } finally {
    closeSync(fd)
  }
}

/**
 * Write a downloaded export to the path the user passed with `--out`. This is
 * the feature (the user asked for the file), so the data is expected to come
 * from the API; it is checked to be text under `maxBytes` and goes nowhere
 * but `path`. `mode` applies when the file is created.
 */
export function writeUserOutputFile(path: string, text: unknown, opts: { maxBytes: number; mode?: number }): void {
  if (typeof text !== 'string') {
    throw new MushiCliError('E_API_ERROR', 'The server sent something other than text, so nothing was written.')
  }
  if (Buffer.byteLength(text, 'utf8') > opts.maxBytes) {
    throw new MushiCliError('E_API_ERROR', `The server sent more than ${Math.round(opts.maxBytes / (1024 * 1024))} MB, so nothing was written.`)
  }
  try {
    writeFileSync(path, text, { encoding: 'utf8', mode: opts.mode ?? 0o644 })
  } catch (err) {
    throw new MushiCliError('E_FILE_PERMISSION', `Could not write ${path}`, 'pick a path you can write to', err)
  }
}
