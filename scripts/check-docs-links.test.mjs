/**
 * FILE: scripts/check-docs-links.test.mjs
 * PURPOSE: Relative docs links must stay inside the published content tree.
 *          A link that climbs to another repo file 404s on kensaur.us.
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
