#!/usr/bin/env node
/**
 * check-spine — verify a vendored KENSAURUS spine against its lock.
 *
 * SOURCE: kensaurus/yen-yen kensaurus-spine/check-spine.mjs, copied into
 * every consumer next to spine.lock.json. Node only, offline, no deps:
 *
 *   node <spine dir>/check-spine.mjs
 *
 * Exit 1 when any locked file is missing or its sha256 (LF-normalised)
 * differs from the lock — i.e. someone edited a vendored copy or the sync
 * was not run after the source changed. Fix by re-running
 * `node scripts/spine-sync.mjs` in kensaurus/yen-yen, never by editing here.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const lockPath = path.join(dir, 'spine.lock.json')

if (!existsSync(lockPath)) {
  console.error(`check-spine: ${lockPath} is missing`)
  process.exit(1)
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const problems = []
for (const [name, expected] of Object.entries(lock.files)) {
  const filePath = path.join(dir, name)
  if (!existsSync(filePath)) {
    problems.push(`${name}: missing`)
    continue
  }
  const actual = createHash('sha256')
    .update(readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
  if (actual !== expected) problems.push(`${name}: modified (sha256 mismatch)`)
}

if (problems.length > 0) {
  console.error(
    `check-spine: vendored spine v${lock.version} drifted from spine.lock.json — re-run node scripts/spine-sync.mjs in kensaurus/yen-yen`,
  )
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(
  `check-spine: ${Object.keys(lock.files).length} files match spine.lock.json (spine v${lock.version}, manifest v${lock.manifest.version} ${lock.manifest.updated})`,
)
