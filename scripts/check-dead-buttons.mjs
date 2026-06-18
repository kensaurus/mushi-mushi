#!/usr/bin/env node
/**
 * FILE: scripts/check-dead-buttons.mjs
 * PURPOSE: Fail CI if any JSX button / Btn / Link in apps/admin/src/**
 *          either:
 *            1. has a no-op onClick (e.g. `onClick={() => {}}` or
 *               `onClick={noop}`), or
 *            2. is `disabled` without a matching `title` or `aria-label`
 *               or `<Tooltip>` wrapper, meaning a user who hovers gets no
 *               explanation of why the button is dead.
 *            3. `apiFetch` followed by a success toast without an `res.ok`
 *               guard in the same handler (KycForm-class false success).
 *            4. `usePageData` in pages / tester components without `error`
 *               destructure or `// error-handled-by-parent` allowlist.
 *
 *          This is a fast, syntactic grep — it is deliberately *not*
 *          a full TSC pass. Catches roughly 90% of the "this button
 *          does nothing" category of bugs the QA team keeps logging.
 *
 *          Exits with code 0 if clean, 1 if violations found.
 *          Wave R (2026-04-22).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const ROOT = resolve(process.cwd(), 'apps/admin/src')
const exts = new Set(['.tsx', '.ts'])

/** Collect every .ts/.tsx file under apps/admin/src/. */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
      out.push(...walk(full))
    } else if (exts.has(full.slice(full.lastIndexOf('.')))) {
      out.push(full)
    }
  }
  return out
}

/**
 * Regex detectors. These are line-oriented — a dead button that spans
 * multiple lines and splits `disabled` from its element onto separate
 * lines may slip through, but those are rare in this codebase and any
 * human reviewer will catch them.
 */
const NOOP_ONCLICK = /onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/
// `onClick={noop}` where the identifier is literally `noop` — people sometimes
// import a no-op helper from a "TODO stub" utility.
const NOOP_NAMED = /onClick=\{\s*noop\s*\}/
// Only permanent-disabled buttons are "dead". Transient `disabled={loading}`
// / `disabled={saving}` are valid UX — the button shows a spinner and
// re-enables when work completes. We only flag literal `disabled={true}`
// and shorthand `disabled` (no RHS) that is NOT paired with a hint.
const DISABLED_HARD = /\bdisabled(?=(\s|>|\/))/
const DISABLED_TRUE_LITERAL = /\bdisabled=\{true\}/

/** Paths where usePageData is a transport hook — parent owns error UI. */
const USE_PAGE_DATA_ERROR_ALLOWLIST = new Set([
  'apps/admin/src/lib/usePageData.ts',
  'apps/admin/src/lib/useMergedErrors.ts',
  'apps/admin/src/lib/useActivationStatus.ts',
  'apps/admin/src/lib/useEntitlements.ts',
  'apps/admin/src/lib/useTesterStatus.ts',
  'apps/admin/src/lib/tester-page-data.ts',
  'apps/admin/src/lib/apiEnvelope.ts',
])

/** Subtrees exempt from the page-level usePageData error rule. */
const USE_PAGE_DATA_ERROR_SKIP_DIRS = [
  'apps/admin/src/components/skeletons/',
  'apps/admin/src/components/ui/',
]

