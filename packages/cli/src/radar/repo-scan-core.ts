/**
 * FILE: radar/repo-scan-core.ts
 * PURPOSE: The part of the radar's repo scan that also runs in the host's CI
 *          (`mushi radar scan`): which build-config files the store-policy
 *          rules read, comment blanking, and `storage_sql_delete`.
 *
 * This file has NO imports and is kept byte-identical in two places:
 *   packages/server/supabase/functions/_shared/radar/repo-scan-core.ts
 *   packages/cli/src/radar/repo-scan-core.ts
 * (asserted by packages/server/src/__tests__/radar-repo-scan.test.ts).
 * Edit both together.
 */

/** Structurally a RadarFinding of rule `storage_sql_delete`. */
export interface StorageScanFinding {
  ruleId: 'storage_sql_delete'
  severity: 'warn'
  message: string
  target: string
  filePath: string
  line: number
  fix: string
  evidence: { snippet: string }
}

/**
 * Files the server fetches for extractRepoFacts. Entries ending in `/` are
 * directory prefixes (list the directory, fetch its `.yml` / `.yaml`
 * files). Xcode project files live under a project-named folder, so the
 * GitHub reader also fetches any path matching isRepoScanPath().
 */
/** @public Read by the server copy's extractRepoFacts. */
export const REPO_SCAN_PATHS: readonly string[] = [
  'android/variables.gradle',
  'android/build.gradle',
  'android/app/build.gradle',
  'android/app/build.gradle.kts',
  'app.json',
  'app.config.json',
  'eas.json',
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/Podfile',
  'ios/Podfile',
  '.github/workflows/',
]

/** True for any path extractRepoFacts reads, including `ios/<Name>.xcodeproj/project.pbxproj`. */
export function isRepoScanPath(path: string): boolean {
  const p = normalizePath(path)
  if (REPO_SCAN_PATHS.includes(p)) return true
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) return true
  return /^ios\/(?:[^/]+\/)?[^/]+\.xcodeproj\/project\.pbxproj$/.test(p)
}

/** @public Shared with the server copy's fact readers. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

// ── comments ─────────────────────────────────────────────────────────────────

/** @public */
export type Syntax = 'gradle' | 'yaml' | 'ruby' | 'sql' | 'js' | 'py'

/**
 * Lines with whole-line and block comments blanked out; line numbers are kept (index + 1).
 * @public Shared with the server copy's fact readers.
 */
export function uncommentedLines(text: string | undefined, syntax: Syntax): string[] {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let inBlock = false
  for (const raw of lines) {
    let line = raw
    if (syntax === 'gradle' || syntax === 'sql' || syntax === 'js') {
      if (inBlock) {
        const end = line.indexOf('*/')
        if (end === -1) {
          out.push('')
          continue
        }
        line = line.slice(end + 2)
        inBlock = false
      }
      // Drop /* … */ spans on the line; an unclosed one starts a block.
      line = line.replace(/\/\*.*?\*\//g, '')
      const open = line.indexOf('/*')
      if (open !== -1) {
        line = line.slice(0, open)
        inBlock = true
      }
    }
    if (syntax === 'sql') {
      // A trailing `-- …` comment, when the `--` is outside a string literal.
      const dash = line.indexOf('--')
      if (dash !== -1 && (line.slice(0, dash).split("'").length - 1) % 2 === 0) line = line.slice(0, dash)
    }
    const t = line.trim()
    const whole =
      ((syntax === 'gradle' || syntax === 'js') && t.startsWith('//')) ||
      (syntax === 'sql' && (t.startsWith('--') || t.startsWith('//'))) ||
      ((syntax === 'yaml' || syntax === 'ruby' || syntax === 'py') && t.startsWith('#'))
    out.push(whole ? '' : line)
  }
  return out
}

// ── storage_sql_delete ───────────────────────────────────────────────────────

const SCANNED_EXT = /\.(sql|ts|tsx|js|mjs|cjs|py)$/i
const STORAGE_OBJECTS = String.raw`(?:"?storage"?\s*\.\s*"?objects"?)`
const SQL_DELETE = new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?${STORAGE_OBJECTS}(?![\w"])`, 'gi')
const SQL_TRUNCATE = new RegExp(String.raw`\btruncate\s+(?:table\s+)?(?:only\s+)?${STORAGE_OBJECTS}(?![\w"])`, 'gi')
const CLIENT_FROM_OBJECTS = /\.from\(\s*['"`]objects['"`]\s*\)/
const CLIENT_SCHEMA_STORAGE = /\.schema\(\s*['"`]storage['"`]\s*\)/
const CLIENT_DELETE = /\.delete\(/

const STORAGE_FIX =
  "Delete the file through the Storage API instead: `supabase.storage.from('<bucket>').remove(['<path>'])`. " +
  'A SQL delete removes the row but leaves the file in the bucket, still billed ' +
  '(https://supabase.com/docs/guides/storage/management/delete-objects). To clean up files already orphaned, ' +
  'list them through the Storage API and remove them there.'

function syntaxFor(path: string): Syntax {
  if (/\.sql$/i.test(path)) return 'sql'
  if (/\.py$/i.test(path)) return 'py'
  return 'js'
}

function lineOfOffset(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/**
 * `storage_sql_delete`: rows of `storage.objects` deleted with SQL (or with a
 * client pointed at the storage schema), which leaves the files in the bucket.
 * One warn finding per match, with a 1-based line. Comment lines are skipped.
 */
export function scanStorageSqlDelete(path: string, text: string): StorageScanFinding[] {
  const file = normalizePath(path)
  if (!SCANNED_EXT.test(file)) return []
  const syntax = syntaxFor(file)
  const lines = uncommentedLines(text, syntax)
  // Scan the comment-blanked text so a match inside a comment never counts;
  // newlines are kept, so offsets still map to the original line numbers.
  const clean = lines.join('\n')
  const findings: StorageScanFinding[] = []
  const seen = new Set<number>()
  const original = text.split(/\r?\n/)

  const add = (line: number, how: string) => {
    if (seen.has(line)) return
    seen.add(line)
    findings.push({
      ruleId: 'storage_sql_delete',
      severity: 'warn',
      message: `${file}:${line} ${how}. The row goes, but the file stays in the bucket and keeps costing money.`,
      target: file,
      filePath: file,
      line,
      fix: STORAGE_FIX,
      evidence: { snippet: (original[line - 1] ?? '').trim().slice(0, 200) },
    })
  }

  for (const re of [SQL_DELETE, SQL_TRUNCATE]) {
    re.lastIndex = 0
    for (const m of clean.matchAll(re)) {
      add(lineOfOffset(clean, m.index ?? 0), re === SQL_DELETE ? 'deletes storage rows with SQL' : 'truncates storage.objects with SQL')
    }
  }

  if (syntax !== 'sql') {
    for (let i = 0; i < lines.length; i++) {
      if (!CLIENT_FROM_OBJECTS.test(lines[i])) continue
      const before = lines.slice(Math.max(0, i - 5), i + 1).join('\n')
      const after = lines.slice(i, i + 4).join('\n')
      if (CLIENT_SCHEMA_STORAGE.test(before) && CLIENT_DELETE.test(after)) {
        add(i + 1, "deletes rows from storage.objects through a client pointed at the 'storage' schema")
      }
    }
  }

  return findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
}
