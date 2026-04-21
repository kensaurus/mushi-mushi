#!/usr/bin/env node
/**
 * SEC-2 (audit 2026-04-21) — pre-commit / CI secret scanner.
 *
 * Runs against the files currently staged for commit (or, with `--all`,
 * every tracked file). Flags any line that matches a known secret pattern.
 *
 * Install as a pre-commit hook locally:
 *     echo '#!/bin/sh\nnode scripts/check-no-secrets.mjs || exit 1' > .git/hooks/pre-commit
 *     chmod +x .git/hooks/pre-commit
 *
 * Wire into CI by adding a step:
 *     node scripts/check-no-secrets.mjs --all
 *
 * The patterns intentionally match the server-side PII scrubber
 * (_shared/pii-scrubber.ts) so a secret that sneaks into a log file is
 * caught both at rest (this script) and in flight (the scrubber).
 *
 * Exit codes:
 *   0 — clean
 *   1 — secret found (prints file:line:pattern for each hit)
 *   2 — invoked incorrectly (unknown flag, git command failed)
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

// Patterns: [name, regex]. Regexes MUST be anchored so we never scan the
// whole file as a single match (ReDoS risk).
const PATTERNS = [
  ['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['AWS_SECRET', /(?:aws_secret_access_key|secret_access_key)[\"'\s:=]+[A-Za-z0-9/+=]{40}\b/i],
  ['STRIPE_SECRET', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/],
  ['SLACK_TOKEN', /\bxox[abpor]-[A-Za-z0-9-]{10,}\b/],
  ['GITHUB_PAT', /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{80,})\b/],
  ['OPENAI_KEY', /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/],
  ['ANTHROPIC_KEY', /\bsk-ant-[A-Za-z0-9_-]{40,}\b/],
  ['GOOGLE_KEY', /\bAIza[0-9A-Za-z_-]{35}\b/],
  // Generic "looks like a JWT" — very common in copy-pasted debug dumps.
  ['JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
  // Service-role-key leak: the Supabase service key is a JWT but we also
  // catch callers who paste the raw supabase URL + key pair.
  ['SUPABASE_URL_AND_KEY', /https:\/\/[a-z0-9]{20}\.supabase\.co[\s\S]{0,200}\bsk-/],
  // Plain hex secrets >= 32 chars with an obvious label — matches webhook
  // secrets, HMAC keys, etc. Narrow enough to avoid git SHAs.
  ['HEX_SECRET', /\b(?:secret|api_?key|token|password|pwd)[\"'\s:=]+[a-f0-9]{32,}\b/i],
]

// Files we never scan — either binary, lockfiles, or known-safe sample data.
const IGNORE_PATHS = [
  /\.lock$/,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  // .env.example is the canonical redacted template — it must contain
  // placeholder strings that look like keys. Scan it anyway but with the
  // understanding that our patterns are conservative enough not to match
  // "sk-ant-your-key-here".
  /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|mp[34]|zip|tgz|gz)$/i,
  // Allow the scanner to live alongside the fixtures it tests against.
  /scripts\/check-no-secrets\.mjs$/,
  // Audit reports intentionally include partial tokens to document findings.
  /docs\/audit-.*\.md$/,
]

const MAX_FILE_SIZE_BYTES = 1_000_000 // 1 MB; anything bigger is suspicious.

function listStagedFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

function listAllTracked() {
  const out = execSync('git ls-files', { encoding: 'utf8' })
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

function scanFile(path) {
  // Read the file first, then validate size — checking size via stat() and
  // then reading is a TOCTOU race (CodeQL js/io/file-system-race-condition).
  // Going buffer-first means we inspect the exact bytes we'll scan.
  let buf
  try {
    buf = readFileSync(path)
  } catch {
    return []
  }
  if (buf.length > MAX_FILE_SIZE_BYTES) {
    return [{ path, line: 0, pattern: 'FILE_TOO_LARGE', snippet: `${buf.length} bytes` }]
  }
  const text = buf.toString('utf8')
  const hits = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Inline ignore: either a trailing `check-no-secrets: ignore-line` on the
    // same line, or `check-no-secrets: ignore-next-line` on the line above
    // (useful when the line itself is a long literal we cannot append to).
    // Used for known-safe public values such as Supabase anon keys, which
    // are intentionally client-exposed and protected server-side by RLS.
    const prev = i > 0 ? lines[i - 1] : ''
    if (line.includes('check-no-secrets: ignore-line')) continue
    if (prev.includes('check-no-secrets: ignore-next-line')) continue
    for (const [name, rx] of PATTERNS) {
      if (rx.test(line)) {
        hits.push({
          path,
          line: i + 1,
          pattern: name,
          snippet: line.slice(0, 120).trim(),
        })
      }
    }
  }
  return hits
}

function shouldSkip(path) {
  return IGNORE_PATHS.some(rx => rx.test(path))
}

function main() {
  const args = process.argv.slice(2)
  let mode = 'staged'
  for (const a of args) {
    if (a === '--all') mode = 'all'
    else if (a === '--help' || a === '-h') {
      console.log('Usage: check-no-secrets.mjs [--all]')
      process.exit(0)
    } else {
      console.error(`Unknown arg: ${a}`)
      process.exit(2)
    }
  }

  let files
  try {
    files = mode === 'all' ? listAllTracked() : listStagedFiles()
  } catch (e) {
    console.error('git command failed:', e.message)
    process.exit(2)
  }
  files = files.filter(f => !shouldSkip(f))

  const allHits = []
  for (const f of files) {
    allHits.push(...scanFile(f))
  }

  if (allHits.length === 0) {
    console.log(`✓ check-no-secrets: scanned ${files.length} file(s), no secrets found.`)
    process.exit(0)
  }

  console.error(`✗ check-no-secrets: ${allHits.length} potential secret(s) detected.`)
  for (const h of allHits) {
    console.error(`  ${relative(process.cwd(), h.path)}:${h.line}  [${h.pattern}]  ${h.snippet}`)
  }
  console.error('')
  console.error('If a match is a false positive, add a context-specific ignore or rotate the key.')
  console.error('If a match is real, rotate the key IMMEDIATELY before removing it from git history.')
  process.exit(1)
}

main()
