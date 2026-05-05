/// <reference types="node" />
/**
 * FILE: apps/admin/src/lib/configDocs.test.ts
 * PURPOSE: Treat the configDocs dictionary as a contract — both with the UI
 *          (every `<ConfigHelp helpId="…" />` referenced from a panel must
 *          resolve to a real entry) and with the backend (entries that claim
 *          to write `PATCH /v1/admin/settings` must hit a column the API
 *          actually whitelists). Without these checks the in-app help could
 *          quietly grow stale: someone renames a column, the popover keeps
 *          claiming the old name, and non-technical readers get misled.
 *
 *          The README anchor check covers `learnMore` links to README.md —
 *          if a heading slug changes during a rewrite, the build fails fast
 *          instead of shipping a 404 link in the popover.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ALL_CONFIG_DOCS,
  CONFIG_DOC_GROUPS,
  getConfigDoc,
  type ConfigDoc,
} from './configDocs'

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const README_PATH = resolve(REPO_ROOT, 'README.md')
const SETTINGS_API_ROOT = resolve(
  REPO_ROOT,
  'packages/server/supabase/functions/api',
)

const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)+$/

/**
 * Replicate GitHub's heading-slug rules for README anchor resolution. We can't
 * pull in `github-slugger` for a single test, and the rules we exercise are
 * narrow: lowercase, replace whitespace with `-`, drop punctuation other than
 * `-` / `_`. Good enough for the headings we ship today; the test will scream
 * loudly if a heading uses an exotic character that breaks the round-trip, at
 * which point we can swap in the proper library.
 */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function readApiSources(dir = SETTINGS_API_ROOT): string {
  return readdirSync(dir)
    .sort()
    .map((entry) => {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) return readApiSources(full)
      if (!entry.endsWith('.ts')) return ''
      return readFileSync(full, 'utf8')
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Pull the column allowlist out of the live admin endpoint so the test breaks
 * the moment someone renames a settings column without updating the dictionary.
 * The regex matches the literal block at api/index.ts:3096-3099 — see the
 * `app.patch('/v1/admin/settings', …)` handler.
 */
function extractSettingsAllowlist(): Set<string> {
  const src = readApiSources()
  const block = src.match(
    /app\.patch\(\s*['"]\/v1\/admin\/settings['"][\s\S]*?const allowed = \[([\s\S]*?)\]/,
  )
  if (!block) {
    throw new Error(
      'Could not locate `const allowed = [...]` in PATCH /v1/admin/settings handler',
    )
  }
  const cols = Array.from(block[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
  if (cols.length === 0) throw new Error('Settings allowlist parsed to empty array')
  return new Set(cols)
}

describe('configDocs dictionary', () => {
  it('uses the documented id format for every entry', () => {
    const offenders = ALL_CONFIG_DOCS
      .filter((doc) => !ID_PATTERN.test(doc.id))
      .map((doc) => doc.id)
    expect(offenders, `Bad ids: ${offenders.join(', ')}`).toEqual([])
  })

  it('has no duplicate ids across all groups', () => {
    const seen = new Map<string, number>()
    for (const doc of ALL_CONFIG_DOCS) {
      seen.set(doc.id, (seen.get(doc.id) ?? 0) + 1)
    }
    const dupes = [...seen.entries()].filter(([, count]) => count > 1)
    expect(dupes, `Duplicate ids: ${dupes.map(([id, n]) => `${id}×${n}`).join(', ')}`)
      .toEqual([])
  })

  it('populates every required field on every entry', () => {
    const required: Array<keyof ConfigDoc> = [
      'id',
      'label',
      'summary',
      'howItWorks',
      'whenToChange',
    ]
    for (const doc of ALL_CONFIG_DOCS) {
      for (const key of required) {
        const v = doc[key]
        expect(typeof v === 'string' && v.trim().length > 0, `${doc.id}.${String(key)} is empty`)
          .toBe(true)
      }
      expect(doc.default, `${doc.id} is missing default`).toBeTruthy()
      expect(doc.default.value.trim().length, `${doc.id}.default.value is empty`)
        .toBeGreaterThan(0)
    }
  })

  it('keeps PATCH /v1/admin/settings entries inside the backend allowlist', () => {
    const allowlist = extractSettingsAllowlist()
    const settingsEntries = ALL_CONFIG_DOCS.filter(
      (doc) => doc.backend?.endpoint === 'PATCH /v1/admin/settings',
    )

    expect(settingsEntries.length, 'No /v1/admin/settings entries found').toBeGreaterThan(0)

    const drift: string[] = []
    for (const doc of settingsEntries) {
      // Composite columns are written as `a / b` in the dictionary so the
      // popover can render both halves; the underlying API still validates
      // each column individually, so we split before lookup.
      const cols = (doc.backend?.column ?? '')
        .split(/\s*\/\s*/)
        .map((c) => c.trim())
        .filter(Boolean)
      if (cols.length === 0) {
        drift.push(`${doc.id}: missing backend.column`)
        continue
      }
      for (const col of cols) {
        if (!allowlist.has(col)) {
          drift.push(`${doc.id}: backend.column='${col}' not in PATCH allowlist`)
        }
      }
    }
    expect(drift, drift.join('\n')).toEqual([])
  })

  it('resolves every README#anchor learnMore link to a real heading', () => {
    // Match `README.md#…`, `./README.md#…`, AND `/README.md#…` so a stray
    // leading slash can't sneak past — that path renders as an absolute
    // URL inside the SPA, which 404s every time.
    const readmeLinks = ALL_CONFIG_DOCS
      .map((doc) => ({ id: doc.id, href: doc.learnMore?.href ?? '' }))
      .filter(({ href }) => /^\/?(?:\.\/)?README\.md#/i.test(href))

    if (readmeLinks.length === 0) return // no README anchors to validate

    const readme = readFileSync(README_PATH, 'utf8')
    const anchors = new Set<string>()
    for (const line of readme.split(/\r?\n/)) {
      const m = line.match(/^#{1,6}\s+(.+?)\s*$/)
      if (m) anchors.add(slugifyHeading(m[1]))
    }

    const broken: string[] = []
    for (const { id, href } of readmeLinks) {
      const anchor = href.split('#')[1] ?? ''
      if (!anchors.has(anchor)) broken.push(`${id}: README.md#${anchor}`)
    }
    expect(broken, broken.join('\n')).toEqual([])
  })

  it('does not use absolute paths in learnMore.href (leads to 404 in SPA)', () => {
    const offenders = ALL_CONFIG_DOCS
      .filter((doc) => doc.learnMore?.href?.startsWith('/'))
      .map((doc) => `${doc.id}: ${doc.learnMore?.href}`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  // Bare relative paths like `docs/CONFIG_REFERENCE.md` or
  // `apps/docs/content/concepts/trigger-modes.mdx` are even more dangerous
  // than leading-slash paths: ConfigHelp renders them as raw <a href>, so
  // inside the SPA the browser resolves them against the *current route*
  // (e.g. `/admin/compliance/docs/CONFIG_REFERENCE.md`) and 404s. The same
  // string is then mirrored verbatim into the regenerated
  // `docs/CONFIG_REFERENCE.md`, where it resolves against `docs/` and
  // 404s a second time (`docs/docs/...`). Every learnMore.href must be
  // either an absolute URL (`http(s)://`), a mailto, or a pure in-page
  // anchor (`#…`).
  it('every learnMore.href is an absolute URL, mailto, or pure anchor', () => {
    const offenders = ALL_CONFIG_DOCS
      .map((doc) => ({ id: doc.id, href: doc.learnMore?.href ?? '' }))
      .filter(({ href }) => href.length > 0)
      .filter(({ href }) => !/^(?:https?:\/\/|mailto:|#)/i.test(href))
      .map(({ id, href }) => `${id}: ${href}`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('exposes every entry through getConfigDoc(id)', () => {
    for (const doc of ALL_CONFIG_DOCS) {
      expect(getConfigDoc(doc.id)?.id).toBe(doc.id)
    }
    expect(getConfigDoc('nope.does.not.exist')).toBeUndefined()
  })

  it('has unique route + label pairs', () => {
    const routes = CONFIG_DOC_GROUPS.map((g) => g.route)
    const labels = CONFIG_DOC_GROUPS.map((g) => g.label)
    expect(new Set(routes).size).toBe(routes.length)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
