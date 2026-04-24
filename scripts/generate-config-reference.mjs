#!/usr/bin/env node
/**
 * FILE: scripts/generate-config-reference.mjs
 * PURPOSE: Render `apps/admin/src/lib/configDocs.ts` into the human-readable
 *          markdown that lives at `docs/CONFIG_REFERENCE.md`. The TS file is
 *          the single source of truth — both this script and the in-app
 *          `<ConfigHelp>` popover read from it.
 *
 *          Usage:
 *            pnpm gen:config-docs        # write the file
 *            pnpm check:config-docs      # fail-on-drift guard (CI / pre-commit)
 *
 *          Importing TS at runtime uses jiti so we don't have to maintain a
 *          parallel JS export of the dictionary. Mirrors the pattern used by
 *          ESLint and Vitest internally.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'
import { createJiti } from 'jiti'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DICT_PATH = resolve(ROOT, 'apps/admin/src/lib/configDocs.ts')
const OUT_PATH = resolve(ROOT, 'docs/CONFIG_REFERENCE.md')

/**
 * Load the TS dictionary via jiti. We use `interopDefault: true` so we get the
 * named exports back as a plain object regardless of CJS/ESM interop quirks.
 */
async function loadDictionary() {
  const jiti = createJiti(import.meta.url, { interopDefault: true })
  const mod = await jiti.import(DICT_PATH)
  if (!mod || !Array.isArray(mod.CONFIG_DOC_GROUPS)) {
    throw new Error(`CONFIG_DOC_GROUPS missing or not an array in ${DICT_PATH}`)
  }
  return mod
}

/** Slugify an entry id into a stable markdown anchor (lowercase, [a-z0-9-]). */
function anchorFor(id) {
  return id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

/**
 * Render one entry as a 5-section card. Sections are deliberately rendered in
 * the same order as the in-app popover so non-technical readers can map the
 * markdown back to what they see in the admin UI.
 */
function renderEntry(doc) {
  const lines = []
  lines.push(`### ${escapeMd(doc.label)}`)
  lines.push('')
  lines.push(`<a id="${anchorFor(doc.id)}"></a>`)
  lines.push('')
  lines.push(`\`${doc.id}\``)
  lines.push('')
  lines.push(`**Summary** — ${doc.summary}`)
  lines.push('')
  lines.push(`**How it works** — ${doc.howItWorks}`)
  lines.push('')
  const range = doc.default?.range ? ` · range \`${doc.default.range}\`` : ''
  lines.push(`**Default** — \`${doc.default?.value ?? 'unset'}\`${range}`)
  lines.push('')
  if (doc.backend) {
    const parts = []
    if (doc.backend.table) {
      const col = doc.backend.column ? `.${doc.backend.column}` : ''
      parts.push(`table \`${doc.backend.table}${col}\``)
    } else if (doc.backend.column) {
      parts.push(`column \`${doc.backend.column}\``)
    }
    if (doc.backend.endpoint) parts.push(`endpoint \`${doc.backend.endpoint}\``)
    if (doc.backend.readBy?.length) {
      parts.push(`read by ${doc.backend.readBy.map((r) => `\`${r}\``).join(', ')}`)
    }
    if (parts.length > 0) {
      lines.push(`**Where it lives** — ${parts.join(' · ')}`)
      lines.push('')
    }
  }
  lines.push(`**When to change** — ${doc.whenToChange}`)
  lines.push('')
  if (doc.learnMore?.href) {
    lines.push(`**Learn more** — [${escapeMd(doc.learnMore.label)}](${doc.learnMore.href})`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Tame characters that would otherwise interact with markdown formatting in
 * the rendered output. We deliberately don't escape backticks or asterisks
 * because the dictionary entries use them intentionally for inline code and
 * emphasis.
 */
function escapeMd(text) {
  return String(text).replace(/<\/?(script|style)/gi, '&lt;$1')
}

function buildToc(groups) {
  const lines = ['## Contents', '']
  for (const g of groups) {
    lines.push(`- [${escapeMd(g.label)}](#${anchorFor(g.label)}) (${g.entries.length})`)
  }
  lines.push('')
  return lines.join('\n')
}

function build(groups) {
  const generated = new Date().toISOString().slice(0, 10)
  const totalEntries = groups.reduce((acc, g) => acc + g.entries.length, 0)
  const dictRel = relative(ROOT, DICT_PATH).replace(/\\/g, '/')

  const out = [
    '# Mushi Mushi · Configuration reference',
    '',
    '> Auto-generated from [`' + dictRel + '`](../' + dictRel + ').',
    '> Do not edit by hand — run `pnpm gen:config-docs` instead.',
    '',
    `_${totalEntries} configuration knobs across ${groups.length} sections · last regenerated ${generated}._`,
    '',
    'Every knob in the admin console has an in-app `i` icon next to it that opens a longer-form explanation. The same content is mirrored here so you can search, link, and review configuration choices outside the app.',
    '',
    buildToc(groups),
  ]

  for (const group of groups) {
    out.push(`## ${escapeMd(group.label)}`)
    out.push('')
    out.push(`<a id="${anchorFor(group.label)}"></a>`)
    out.push('')
    for (const entry of group.entries) {
      out.push(renderEntry(entry))
    }
  }

  // Trailing newline keeps POSIX tools happy and means re-runs are idempotent.
  return out.join('\n').replace(/\n+$/, '\n') + '\n'
}

async function main() {
  const mode = process.argv[2] ?? 'write'
  const { CONFIG_DOC_GROUPS } = await loadDictionary()
  const next = build(CONFIG_DOC_GROUPS)

  if (mode === 'check') {
    if (!existsSync(OUT_PATH)) {
      console.error(`[drift] ${relative(ROOT, OUT_PATH)} is missing. Run \`pnpm gen:config-docs\`.`)
      process.exit(1)
    }
    const current = readFileSync(OUT_PATH, 'utf8')
    if (current !== next) {
      console.error(`[drift] ${relative(ROOT, OUT_PATH)} is out of sync with the dictionary.`)
      console.error('  Run `pnpm gen:config-docs` and commit the diff.')
      process.exit(1)
    }
    console.log(`[ok] ${relative(ROOT, OUT_PATH)} matches the dictionary.`)
    return
  }

  writeFileSync(OUT_PATH, next, 'utf8')
  console.log(`[gen] wrote ${relative(ROOT, OUT_PATH)} (${CONFIG_DOC_GROUPS.length} sections)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
