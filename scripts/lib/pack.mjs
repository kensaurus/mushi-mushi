/**
 * FILE: scripts/lib/pack.mjs
 * PURPOSE: Pack a workspace package the way the release does (`pnpm pack`,
 *          which rewrites workspace: ranges) and read a tarball's sizes
 *          without shelling out to tar.
 */

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/**
 * `pnpm pack` a package directory into `dest` and return the tarball path.
 * @param {string} pkgDir
 * @param {string} dest
 */
export function packPackage(pkgDir, dest) {
  // A single command string through the shell: on Windows pnpm is a .cmd shim
  // that execFile cannot start, and passing an args array with `shell: true`
  // is deprecated (DEP0190). Temp paths contain no quotes.
  const out = execSync(`pnpm pack --pack-destination "${dest.replace(/\\/g, '/')}"`, {
    cwd: pkgDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  const line = out
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.endsWith('.tgz'))
  if (!line) throw new Error(`pnpm pack in ${pkgDir} did not print a tarball path:\n${out}`)
  return line
}

/**
 * Sizes of a .tgz: `packed` is the file on disk (what npm downloads),
 * `unpacked` the sum of regular-file sizes inside (what lands in node_modules,
 * the number npm shows as "unpacked size").
 * @param {Buffer} gz gzip-compressed tar bytes
 * @returns {{ packed: number, unpacked: number, files: number }}
 */
function tarballSizes(gz) {
  const tar = gunzipSync(gz)
  let offset = 0
  let unpacked = 0
  let files = 0
  let paxSize = null
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const sizeField = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim()
    let size = sizeField ? parseInt(sizeField, 8) : 0
    const type = String.fromCharCode(header[156] || 48)
    const dataStart = offset + 512
    if (type === 'x') {
      // PAX extended header: a `size=` record overrides the next entry's size.
      const pax = tar.subarray(dataStart, dataStart + size).toString('utf8')
      const m = pax.match(/\d+ size=(\d+)\n/)
      paxSize = m ? Number(m[1]) : null
    } else {
      if (paxSize !== null) {
        size = paxSize
        paxSize = null
      }
      if (type === '0' || type === '\0') {
        unpacked += size
        files++
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return { packed: gz.length, unpacked, files }
}

/**
 * Unpack the regular files of a .tgz under `dest` (npm tarballs: ustar with
 * optional PAX headers). Refuses absolute paths and `..` segments. Returns
 * the extracted paths, tarball-relative (`package/…`).
 * @param {Buffer} gz
 * @param {string} dest
 */
export function extractTarball(gz, dest) {
  const tar = gunzipSync(gz)
  const written = []
  let offset = 0
  let pax = {}
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '')
    let size = parseInt(field(124, 12).trim() || '0', 8)
    const type = String.fromCharCode(header[156] || 48)
    const dataStart = offset + 512
    if (type === 'x') {
      const records = tar.subarray(dataStart, dataStart + size).toString('utf8')
      pax = Object.fromEntries([...records.matchAll(/\d+ ([^=]+)=([^\n]*)\n/g)].map((m) => [m[1], m[2]]))
      offset = dataStart + Math.ceil(size / 512) * 512
      continue
    }
    const prefix = field(345, 155)
    let path = pax.path ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    if (pax.size !== undefined) size = Number(pax.size)
    pax = {}
    if (type === '0' || type === '\0') {
      path = path.replace(/\\/g, '/')
      if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
        throw new Error(`refusing to extract unsafe tar path: ${path}`)
      }
      const target = join(dest, ...path.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, tar.subarray(dataStart, dataStart + size))
      written.push(path)
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return written
}

/** tarballSizes for a file on disk. */
export function tarballFileSizes(path) {
  const sizes = tarballSizes(readFileSync(path))
  return { ...sizes, packed: statSync(path).size }
}
