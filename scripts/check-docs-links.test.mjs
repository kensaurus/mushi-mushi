/**
 * FILE: scripts/check-docs-links.test.mjs
 * PURPOSE: Relative docs links must stay inside the published content tree.
 *          A link that climbs to another repo file 404s on kensaur.us.
 *          The public roadmap must not cite the private GitHub project, and
 *          the bounties share image the testers layout advertises must exist.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkDocsLinks, relativeLinkStaysInContent } from './check-docs-links.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BOUNTY = join(ROOT, 'apps/docs/content/concepts/bounty-marketplace.mdx')
const KNOWN_HOLES = join(ROOT, 'apps/docs/content/concepts/known-holes.mdx')
const DOSSIER =
  'https://github.com/kensaurus/mushi-mushi/blob/master/docs/research/tester-marketplace-research-2026-05-22.md'

test('a relative link that leaves apps/docs/content is not a published page', () => {
  assert.equal(
    relativeLinkStaysInContent(BOUNTY, '../../../../docs/research/tester-marketplace-research-2026-05-22.md'),
    false,
  )
  assert.equal(relativeLinkStaysInContent(KNOWN_HOLES, '../admin/verified-merge'), true)
  assert.equal(relativeLinkStaysInContent(KNOWN_HOLES, '../admin/verified-merge#gates'), true)
})

test('the bounty marketplace dossier links to the repo file', () => {
  const src = readFileSync(BOUNTY, 'utf8')
  assert.ok(src.includes(DOSSIER))
  assert.equal(src.includes('](../../../../docs/research/'), false)
})

test('published docs have no dead or escaping links', () => {
  assert.deepEqual(checkDocsLinks(), [])
})

const PRIVATE_PROJECT = 'https://github.com/users/kensaurus/projects/1'

test('the public roadmap does not link the private GitHub project', () => {
  for (const rel of [
    'apps/docs/content/roadmap.mdx',
    'apps/docs/public/llm-md/roadmap.md',
    'apps/docs/public/llms-full.txt',
  ]) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    assert.equal(text.includes(PRIVATE_PROJECT), false, `${rel} still links ${PRIVATE_PROJECT}`)
  }
  const roadmap = readFileSync(join(ROOT, 'apps/docs/content/roadmap.mdx'), 'utf8')
  assert.ok(roadmap.includes('https://github.com/kensaurus/mushi-mushi/issues'))
})

test('the testers share image is the 1200×630 card the layout advertises', () => {
  const card = readFileSync(join(ROOT, 'apps/testers/public/og-card.png'))
  const source = readFileSync(join(ROOT, 'docs/social-preview/og-card.png'))
  assert.deepEqual(card, source)
  assert.equal(card.subarray(1, 4).toString('ascii'), 'PNG')
  assert.equal(card.readUInt32BE(16), 1200)
  assert.equal(card.readUInt32BE(20), 630)
  const layout = readFileSync(join(ROOT, 'apps/testers/app/layout.tsx'), 'utf8')
  assert.match(layout, /\$\{SITE\}\/og-card\.png/)
  assert.match(layout, /width: 1200, height: 630/)
})