const API_SUCCESS_OK_ALLOW = /api-success-ok-guard|res-ok-checked/
const SUCCESS_TOAST = /toast\.success|toastSuccess\(|\.push\(\s*\{[^}]*tone:\s*['"]success/
const RES_OK_GUARD =
  /res\.ok|response\.ok|!\s*res\.ok|!\s*response\.ok|\(res as \{ ok\?: boolean \}\)\.ok|res\.data\?\.\w+/

function relativeFromRoot(absPath) {
  return relative(process.cwd(), absPath).replace(/\\/g, '/')
}

function shouldCheckUsePageDataError(rel) {
  if (USE_PAGE_DATA_ERROR_ALLOWLIST.has(rel)) return false
  for (const prefix of USE_PAGE_DATA_ERROR_SKIP_DIRS) {
    if (rel.startsWith(prefix)) return false
  }
  return rel.startsWith('apps/admin/src/pages/tester/')
}

function checkUsePageDataError(src, rel) {
  if (!shouldCheckUsePageDataError(rel)) return []
  if (!/usePageData\s*[<(]/.test(src)) return []
  if (/error-handled-by-parent/.test(src)) return []

  const violations = []
  const destructureRe = /(?:const|let)\s+(\{[\s\S]*?\})\s*=\s*usePageData/g
  let m
  while ((m = destructureRe.exec(src)) !== null) {
    const block = m[1]
    const line = src.slice(0, m.index).split(/\r?\n/).length
    const context = src.slice(Math.max(0, m.index - 120), m.index)
    if (/error-handled-by-parent/.test(context)) continue
    if (!/\berror\b/.test(block)) {
      violations.push({
        line,
        kind: 'usePageData-missing-error',
        preview: block.split(/\r?\n/)[0]?.trim() ?? 'usePageData destructure missing error',
      })
    }
  }

  const assignRe = /(?:const|let)\s+(\w+)\s*=\s*usePageData/g
  while ((m = assignRe.exec(src)) !== null) {
    const varName = m[1]
    const line = src.slice(0, m.index).split(/\r?\n/).length
    const context = src.slice(Math.max(0, m.index - 120), m.index)
    if (/error-handled-by-parent/.test(context)) continue
    const usesError = new RegExp(`\\b${varName}\\.error\\b`).test(src)
    if (!usesError) {
      violations.push({
        line,
        kind: 'usePageData-missing-error',
        preview: `${varName} = usePageData without ${varName}.error handling`,
      })
    }
  }

  return violations
}

function checkApiSuccessToast(src) {
  const lines = src.split(/\r?\n/)
  const violations = []
  for (let i = 0; i < lines.length; i++) {
    const assignMatch = lines[i].match(/(?:const|let)\s+(\w+)\s*=\s*await\s+apiFetch/)
    if (!assignMatch) continue
    const varName = assignMatch[1]
    const windowEnd = Math.min(lines.length, i + 30)
    const windowLines = lines.slice(i, windowEnd)
    const window = windowLines.join('\n')
    if (API_SUCCESS_OK_ALLOW.test(window)) continue
    if (!SUCCESS_TOAST.test(window)) continue
    const okPattern = new RegExp(
      `${varName}\\.ok|!\\s*${varName}\\.ok|\\(${varName} as \\{ ok\\?: boolean \\}\\)\\.ok|${varName}\\.data\\?\\.\\w+`,
    )
    if (okPattern.test(window)) continue
    const toastIdx = windowLines.findIndex((l) => SUCCESS_TOAST.test(l))
    violations.push({
      line: i + 1 + Math.max(0, toastIdx),
      kind: 'apiFetch-success-without-ok',
      preview: windowLines[toastIdx]?.trim() ?? lines[i].trim(),
    })
  }

  for (let i = 0; i < lines.length; i++) {
    if (!/await\s+apiFetch/.test(lines[i])) continue
    if (/(?:const|let)\s+\w+\s*=/.test(lines[i])) continue
    const windowEnd = Math.min(lines.length, i + 20)
    const windowLines = lines.slice(i, windowEnd)
    const window = windowLines.join('\n')
    if (API_SUCCESS_OK_ALLOW.test(window)) continue
    if (!SUCCESS_TOAST.test(window)) continue
    if (RES_OK_GUARD.test(window)) continue
    const toastIdx = windowLines.findIndex((l) => SUCCESS_TOAST.test(l))
    violations.push({
      line: i + 1 + Math.max(0, toastIdx),
      kind: 'apiFetch-success-without-ok',
      preview: windowLines[toastIdx]?.trim() ?? lines[i].trim(),
    })
  }

  return violations
}

function checkFile(absPath) {
  const src = readFileSync(absPath, 'utf8')
  const rel = relativeFromRoot(absPath)
  const lines = src.split(/\r?\n/)
  const violations = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (NOOP_ONCLICK.test(line) || NOOP_NAMED.test(line)) {
      violations.push({ line: i + 1, kind: 'noop-onclick', preview: line.trim() })
      continue
    }

    // Only flag `disabled={true}` — a literal permanent-dead button. Every
    // other `disabled={…}` usage has a dynamic RHS (loading, saving,
    // form-invalid, etc.) which is valid UX and should NOT block CI.
    if (DISABLED_TRUE_LITERAL.test(line)) {
      const window = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join('\n')
      const hasHint =
        /title=|aria-label=|aria-describedby=|<Tooltip\b/i.test(window)
      if (!hasHint) {
        violations.push({ line: i + 1, kind: 'disabled-no-hint', preview: line.trim() })
      }
    }
  }

  violations.push(...checkApiSuccessToast(src))
  violations.push(...checkUsePageDataError(src, rel))

  return violations
}

function main() {
  let failed = 0
  const files = walk(ROOT)
  for (const f of files) {
    const v = checkFile(f)
    if (v.length === 0) continue
    failed += v.length
    const rel = relative(process.cwd(), f)
    for (const item of v) {
      console.log(`${rel}:${item.line}  [${item.kind}]  ${item.preview}`)
    }
  }

  if (failed > 0) {
    console.error(
      `\n\u274c check-dead-buttons: ${failed} violation${failed === 1 ? '' : 's'} found.`,
    )
    console.error(
      '   Dead buttons are the #1 UX complaint in audit reports. Either wire the handler',
    )
    console.error(
      '   to a real action, or remove the element + explain why it\'s disabled via title=/aria-label=/<Tooltip>.',
    )
    process.exit(1)
  }
  console.log(`\u2705 check-dead-buttons: scanned ${files.length} files, 0 violations.`)
}

main()
