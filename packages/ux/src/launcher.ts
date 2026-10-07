// SPDX-License-Identifier: MIT
/**
 * What the studio's launcher offers, read from the machine and the repo:
 * which agents are installed, dev command guesses, refs to branch from, and
 * page suggestions. Nothing is assumed: an agent missing from PATH shows as
 * unavailable, and every field can be typed over.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTS } from './agents.js'
import { DEFAULT_JUDGE_MODEL } from './judge.js'
import { run } from './proc.js'
import { isWorthVisiting, routesFromSource } from './routes.js'
import { DEFAULT_SKILLS_REPO } from './skills.js'
import { loadState } from './state.js'

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor (CLI, your account)',
  'cursor-cloud': 'Cursor Cloud agent',
  codex: 'Codex',
}

/** The binary each local agent needs; cursor-cloud needs a key instead. */
const AGENT_BINARY: Record<string, string | null> = { 'claude-code': 'claude', cursor: 'agent', codex: 'codex', 'cursor-cloud': null }

export interface AgentAvailability {
  name: string
  label: string
  installed: boolean
  note?: string
}

export async function agentAvailability(env: NodeJS.ProcessEnv = process.env): Promise<AgentAvailability[]> {
  return Promise.all(
    Object.keys(AGENTS).map(async (name) => {
      const label = AGENT_LABELS[name] ?? name
      const bin = AGENT_BINARY[name]
      if (bin === null) {
        return env.CURSOR_API_KEY ? { name, label, installed: true } : { name, label, installed: false, note: 'set CURSOR_API_KEY' }
      }
      const res = await run(bin ?? name, ['--version'], { cwd: process.cwd(), shell: true, timeoutMs: 20_000 }).catch(() => null)
      return res && res.exitCode === 0 ? { name, label, installed: true } : { name, label, installed: false, note: `\`${bin}\` not found` }
    }),
  )
}

interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Dev command guesses, best first. The framework's own command comes first:
 * `npm run dev` also runs `predev` / `postdev`, which in some repos kill
 * whatever holds the usual port (the person's own dev server).
 */
export function devCommandGuesses(repoRoot: string): { commands: string[]; warning: string | null } {
  const file = join(repoRoot, 'package.json')
  if (!existsSync(file)) return { commands: [], warning: null }
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as PackageJson
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const scripts = pkg.scripts ?? {}
  const pm = existsSync(join(repoRoot, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(repoRoot, 'yarn.lock')) ? 'yarn' : existsSync(join(repoRoot, 'bun.lock')) || existsSync(join(repoRoot, 'bun.lockb')) ? 'bun' : 'npm'
  const out: string[] = []
  const devScript = scripts.dev ?? ''
  // Env prefixes the dev script sets (cross-env A=1 B=2 …), kept for the direct command.
  const envPrefix = devScript.match(/^cross-env\s+((?:[A-Z_][A-Z0-9_]*=\S+\s+)+)/)?.[1]?.replace(/\b[A-Z_]*PORT=\S+\s*/g, '').trim()
  // Under npx, cross-env already finds the repo's local binaries.
  const withEnv = (cmd: string) => (envPrefix && deps['cross-env'] ? `npx cross-env ${envPrefix} ${cmd.replace(/^npx /, '')}` : cmd)
  if (deps.next) {
    const webpack = /--webpack/.test(devScript) ? ' --webpack' : ''
    out.push(withEnv(`npx next dev${webpack} -p {port}`))
  }
  if (deps.vite) out.push(withEnv('npx vite --port {port} --strictPort'))
  if (deps.astro) out.push(withEnv('npx astro dev --port {port}'))
  if (deps['@remix-run/dev']) out.push(withEnv('npx remix vite:dev --port {port}'))
  for (const name of Object.keys(scripts).filter((s) => /^dev(:|$)/.test(s))) {
    out.push(`${pm} run ${name}${pm === 'npm' ? ' --' : ''} --port {port}`)
  }
  const hooks = ['predev', 'postdev'].filter((h) => scripts[h])
  const warning = hooks.length
    ? `This repo's ${hooks.join(' and ')} script${hooks.length > 1 ? 's' : ''} run${hooks.length > 1 ? '' : 's'} with \`${pm} run dev\` (${hooks.map((h) => scripts[h]).join('; ').slice(0, 160)}). The direct command above skips ${hooks.length > 1 ? 'them' : 'it'}.`
    : null
  return { commands: [...new Set(out)], warning }
}

/**
 * The dev command and pages of this repo's newest run that mapped at least one
 * screen: proof they work here, which a guess from package.json is not
 * (glot.it needs `--webpack` that its dev script does not carry). A run that
 * found nothing is skipped, so a broken command is never offered again.
 */
export function lastWorkingRun(repoRoot: string): { runId: string; devCommand: string; startPaths: string[] } | null {
  const dir = join(repoRoot, '.mushi', 'ux')
  let ids: string[]
  try {
    ids = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{8}-\d{6}-[a-z0-9]+$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
  } catch {
    return null
  }
  for (const runId of ids.slice(0, 30)) {
    const state = loadState(join(dir, runId))
    if (state?.options?.devCommand && state.surfaces.length > 0) {
      return { runId, devCommand: state.options.devCommand, startPaths: state.options.startPaths ?? [] }
    }
  }
  return null
}

export interface AgentAccount {
  /** The signed-in account, as the agent reports it. */
  email: string | null
  /** The agent's plan name (Cursor: Pro, Pro Plus, Ultra…). */
  plan: string | null
  /** Where the person sees what the account has used; no agent reports remaining credit. */
  usageUrl: string | null
}

/** Pure: the account fields of `agent about --format json`. */
export function parseCursorAbout(stdout: string): AgentAccount | null {
  try {
    const j = JSON.parse(stdout.slice(stdout.indexOf('{'))) as { userEmail?: unknown; subscriptionTier?: unknown }
    const email = typeof j.userEmail === 'string' ? j.userEmail : null
    const plan = typeof j.subscriptionTier === 'string' ? j.subscriptionTier : null
    return email || plan ? { email, plan, usageUrl: 'https://cursor.com/dashboard/usage' } : null
  } catch {
    return null
  }
}

/**
 * Which account the run would spend. Cursor only: its CLI names the account
 * and plan, while no CLI (Cursor's included) reports how much credit is left,
 * so the launcher links to the usage page instead of inventing a balance.
 */
export async function agentAccount(agent: string): Promise<AgentAccount | null> {
  if (agent !== 'cursor') return null
  const res = await run('agent', ['about', '--format', 'json'], { cwd: process.cwd(), shell: true, timeoutMs: 20_000 }).catch(() => null)
  return res && res.exitCode === 0 ? parseCursorAbout(res.stdout) : null
}

async function git(repoRoot: string, args: string[]): Promise<string | null> {
  const res = await run('git', args, { cwd: repoRoot, timeoutMs: 20_000 }).catch(() => null)
  return res && res.exitCode === 0 ? res.stdout.trim() : null
}

/** Refs to branch from: the remote's default branch (and how far the checkout is behind it), then HEAD. */
export async function baseRefs(repoRoot: string): Promise<{ refs: Array<{ ref: string; label: string }>; defaultRef: string }> {
  const head = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? 'HEAD'
  const remoteHead = (await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])) ?? ((await git(repoRoot, ['rev-parse', '--verify', 'origin/main'])) ? 'origin/main' : null)
  const dirty = ((await git(repoRoot, ['status', '--porcelain'])) ?? '').split('\n').filter(Boolean).length
  const refs: Array<{ ref: string; label: string }> = []
  if (remoteHead) {
    const behind = await git(repoRoot, ['rev-list', '--count', `HEAD..${remoteHead}`])
    refs.push({ ref: remoteHead, label: `${remoteHead} (remote tip${behind && behind !== '0' ? `; your checkout is ${behind} commits behind` : ''})` })
  }
  refs.push({ ref: 'HEAD', label: `HEAD — ${head}${dirty ? ` (${dirty} uncommitted change${dirty === 1 ? '' : 's'} not included)` : ''}` })
  // The remote tip is the safer default when the checkout is behind or dirty.
  const defaultRef = remoteHead && (dirty > 0 || head !== remoteHead.replace(/^origin\//, '')) ? remoteHead : 'HEAD'
  return { refs, defaultRef }
}

/**
 * Routes worth offering as start pages: concrete paths only (no template or
 * dynamic segments), no error/auth-callback/API/dev-only pages, shallow first.
 */
export function pageSuggestions(routes: string[], max = 60): string[] {
  return routes
    .filter(isWorthVisiting)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, max)
}

export interface StudioOptionInputs {
  repoRoot: string
  skillsRepo?: string
  syncAvailable: boolean
  syncNote: string
  env?: NodeJS.ProcessEnv
}

export async function studioOptions(i: StudioOptionInputs): Promise<Record<string, unknown>> {
  const env = i.env ?? process.env
  const [agents, refs] = await Promise.all([agentAvailability(env), baseRefs(i.repoRoot)])
  const dev = devCommandGuesses(i.repoRoot)
  const lastRun = lastWorkingRun(i.repoRoot)
  const preferred = ['cursor', 'claude-code', 'codex', 'cursor-cloud'].find((n) => agents.some((a) => a.name === n && a.installed))
  return {
    agents,
    defaultAgent: preferred ?? 'claude-code',
    // A command that already mapped screens in this repo goes first.
    devCommands: [...new Set([...(lastRun ? [lastRun.devCommand] : []), ...dev.commands])],
    lastRun,
    devWarning: dev.warning,
    refs: refs.refs,
    defaultRef: refs.defaultRef,
    routes: pageSuggestions(routesFromSource(i.repoRoot)),
    skillsRepo: i.skillsRepo ?? DEFAULT_SKILLS_REPO,
    judgeAvailable: Boolean(env.ANTHROPIC_API_KEY),
    judgeModel: DEFAULT_JUDGE_MODEL,
    syncAvailable: i.syncAvailable,
    syncNote: i.syncNote,
  }
}
