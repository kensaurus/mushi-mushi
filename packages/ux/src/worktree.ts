// SPDX-License-Identifier: MIT
/**
 * The agent edits a separate git worktree on its own branch, served by its
 * own dev server, so the person's checkout (and any other agent working in
 * it) is never touched. Accepted iterations are commits on that branch;
 * rejected ones are reverted.
 *
 * `.mushi-ux/` inside the worktree carries the screenshots and the prompt for
 * the agent. It is never committed.
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { appEnv, run, start } from './proc.js'

export const SCRATCH_DIR = '.mushi-ux'

async function git(cwd: string, args: string[]): Promise<string> {
  const res = await run('git', args, { cwd, timeoutMs: 120_000 })
  if (res.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.tail.trim()}`)
  return res.stdout.trim()
}

export async function repoRootOf(cwd: string): Promise<string> {
  return git(cwd, ['rev-parse', '--show-toplevel'])
}

export interface Worktree {
  path: string
  branch: string
  baseSha: string
}

/**
 * Branch `mushi-ux/<runId>` from `baseRef` (default HEAD) in `.worktrees/`.
 * A stale or dirty checkout stays untouched: pass `origin/main` to start from
 * the remote's tip instead of whatever the checkout is on.
 */
export async function createWorktree(repoRoot: string, runId: string, baseRef = 'HEAD'): Promise<Worktree> {
  const branch = `mushi-ux/${runId}`
  const path = join(repoRoot, '.worktrees', `mushi-ux-${runId}`)
  if (!/^[\w./@^~-]{1,200}$/.test(baseRef) || baseRef.startsWith('-')) throw new Error(`Not a git ref: ${baseRef}`)
  const baseSha = await git(repoRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`])
  await ensureLocalExcludes(repoRoot)
  mkdirSync(dirname(path), { recursive: true })
  await git(repoRoot, ['worktree', 'add', '-b', branch, path, baseSha])
  await copyEnvFiles(repoRoot, path)
  return { path, branch, baseSha }
}

/** Paths the loop writes that must never show up in `git status` or a commit. */
const LOCAL_EXCLUDES = ['/.mushi/', '/.worktrees/', `/${SCRATCH_DIR}/`]

/**
 * Add the loop's own directories to `.git/info/exclude` (local to this clone,
 * shared by its worktrees, never committed), so a run leaves the person's
 * `git status` clean without touching their `.gitignore`.
 */
async function ensureLocalExcludes(repoRoot: string): Promise<void> {
  let common = await git(repoRoot, ['rev-parse', '--git-common-dir'])
  if (!isAbsolute(common)) common = join(repoRoot, common)
  const file = join(common, 'info', 'exclude')
  mkdirSync(dirname(file), { recursive: true })
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()))
  const missing = LOCAL_EXCLUDES.filter((p) => !lines.has(p))
  if (missing.length === 0) return
  const lead = current && !current.endsWith('\n') ? '\n' : ''
  appendFileSync(file, `${lead}# mushi-ux (local only)\n${missing.join('\n')}\n`)
}

/**
 * Local `.env*` files are untracked, so a fresh worktree lacks them. Only
 * files git already ignores are copied: an env file the repo does not ignore
 * would otherwise land in the run's commits (`git add -A`) and in the PR.
 */
async function copyEnvFiles(from: string, to: string, maxDepth = 4): Promise<string[]> {
  const candidates: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === '.worktrees' || name === '.mushi') continue
      const abs = join(dir, name)
      let isDir = false
      try {
        isDir = statSync(abs).isDirectory()
      } catch {
        continue
      }
      if (isDir) walk(abs, depth + 1)
      else if (/^\.env(\..+)?$/.test(name) && !name.endsWith('.example')) {
        candidates.push(relative(from, abs).replace(/\\/g, '/'))
      }
    }
  }
  walk(from, 0)
  if (candidates.length === 0) return []
  // check-ignore exits 1 when nothing matches; stdout lists the ignored paths.
  const res = await run('git', ['check-ignore', '--', ...candidates], { cwd: from, timeoutMs: 60_000 })
  const ignored = new Set(res.stdout.split(/\r?\n/).map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean))
  const copied: string[] = []
  for (const rel of candidates) {
    if (!ignored.has(rel)) continue
    const dest = join(to, rel)
    if (existsSync(dest)) continue
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(from, rel), dest)
    copied.push(rel)
  }
  return copied
}

/** Files changed by the agent, ignoring the scratch dir. */
export async function changedFiles(wt: string): Promise<string[]> {
  // Not git(): its trim() would eat the leading status column of line one.
  const res = await run('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: wt,
    timeoutMs: 120_000,
  })
  if (res.exitCode !== 0) throw new Error(`git status failed: ${res.tail.trim()}`)
  return res.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
}

