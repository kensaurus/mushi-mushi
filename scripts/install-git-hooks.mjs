#!/usr/bin/env node
/**
 * Installs repo-local git hooks on `pnpm install`.
 *
 * Wired via the root `prepare` script so contributors get the secret scanner
 * the first time they clone + install, with zero extra steps and zero new
 * runtime dependencies (husky, lint-staged, etc.).
 *
 * The hook itself is a one-liner that delegates to
 * `scripts/check-no-secrets.mjs`, which carries the full pattern catalogue
 * and inline-ignore pragmas. Keep this file thin — everything secret-scan
 * related belongs in `check-no-secrets.mjs`.
 *
 * Escape hatches:
 *   - Set MUSHI_SKIP_GIT_HOOKS=1 to skip install (CI, Vercel builds, etc.).
 *   - `git commit --no-verify` still works for one-off emergencies.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)

if (process.env.MUSHI_SKIP_GIT_HOOKS === '1' || process.env.CI === 'true') {
  process.exit(0)
}

// Respect custom hooksPath if the contributor has set one (e.g. husky users,
// worktree setups). We only manage `.git/hooks/` directly.
let gitDir
try {
  gitDir = execSync('git rev-parse --git-path hooks', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {
  // Not a git checkout (npm pack, tarball install, etc.) — nothing to do.
  process.exit(0)
}

const hooksDir = gitDir.startsWith('/') || /^[A-Z]:/i.test(gitDir) ? gitDir : join(repoRoot, gitDir)
if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true })

const HOOK_BODY = `#!/bin/sh
# Auto-installed by scripts/install-git-hooks.mjs. Do not edit by hand.
# Runs fast repo-wide lint guards before every commit:
#   - secret scanner       (scripts/check-no-secrets.mjs)
#   - design-token drift   (scripts/check-design-tokens.mjs)
#   - MCP catalog sync     (scripts/check-mcp-catalog-sync.mjs)
#   - config docs drift    (scripts/check-config-docs.mjs)
#   - community-file drift (scripts/sync-community-files.mjs --check)
#   - dead buttons         (scripts/check-dead-buttons.mjs)
#   - JSX unicode escapes  (scripts/check-jsx-unicode-escapes.mjs)
# Bypass once with \`git commit --no-verify\` in an emergency.
node scripts/check-no-secrets.mjs || exit 1
node scripts/check-design-tokens.mjs || exit 1
node scripts/check-mcp-catalog-sync.mjs || exit 1
node scripts/check-config-docs.mjs || exit 1
node scripts/sync-community-files.mjs --check || exit 1
node scripts/check-dead-buttons.mjs || exit 1
node scripts/check-jsx-unicode-escapes.mjs || exit 1
`

const target = join(hooksDir, 'pre-commit')
const existing = existsSync(target) ? readFileSync(target, 'utf8') : ''

if (existing === HOOK_BODY) {
  process.exit(0)
}

if (existing && !existing.includes('check-no-secrets.mjs')) {
  console.warn(
    `[install-git-hooks] Refusing to overwrite existing pre-commit hook at ${target}.\n` +
      '  To adopt the mushi-mushi secret scanner, delete it and re-run `pnpm install`,\n' +
      '  or chain the existing hook into scripts/check-no-secrets.mjs yourself.',
  )
  process.exit(0)
}

writeFileSync(target, HOOK_BODY, 'utf8')
try {
  chmodSync(target, 0o755)
} catch {
  // chmod is a no-op on native Windows filesystems — git-for-windows still
  // treats the file as executable, so this is safe to swallow.
}

console.log(`[install-git-hooks] wrote ${target}`)
