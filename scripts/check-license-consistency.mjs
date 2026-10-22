#!/usr/bin/env node
/**
 * check-license-consistency.mjs
 *
 * Anti-drift guard for the license split. Ensures primary surfaces agree with
 * packages/server/LICENSE (AGPLv3), that the root LICENSE names the split
 * instead of reading as MIT-everything, and that we never silently regress to
 * "Apache-2.0 server" copy left over from a rejected relicense attempt.
 *
 * Since ADR 0036 (docs/adr/0036-licensing-posture.md) it also checks:
 *   - TRADEMARK.md, NOTICE and CONTRIBUTING.md carry no BSL / Business Source
 *     wording (the server left BSL 1.1 in June 2026) and name the AGPL split;
 *   - TRADEMARK.md claims no registration and quotes the current hero tagline
 *     from packages/brand/src/index.js;
 *   - no license surface calls the console (apps/admin) MIT;
 *   - every AGPL LICENSE file says version 3 *only* (matching its SPDX
 *     AGPL-3.0-only) and the full text exists at LICENSES/AGPL-3.0-only.txt;
 *   - every "Copyright (c)" line in LICENSE files and NOTICE names the same
 *     holder;
 *   - every package.json "SEE LICENSE IN <file>" points at a file that exists.
 *
 * Run: node scripts/check-license-consistency.mjs
 * Exit 0 = consistent. Exit 1 = drift (actionable list on stderr).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
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
    'apps/admin/',
    'AGPL-3.0-only',
    'LICENSES/AGPL-3.0-only.txt',
    'COMMERCIAL-LICENSE.md',
    'TRADEMARK.md',
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

// ── ADR 0036 surfaces ─────────────────────────────────────────────────────
// The server moved off BSL 1.1 in June 2026; TRADEMARK.md kept saying BSL for
// months because nothing read it. These files state the license to people
// deciding whether they may fork, so they are checked like the README.
const BSL_RE = /\bBSL\b|Business Source License/i
const CONSOLE_MIT_RE = /(apps\/admin|admin console|\bconsole\b)[^\n]*\bMIT\b|\bMIT\b[^\n]*(apps\/admin|admin console)/i
const legalSurfaces = ['TRADEMARK.md', 'NOTICE', 'CONTRIBUTING.md', 'README.md', 'COMMERCIAL-LICENSE.md']
for (const rel of legalSurfaces) {
  const text = read(rel)
  if (!text) continue
  if (BSL_RE.test(text)) failures.push(`${rel} still mentions BSL / Business Source License — the server is AGPL-3.0-only`)
  if (serverIsAgpl && !/AGPL/.test(text)) failures.push(`${rel} must name the AGPL license for the server`)
  for (const line of text.split(/\r?\n/)) {
    if (CONSOLE_MIT_RE.test(line) && !/AGPL/.test(line)) {
      failures.push(`${rel} describes the console as MIT — apps/admin is AGPL-3.0-only (ADR 0036): "${line.trim().slice(0, 120)}"`)
    }
  }
}

const trademark = read('TRADEMARK.md')
if (trademark) {
  // Claiming a registration that has not issued is itself unlawful in Japan
  // and the US. "unregistered" / "not registered" are fine.
  if (/®/.test(trademark) || /(?<!un)registered trademarks?\b/i.test(trademark)) {
    failures.push('TRADEMARK.md claims a registered trademark (® or "registered trademark") — the marks are not registered')
  }
  const hero = brandSrc?.match(/\bhero:\s*'([^']+)'/)?.[1]
  if (!hero) failures.push('could not read MUSHI_TAGLINE_V2.hero from packages/brand/src/index.js')
  else if (!trademark.includes(hero)) failures.push(`TRADEMARK.md must quote the current hero tagline "${hero}" (packages/brand/src/index.js)`)
}

const contributing = read('CONTRIBUTING.md')
if (contributing && !contributing.includes('CLA.md')) {
  failures.push('CONTRIBUTING.md must link CLA.md (outside contributions come in under the CLA, ADR 0036)')
}
if (!existsSync(join(ROOT, 'CLA.md'))) failures.push('MISSING FILE  CLA.md')

// AGPL LICENSE files: "-only" in SPDX must match the grant text, and the full
// license text must ship in the repo (AGPL §4 asks for a copy of the License).
const agplText = read('LICENSES/AGPL-3.0-only.txt')
if (agplText && !agplText.trimStart().startsWith('GNU AFFERO GENERAL PUBLIC LICENSE')) {
  failures.push('LICENSES/AGPL-3.0-only.txt must be the verbatim AGPL-3.0 text')
}
for (const dir of ['packages/server', 'packages/agents', 'packages/verify', 'apps/admin', 'apps/testers']) {
  const text = read(`${dir}/LICENSE`)
  if (!text) continue
  if (!text.includes('SPDX-License-Identifier: AGPL-3.0-only')) failures.push(`${dir}/LICENSE must carry SPDX-License-Identifier: AGPL-3.0-only`)
  if (/any later version/i.test(text)) failures.push(`${dir}/LICENSE says "any later version" but its SPDX is AGPL-3.0-only — pick one (ADR 0036: version 3 only)`)
  if (!text.includes('LICENSES/AGPL-3.0-only.txt')) failures.push(`${dir}/LICENSE must point at LICENSES/AGPL-3.0-only.txt for the full text`)
}

// One copyright holder string across LICENSE files and NOTICE.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.turbo', '.next', 'out', 'build', 'LICENSES'])
function* walkFiles(dir, match) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let s
    try { s = statSync(full) } catch { continue }
    if (s.isDirectory()) yield* walkFiles(full, match)
    else if (match(entry)) yield full
  }
}
const holders = new Map()
const licenseFiles = [...walkFiles(ROOT, (name) => name === 'LICENSE'), join(ROOT, 'NOTICE')]
for (const file of licenseFiles) {
  if (!existsSync(file)) continue
  for (const m of readFileSync(file, 'utf8').matchAll(/^\s*Copyright \(c\) [0-9–-]+ (.+?)\.?\s*(?:All rights reserved\.)?\s*$/gm)) {
    const holder = m[1].trim()
    if (!holders.has(holder)) holders.set(holder, [])
    holders.get(holder).push(relative(ROOT, file))
  }
}
if (holders.size > 1) {
  const list = [...holders].map(([h, files]) => `"${h}" (${files.length}: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''})`)
  failures.push(`LICENSE files and NOTICE name ${holders.size} different copyright holders — use one: ${list.join('; ')}`)
}

// Every "SEE LICENSE IN <file>" must resolve, or npm and GitHub show no license.
for (const manifest of walkFiles(ROOT, (name) => name === 'package.json')) {
  let pkg
  try { pkg = JSON.parse(readFileSync(manifest, 'utf8')) } catch { continue }
  const m = typeof pkg.license === 'string' ? pkg.license.match(/^SEE LICENSE IN (.+)$/i) : null
  if (!m) continue
  const target = join(dirname(manifest), m[1].trim())
  if (!existsSync(target)) {
    failures.push(`${relative(ROOT, manifest)} says "${pkg.license}" but ${relative(ROOT, target)} does not exist`)
  }
}

if (failures.length === 0) {
  console.log(
    `\u2713  License consistency: server is ${expectedLabel}, badges, primary docs, TRADEMARK/NOTICE/CONTRIBUTING, copyright holder and SEE LICENSE targets agree.`,
  )
  process.exit(0)
}

console.error('License drift detected — fix against packages/server/LICENSE:\n')
for (const f of failures) console.error(`FAIL  ${f}\n`)
process.exit(1)
