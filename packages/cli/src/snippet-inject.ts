/**
 * FILE: packages/cli/src/snippet-inject.ts
 * PURPOSE: Close the one un-automated init step — getting the SDK snippet
 *          into the user's entry file — with two tools:
 *
 *   1. `injectSnippet` — idempotent marker-block injection (headroom
 *      pattern: re-runs replace the block, never duplicate it). Only used
 *      for frameworks whose snippet is a plain top-of-file import + init
 *      (see ENTRY_CANDIDATES); JSX providers that must WRAP the render tree
 *      are never auto-edited — rewriting a user's component tree is how
 *      wizards break apps.
 *
 *   2. `findSdkImport` — source-level verifier used by `mushi doctor`:
 *      detects whether any source file actually imports `@mushi-mushi/*`,
 *      so "installed the package but never added the snippet" stops looking
 *      identical to a fully wired app.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameworkId } from './detect.js'

export const MUSHI_MARKER_START = '// <mushi-mushi:init>'
export const MUSHI_MARKER_END = '// </mushi-mushi:init>'

/**
 * Frameworks whose init is an order-independent import + call that can be
 * safely prepended. Everything else (React/Vue/Svelte providers) needs a
 * human to place the wrapper.
 */
export const ENTRY_CANDIDATES: Partial<Record<FrameworkId, string[]>> = {
  vanilla: ['src/main.ts', 'src/main.js', 'src/index.ts', 'src/index.js', 'main.ts', 'main.js', 'index.js'],
}

/**
 * Insert (or replace) the marker-delimited snippet in `source`.
 * - Existing marker block → replaced wholesale (idempotent re-run).
 * - No markers → snippet is prepended, after a leading shebang if present.
 */
export function injectSnippet(source: string, snippet: string): string {
  const block = `${MUSHI_MARKER_START}\n${snippet.trim()}\n${MUSHI_MARKER_END}`

  const startIdx = source.indexOf(MUSHI_MARKER_START)
  const endIdx = source.indexOf(MUSHI_MARKER_END)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return source.slice(0, startIdx) + block + source.slice(endIdx + MUSHI_MARKER_END.length)
  }
  // Corrupted half-markers: refuse to guess — treat as no markers but strip
  // any orphan marker lines first so we never nest blocks.
  const cleaned = source
    .split('\n')
    .filter((l) => !l.includes(MUSHI_MARKER_START) && !l.includes(MUSHI_MARKER_END))
    .join('\n')

  if (cleaned.startsWith('#!')) {
    const nl = cleaned.indexOf('\n')
    return `${cleaned.slice(0, nl + 1)}${block}\n${cleaned.slice(nl + 1)}`
  }
  return `${block}\n\n${cleaned}`
}

const SOURCE_DIRS = ['src', 'app', 'pages', 'lib', 'components']
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte'])
const MAX_FILES_SCANNED = 2_000

/**
 * Best-effort scan for a `@mushi-mushi/*` import in the app's source.
 * Returns the first file that references the SDK, or null. Bounded (2k
 * files, common source dirs only) so doctor stays fast on monorepos.
 */
export async function findSdkImport(cwd: string): Promise<{ file: string } | null> {
  let scanned = 0

  async function walk(dir: string, depth: number): Promise<{ file: string } | null> {
    if (depth > 6 || scanned >= MAX_FILES_SCANNED) return null
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      if (scanned >= MAX_FILES_SCANNED) return null
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const hit = await walk(join(dir, entry.name), depth + 1)
        if (hit) return hit
      } else if (SOURCE_EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
        scanned += 1
        try {
          const content = await readFile(join(dir, entry.name), 'utf8')
          if (content.includes('@mushi-mushi/') || content.includes('MushiProvider')) {
            return { file: join(dir, entry.name) }
          }
        } catch {
          // unreadable file — skip
        }
      }
    }
    return null
  }

  for (const dirName of SOURCE_DIRS) {
    const hit = await walk(join(cwd, dirName), 0)
    if (hit) return hit
  }
  // Fall back to top-level entry files (vanilla setups without src/).
  for (const name of ['main.ts', 'main.js', 'index.js', 'index.ts', 'index.html']) {
    try {
      const content = await readFile(join(cwd, name), 'utf8')
      if (content.includes('@mushi-mushi/') || content.includes('MushiProvider') || content.includes('mushi-mushi')) {
        return { file: join(cwd, name) }
      }
    } catch {
      // absent — fine
    }
  }
  return null
}
