/**
 * Locks the replacements for the dead links found by the 2026-10-23 crawl
 * of kensaur.us/mushi-mushi, plus the testers share image that crawl 404'd.
 * Run with `pnpm test:scripts`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const DEAD = [
  'https://firecrawl.dev/privacy)',
  'https://kit.svelte.dev/docs/migrating-to-sveltekit',
  'https://www.herodevs.com/support/vue-2-nes',
  'https://docs.logrocket.com/reference/session-url',
  'https://github.com/users/kensaurus/projects/1',
  '../../../../docs/research/tester-marketplace-research-2026-05-22.md',
]

/** Page source and its generated Markdown twin. */
const PAGES = [
  ['apps/docs/content/admin/research.mdx', 'apps/docs/public/llm-md/admin/research.md'],
  ['apps/docs/content/concepts/bounty-marketplace.mdx', 'apps/docs/public/llm-md/concepts/bounty-marketplace.md'],
  ['apps/docs/content/migrations/spa-to-ssr.mdx', 'apps/docs/public/llm-md/migrations/spa-to-ssr.md'],
  ['apps/docs/content/migrations/vue-2-to-vue-3.mdx', 'apps/docs/public/llm-md/migrations/vue-2-to-vue-3.md'],
  ['apps/docs/content/migrations/logrocket-feedback-to-mushi.mdx', 'apps/docs/public/llm-md/migrations/logrocket-feedback-to-mushi.md'],
  ['apps/docs/content/roadmap.mdx', 'apps/docs/public/llm-md/roadmap.md'],
]

const LIVE = {
  'apps/docs/content/admin/research.mdx': 'https://www.firecrawl.dev/privacy-policy',
  'apps/docs/content/concepts/bounty-marketplace.mdx':
    'https://github.com/kensaurus/mushi-mushi/blob/master/docs/research/tester-marketplace-research-2026-05-22.md',
  'apps/docs/content/migrations/spa-to-ssr.mdx': 'https://svelte.dev/docs/kit/creating-a-project',
  'apps/docs/content/migrations/vue-2-to-vue-3.mdx': 'https://www.herodevs.com/support/nes-vue',
  'apps/docs/content/migrations/logrocket-feedback-to-mushi.mdx':
    'https://docs.logrocket.com/reference/get-session-url',
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

test('crawled docs pages no longer link the dead URLs', () => {
  for (const [mdx, twin] of PAGES) {
    for (const rel of [mdx, twin]) {
      const text = read(rel)
      for (const dead of DEAD) {
        assert.equal(text.includes(dead), false, `${rel} still contains ${dead}`)
      }
    }
  }
})

test('each crawled page links the live replacement', () => {
  for (const [rel, url] of Object.entries(LIVE)) {
    const text = read(rel)
    const count = text.split(url).length - 1
    assert.ok(count >= 1, `${rel} is missing ${url}`)
  }
  // The SPA guide names the SvelteKit docs twice (intro and references).
  const spa = read('apps/docs/content/migrations/spa-to-ssr.mdx')
  assert.equal(spa.split('https://svelte.dev/docs/kit/creating-a-project').length - 1, 2)
})

test('testers og:image file is the 1200×630 card the layout advertises', () => {
  const testers = readFileSync(join(ROOT, 'apps/testers/public/og-card.png'))
  const docs = readFileSync(join(ROOT, 'apps/docs/public/social-preview/og-card.png'))
  const source = readFileSync(join(ROOT, 'docs/social-preview/og-card.png'))
  assert.deepEqual(testers, source)
  assert.deepEqual(docs, source)
  assert.equal(testers.subarray(1, 4).toString('ascii'), 'PNG')
  assert.equal(testers.readUInt32BE(16), 1200)
  assert.equal(testers.readUInt32BE(20), 630)
  const layout = read('apps/testers/app/layout.tsx')
  assert.match(layout, /\$\{SITE\}\/og-card\.png/)
})
