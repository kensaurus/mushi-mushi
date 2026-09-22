/**
 * Tests for scripts/normalize-package-metadata.mjs — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUSHI_TAGLINE_LEGACY, MUSHI_TAGLINE_V2 } from '../packages/brand/src/index.js'
import {
  BANNED_KEYWORDS,
  CANONICAL_AUTHOR,
  DESCRIPTION_HARD_MAX,
  NODE_ENGINE,
  NPM_PITCH,
  PRIMARY_DESCRIPTION_MAX,
  PRIMARY_ROLES,
  REQUIRED_KEYWORDS,
  normalizeManifest,
  primaryDescription,
} from './normalize-package-metadata.mjs'

function legacyManifest(overrides = {}) {
  return {
    name: '@mushi-mushi/plugin-example',
    version: '0.1.0',
    description: 'Mushi Mushi plugin for Example â€” mirrors reports.',
    author: 'Kenji Sakuramoto (https://bsky.app/profile/mushimushi.dev)',
    homepage: 'https://example.invalid',
    repository: { type: 'git', url: 'https://github.com/kensaurus/mushi-mushi.git' },
    keywords: ['mushi-mushi', 'sentry-alternative', 'plugin'],
    engines: { node: '>=20' },
    ...overrides,
  }
}

test('the npm pitch is composed from the brand SSOT, not hand-written', () => {
  assert.equal(
    NPM_PITCH,
    'The bug mediator for AI-built apps: plain-English diagnosis + a ready fix, in your editor.',
  )
  assert.equal(NPM_PITCH, MUSHI_TAGLINE_V2.pitch)
  assert.ok(NPM_PITCH.startsWith(`${MUSHI_TAGLINE_V2.category}: `))
  assert.ok(NPM_PITCH.toLowerCase().includes(MUSHI_TAGLINE_V2.promise.toLowerCase()))
  // The one-liner and the npm cards share the same promise text.
  assert.ok(MUSHI_TAGLINE_V2.oneLiner.includes(MUSHI_TAGLINE_V2.promise))
})

test('every primary description fits a search card and carries the pitch', () => {
  for (const name of Object.keys(PRIMARY_ROLES)) {
    const d = primaryDescription(name)
    assert.ok(d.length <= PRIMARY_DESCRIPTION_MAX, `${name}: ${d.length} chars`)
    assert.ok(d.endsWith(NPM_PITCH), name)
    for (const legacy of [MUSHI_TAGLINE_LEGACY.full, MUSHI_TAGLINE_LEGACY.short]) {
      assert.ok(!d.includes(legacy), name)
    }
  }
  assert.equal(primaryDescription('@mushi-mushi/plugin-example'), undefined)
})

test('a legacy manifest is fully normalized', () => {
  const input = legacyManifest()
  const { json, changes, errors } = normalizeManifest(input, 'plugin-example')

  assert.deepEqual(errors, [])
  assert.equal(json.author, CANONICAL_AUTHOR)
  assert.ok(!json.author.includes('mushimushi.dev'))
  assert.equal(json.engines.node, NODE_ENGINE)
  assert.deepEqual(json.repository, {
    type: 'git',
    url: 'https://github.com/kensaurus/mushi-mushi.git',
    directory: 'packages/plugin-example',
  })
  for (const banned of BANNED_KEYWORDS) assert.ok(!json.keywords.includes(banned))
  // Role-specific text is kept; only the mis-encoded dash is repaired.
  assert.equal(json.description, 'Mushi Mushi plugin for Example — mirrors reports.')
  assert.ok(changes.includes('author'))
  assert.ok(changes.includes('engines.node'))
  // Pure: the input object is untouched.
  assert.equal(input.author, 'Kenji Sakuramoto (https://bsky.app/profile/mushimushi.dev)')
})

test('primary packages get the brand description and required keywords', () => {
  const { json, changes, errors } = normalizeManifest(
    legacyManifest({
      name: 'mushi-mushi',
      description: 'x'.repeat(423),
      keywords: ['mushi-mushi', 'sentry-alternative'],
    }),
    'launcher',
  )
  assert.deepEqual(errors, [])
  assert.equal(json.description, primaryDescription('mushi-mushi'))
  assert.deepEqual(json.keywords, ['mushi-mushi', ...REQUIRED_KEYWORDS['mushi-mushi']])
  assert.ok(changes.includes('description (brand pitch)'))
  assert.ok(changes.includes('keywords (required)'))
})

test('normalizing twice is a no-op', () => {
  const once = normalizeManifest(legacyManifest(), 'plugin-example').json
  const twice = normalizeManifest(once, 'plugin-example')
  assert.deepEqual(twice.changes, [])
  assert.deepEqual(twice.json, once)
})

test('problems --write cannot fix are reported as errors', () => {
  const tooLong = normalizeManifest(
    legacyManifest({ description: 'y'.repeat(DESCRIPTION_HARD_MAX + 1) }),
    'plugin-example',
  )
  assert.equal(tooLong.errors.length, 1)
  assert.match(tooLong.errors[0], /255/)

  const legacy = normalizeManifest(
    legacyManifest({ description: `Example plugin. ${MUSHI_TAGLINE_LEGACY.full}` }),
    'plugin-example',
  )
  assert.equal(legacy.errors.length, 1)
  assert.match(legacy.errors[0], /legacy tagline/)

  const missing = normalizeManifest(legacyManifest({ description: undefined }), 'plugin-example')
  assert.deepEqual(missing.errors, ['description is missing'])
})

test('the check still runs when invoked through a symlink', (t) => {
  // Node resolves the entry module through links but leaves argv[1] as typed;
  // a guard that compares the two unresolved would skip main() and exit 0
  // having checked nothing.
  // A directory junction needs no privileges on Windows; elsewhere the type is
  // ignored and this is an ordinary directory symlink.
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'pkg-meta-link-'))
  const link = join(dir, 'scripts')
  try {
    try {
      symlinkSync(scriptsDir, link, 'junction')
    } catch (err) {
      t.skip(`directory links unavailable here (${err.code})`)
      return
    }
    const res = spawnSync(process.execPath, [join(link, 'normalize-package-metadata.mjs')], {
      encoding: 'utf8',
    })
    assert.match(`${res.stdout}${res.stderr}`, /package metadata|DRIFT|ERROR/)
  } finally {
    // Remove the link itself first so the recursive delete never walks into
    // the real scripts/ folder through it.
    try {
      unlinkSync(link)
    } catch {
      // already removed
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
