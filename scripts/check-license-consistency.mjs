#!/usr/bin/env node
/**
 * check-license-consistency.mjs
 *
 * Anti-drift guard for the license split. Ensures primary surfaces agree with
 * packages/server/LICENSE (AGPLv3), that the root LICENSE names the split
 * instead of reading as MIT-everything, and that we never silently regress to
 * "Apache-2.0 server" copy left over from a rejected relicense attempt.
 *
 * Run: node scripts/check-license-consistency.mjs
 * Exit 0 = consistent. Exit 1 = drift (actionable list on stderr).
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dir, '..')

const failures = []

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8')
  } catch {
    failures.push(`MISSING FILE  ${rel}`)
    return null
  }
}

const serverLicense = read('packages/server/LICENSE')
const serverIsAgpl =
  serverLicense?.includes('GNU AFFERO GENERAL PUBLIC LICENSE') &&
  serverLicense?.includes('SPDX-License-Identifier: AGPL-3.0-only')
const serverIsApache = serverLicense?.includes('Apache License') && serverLicense?.includes('Version 2.0')

if (!serverIsAgpl) {
  failures.push(
    'packages/server/LICENSE must be AGPLv3 (GNU AFFERO GENERAL PUBLIC LICENSE + SPDX AGPL-3.0-only)',
  )
}
if (serverIsApache) {
  failures.push('packages/server/LICENSE must NOT be Apache-2.0 — server stays AGPLv3')
}

const expectedBadge = serverIsAgpl ? 'AGPL--3.0' : 'Apache--2.0'
const expectedLabel = serverIsAgpl ? 'AGPLv3' : 'Apache-2.0'

const readme = read('README.md')
if (readme) {
  if (!readme.includes(`server-${expectedBadge}`)) {
    failures.push(
      `README.md server badge must be server-${expectedBadge} (matches packages/server/LICENSE)`,
    )
  }
  if (serverIsAgpl && /server Apache-2\.0|Apache-2\.0 \(server\)/i.test(readme)) {
    failures.push('README.md still describes server as Apache-2.0 — should be AGPLv3 + commercial dual-license')
  }
  if (serverIsAgpl && !readme.includes('COMMERCIAL-LICENSE.md')) {
    failures.push('README.md license section should link to COMMERCIAL-LICENSE.md for dual licensing')
  }
}

// The root LICENSE is what GitHub reports as the repo's license, and what
// answer engines quote. Bare MIT there made the AGPL server and the commercial
// ee/ read as MIT, so it must name the split before the MIT text.
const rootLicense = read('LICENSE')
if (rootLicense && serverIsAgpl) {
  const mitAt = rootLicense.indexOf('MIT License')
  if (mitAt === -1) {
    failures.push('LICENSE (root) must still carry the MIT License text after the license split')
  }
  const carveOut = [
    'packages/server/ee/LICENSE',
    'packages/server/',
    'packages/agents/',
    'packages/verify/',
    'AGPL-3.0-only',
    'COMMERCIAL-LICENSE.md',
  ]
  for (const needle of carveOut) {
    const at = rootLicense.indexOf(needle)
    if (at === -1) {
      failures.push(`LICENSE (root) must describe the license split before the MIT text — missing "${needle}"`)
    } else if (mitAt !== -1 && at > mitAt) {
      failures.push(`LICENSE (root) must name "${needle}" before the MIT text, not after it`)
    }
  }
}

const brandSrc = read('packages/brand/src/index.js')
if (brandSrc && serverIsAgpl) {
  if (!brandSrc.includes('AGPLv3') && brandSrc.includes('Apache-2.0')) {
    failures.push('packages/brand/src/index.js MUSHI_OSS.license must say AGPLv3, not Apache-2.0')
  }
}

const openSourceMdx = read('apps/docs/content/concepts/open-source.mdx')
if (openSourceMdx && serverIsAgpl) {
  if (openSourceMdx.includes('Apache-2.0') && openSourceMdx.includes('server')) {
    failures.push('apps/docs/content/concepts/open-source.mdx still says Apache-2.0 for server')
  }
  if (!openSourceMdx.includes('AGPL')) {
    failures.push('apps/docs/content/concepts/open-source.mdx must mention AGPLv3 for server packages')
  }
}

const blogAgpl = read('apps/docs/content/blog/agplv3-relicense.mdx')
if (blogAgpl?.includes('Superseded') && blogAgpl.includes('Apache-2.0')) {
  failures.push(
    'apps/docs/content/blog/agplv3-relicense.mdx still has superseded→Apache callout — remove it',
  )
}

if (failures.length === 0) {
  console.log(
    `\u2713  License consistency: server is ${expectedLabel}, badges and primary docs agree.`,
  )
  process.exit(0)
}

console.error('License drift detected — fix against packages/server/LICENSE:\n')
for (const f of failures) console.error(`FAIL  ${f}\n`)
process.exit(1)