/**
 * The agent's uncommitted edits as text, for a reviewer: tracked changes from
 * `git diff HEAD` and new files in full, capped. Stages nothing, so
 * revertAll still restores the tree.
 */
export async function diffText(wt: string, maxChars = 20_000): Promise<string> {
  const tracked = await run('git', ['diff', 'HEAD', '--', '.', `:(exclude)${SCRATCH_DIR}`], { cwd: wt, timeoutMs: 120_000 })
  let out = tracked.stdout
  const untracked = await run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: wt, timeoutMs: 120_000 })
  for (const f of untracked.stdout.split(/\r?\n/).filter((x) => x && !x.startsWith(SCRATCH_DIR))) {
    if (out.length >= maxChars) break
    try {
      out += `\n--- new file ${f} ---\n${readFileSync(join(wt, f), 'utf8').slice(0, 4000)}\n`
    } catch {
      out += `\n--- new file ${f} (unreadable) ---\n`
    }
  }
  return out.slice(0, maxChars)
}

export async function commitAll(wt: string, message: string): Promise<string> {
  // .mushi-ux/ is in .git/info/exclude (ensureLocalExcludes), so -A skips it.
  await git(wt, ['add', '-A'])
  await git(wt, ['-c', 'user.name=mushi-ux', '-c', 'user.email=mushi-ux@users.noreply.github.com', 'commit', '--no-verify', '-m', message])
  return git(wt, ['rev-parse', 'HEAD'])
}

export async function headSha(wt: string): Promise<string> {
  return git(wt, ['rev-parse', 'HEAD'])
}

/**
 * Move the run's own branch back to a commit it already had (a resume after a
 * crash between an attempt's commit and the state save). Only ever called on
 * the run's worktree, never the person's checkout.
 */
export async function resetRunBranch(wt: string, sha: string): Promise<void> {
  await git(wt, ['merge-base', '--is-ancestor', sha, 'HEAD'])
  await git(wt, ['reset', '--hard', sha])
}

/** Throw away the agent's uncommitted edits; keeps the scratch dir and ignored files (.env). */
export async function revertAll(wt: string): Promise<void> {
  await git(wt, ['checkout', '--', '.'])
  await git(wt, ['clean', '-fd', '-e', SCRATCH_DIR])
}

export function detectInstallCommand(dir: string): string | null {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm install --frozen-lockfile --prefer-offline'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun install --frozen-lockfile'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn install --frozen-lockfile'
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm ci'
  return null
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

export interface DevServer {
  url: string
  stop(): void
}

/**
 * Start `command` in the worktree. `{port}` in the command and the PORT env
 * var both carry the chosen port; resolves once `url` answers.
 */
export async function startDevServer(
  wt: string,
  command: string,
  opts: { port?: number; path?: string; timeoutMs?: number; onLine?: (l: string) => void } = {},
): Promise<DevServer> {
  const port = opts.port ?? (await freePort())
  const cmd = command.replace(/\{port\}/g, String(port))
  // Keep the last lines, so a failure says why instead of only "no answer".
  const recent: string[] = []
  const server = start(cmd, {
    cwd: wt,
    env: { ...appEnv(), PORT: String(port) },
    onLine: (l) => {
      recent.push(l)
      if (recent.length > 40) recent.shift()
      opts.onLine?.(l)
    },
  })
  const url = `http://localhost:${port}`
  const timeoutMs = opts.timeoutMs ?? 180_000
  const deadline = Date.now() + timeoutMs
  const tail = () => {
    // The first error line and what follows is usually the cause; ANSI colours dropped.
    const lines = recent.map((l) => l.replace(/\u001b\[[0-9;]*m/g, ''))
    const at = lines.findIndex((l) => /error|⨯|failed|cannot|can't/i.test(l))
    return (at >= 0 ? lines.slice(at, at + 12) : lines.slice(-12)).join('\n')
  }
  let lastStatus: number | null = null
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`Dev server exited with code ${server.child.exitCode}: ${cmd}\n${tail()}`)
    lastStatus = await fetch(new URL(opts.path ?? '/', url), { redirect: 'manual' })
      .then((r) => r.status)
      .catch(() => lastStatus)
    if (lastStatus !== null && lastStatus < 500) return { url, stop: server.stop }
    await new Promise((r) => setTimeout(r, 1000))
  }
  server.stop()
  const why = lastStatus !== null ? `answered HTTP ${lastStatus} on ${url}${opts.path ?? '/'}` : `did not answer on ${url}`
  throw new Error(`The dev server ${why} for ${Math.round(timeoutMs / 1000)}s: ${cmd}\n${tail()}`)
}
