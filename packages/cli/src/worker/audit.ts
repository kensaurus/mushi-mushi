/**
 * FILE: packages/cli/src/worker/audit.ts
 * PURPOSE: A local worker lane in `audit` mode (ADR 0050): a code-read audit,
 *          one screen or module per claim. It replaces audit-loop.mjs
 *          (2026-10-26), whose lesson is the point of this file: the model's
 *          self-review over-reported, so a model's word never files a report.
 *
 *            1. A cheap model (the lane's model), read-only (`--mode ask`),
 *               proposes up to 3 findings for one screen. Each must cite
 *               file:line, quote the code there, and name a check from a
 *               closed set: a `pattern` over one file, or one of the repo's
 *               own package scripts (lint, typecheck, test, check). Never a
 *               command the model writes.
 *            2. The worker runs the check itself, with no model: the quote
 *               must be on that line (±2), and the check must reproduce.
 *            3. A second model (the lane's review model, when set) may only
 *               veto a reproduced finding. No answer counts as a veto.
 *            4. A reproduced, unvetoed finding goes to the server, which
 *               screens it, dedupes it by file + rule + a hash of the real
 *               line, and files it under the hourly caps.
 *
 *          The screens done and findings waiting for the cap live in Mushi's
 *          own cache (~/.cache/mushi/audit/<lane>.json). The audit reads the
 *          default branch in a detached worktree, so the clone's checkout is
 *          never touched.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { agentEnv, clearWorktree, defaultBranch, failureTail, git, installCommand, installDeps, runProc, type Api } from '../commands/work.js'

/** One model call; the 2026-10-26 loop needed a hard stop at 15 min. */
const ASK_TIMEOUT_MS = 15 * 60_000
const SCRIPT_TIMEOUT_MS = 10 * 60_000
const MAX_FINDINGS_PER_SCREEN = 3
const MAX_PENDING = 20
const MAX_FILE_BYTES = 1_000_000
const SCRIPT_NAMES = ['lint', 'typecheck', 'test', 'check'] as const

type AuditCheck =
  | { kind: 'pattern'; file: string; regex: string; ignoreCase: boolean; expect: 'present' | 'absent'; line: number | null }
  | { kind: 'script'; script: (typeof SCRIPT_NAMES)[number]; expect: string }

interface Proposal {
  title: string
  severity: 'high' | 'medium' | 'low'
  file: string
  line: number
  rule: string
  quote: string
  userImpact: string
  fix: string
  doneWhen: string
  check: AuditCheck
}

/** What the worker sends (POST /v1/worker/claims/:id/findings); the server checks every field again. */
interface FindingBody {
  title: string
  severity: Proposal['severity']
  file: string
  line: number
  rule: string
  evidenceLine: string
  userImpact: string
  fix: string
  doneWhen: string
  check: { kind: 'pattern' | 'script'; summary: string }
  screen: string
  proposedBy: string | null
  vetoBy: string | null
}

interface AuditState {
  pass: number
  done: string[]
  /** Reproduced findings the hourly cap held back; filed first next time. */
  pending: FindingBody[]
}

interface AuditOutcome {
  result: 'filed' | 'no_change' | 'timeout' | 'stopped' | 'failed'
  failureKind?: 'infra' | 'code'
  detail: string
}

// ── Pure parts (exported for tests) ─────────────────────────────────────────

const UI_RE = /\.(tsx|jsx|vue|svelte)$/
const SKIP_RE = /(\.test|\.spec|\.stories)\.|__tests__|\/e2e\/|node_modules|^emails\//
const PAGE_DIR_RE = /(^|\/)(app|pages|screens|routes|views|features)\//
const NOT_A_PAGE_RE = /_layout\.tsx$|\+not-found|\+html/

/** @internal Exported for tests only. The screens to audit: page files, or every UI file when the app has no page folders. */
export function listScreens(files: readonly string[]): string[] {
  const ui = files.filter((f) => UI_RE.test(f) && !SKIP_RE.test(f))
  const pages = ui.filter((f) => PAGE_DIR_RE.test(f) && !NOT_A_PAGE_RE.test(f))
  return (pages.length ? pages : ui).sort()
}

/** @internal Exported for tests only. The next screen, or a new pass when every screen is done. */
export function nextScreen(state: AuditState, screens: readonly string[]): { screen: string | null; state: AuditState } {
  if (!screens.length) return { screen: null, state }
  const done = new Set(state.done)
  const todo = screens.find((s) => !done.has(s))
  if (todo) return { screen: todo, state }
  const next = { ...state, pass: state.pass + 1, done: [] }
  return { screen: screens[0]!, state: next }
}

/** @internal Exported for tests only. */
export function proposePrompt(screen: string, pass: number): string {
  const focus = pass === 1 ? 'bugs a real user would notice' : 'small rough edges a careful user would notice (polish pass)'
  return `You are auditing one screen of this app as its most careful user. Screen file: ${screen}. Read it and only the files it imports directly (at most 8 files); do not explore the rest of the repo and do not run commands. Answer within a few minutes.
Find up to ${MAX_FINDINGS_PER_SCREEN} ${focus}, each CONCRETE and visible to a user: wrong or missing data, text in the wrong language, numbers that contradict each other, a broken empty, loading or error state, a control that does nothing, text that overflows, missing feedback after an action, an accessibility gap (unlabelled control, tiny target, contrast).
A program checks every finding before anyone sees it, with no model, and drops what it cannot reproduce:
- "quote" must be the exact code on "line" of "file" (it is compared with the file);
- "check" must reproduce the problem, as ONE of:
  {"kind":"pattern","file":"path","regex":"JavaScript regex","ignoreCase":false,"expect":"present"|"absent","line":123}  (the regex is matched against each line of that file, within 3 lines of "line" when given; "absent" means the problem is that something is missing there)
  {"kind":"script","script":"lint"|"typecheck"|"test"|"check","expect":"text the failing output prints"}  (the repo's own package script must fail and print this text and the file's path)
Rules: no style opinions, no refactors, no "consider"; nothing that needs CI, secrets or another service. If nothing concrete, return an empty list.
Answer with ONLY this JSON: {"findings":[{"title":"short, the user's view","severity":"high|medium|low","file":"path","line":123,"rule":"short-slug","quote":"exact code on that line","user_impact":"what the user sees","fix":"smallest change","done_when":"observable check","check":{...}}]}`
}

/** @internal Exported for tests only. */
export function vetoPrompt(f: FindingBody): string {
  return `A program reproduced this claimed user-visible problem in the repository with a deterministic check. Your only job is to veto it if it is wrong: the check proves the wrong thing, the behaviour is intended, it is not visible to users, or it is a style opinion. Read the code before you answer.
Finding: ${JSON.stringify({ title: f.title, file: f.file, line: f.line, code: f.evidenceLine, userImpact: f.userImpact, fix: f.fix, check: f.check.summary })}
Answer with ONLY this JSON: {"veto":true|false,"reason":"one sentence"}`
}

/** The first JSON object in a model's text. */
function jsonIn(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const v = JSON.parse(m[0]) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const SAFE_PATH_RE = /^[A-Za-z0-9_@()[\]+.-]+(?:\/[A-Za-z0-9_@()[\]+.-]+)*$/
/** @internal Exported for tests only. A repo-relative path with no way out of the worktree. */
export function safePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const p = raw.trim().replace(/^\.\//, '')
  if (!p || p.length > 300 || !SAFE_PATH_RE.test(p) || p.split('/').some((s) => s === '..' || s === '.')) return null
  return p
}

/**
 * @internal Exported for tests only. A regex the worker will run: at most 200
 * characters, no backreference, no quantified group that itself repeats (the
 * classic catastrophic-backtracking shape), and it must compile.
 */
export function safeRegex(src: unknown, ignoreCase: boolean): RegExp | null {
  if (typeof src !== 'string' || src.length === 0 || src.length > 200) return null
  if (/\\[1-9]|\\k</.test(src)) return null
  if (/\((?:[^()\\]|\\.)*[*+](?:[^()\\]|\\.)*\)\s*[*+{]/.test(src)) return null
  try {
    return new RegExp(src, ignoreCase ? 'i' : '')
  } catch {
    return null
  }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : ''
}

/** @internal Exported for tests only. The proposals a model returned that are complete and checkable; the rest are dropped here. */
export function parseProposals(text: string): Proposal[] {
  const list = jsonIn(text)?.findings
  if (!Array.isArray(list)) return []
  const out: Proposal[] = []
  for (const raw of list.slice(0, MAX_FINDINGS_PER_SCREEN) as Array<Record<string, unknown>>) {
    const file = safePath(raw?.file)
    const line = typeof raw?.line === 'number' && Number.isInteger(raw.line) && raw.line >= 1 ? raw.line : null
    const title = str(raw?.title, 200)
    const quote = str(raw?.quote, 500)
    if (!file || !line || title.length < 3 || quote.replace(/\s+/g, '').length < 4) continue
    const c = (raw.check ?? {}) as Record<string, unknown>
    let check: AuditCheck | null = null
    if (c.kind === 'pattern') {
      const cf = safePath(c.file) ?? file
      const ignoreCase = c.ignoreCase === true
      if (safeRegex(c.regex, ignoreCase) && (c.expect === 'present' || c.expect === 'absent')) {
        const near = typeof c.line === 'number' && Number.isInteger(c.line) && c.line >= 1 ? c.line : null
        check = { kind: 'pattern', file: cf, regex: c.regex as string, ignoreCase, expect: c.expect, line: near }
      }
    } else if (c.kind === 'script' && (SCRIPT_NAMES as readonly string[]).includes(String(c.script)) && str(c.expect, 200).length >= 4) {
      check = { kind: 'script', script: c.script as (typeof SCRIPT_NAMES)[number], expect: str(c.expect, 200) }
    }
    if (!check) continue
    const severity = raw.severity === 'high' || raw.severity === 'low' ? raw.severity : 'medium'
    const rule = (str(raw.rule, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'other').slice(0, 60)
    out.push({ title, severity, file, line, rule, quote, userImpact: str(raw.user_impact, 1000), fix: str(raw.fix, 1000), doneWhen: str(raw.done_when, 500), check })
  }
  return out
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** @internal Exported for tests only. The real line (1-based) within ±2 of `line` that holds the quote, or null. */
export function evidenceLine(fileText: string, line: number, quote: string): { line: number; text: string } | null {
  const lines = fileText.split('\n')
  const q = norm(quote)
  for (const d of [0, -1, 1, -2, 2]) {
    const n = line + d
    const text = lines[n - 1]
    if (text !== undefined && norm(text).includes(q)) return { line: n, text: norm(text).slice(0, 500) }
  }
  // A quote spanning lines: the joined window holds it, and it starts on `line`.
  const window = norm(lines.slice(Math.max(0, line - 1), line + 2).join(' '))
  if (window.includes(q) && lines[line - 1] !== undefined && norm(lines[line - 1]!).length > 0 && q.startsWith(norm(lines[line - 1]!).slice(0, 12))) {
    return { line, text: norm(lines[line - 1]!).slice(0, 500) }
  }
  return null
}

/** @internal Exported for tests only. A pattern check over one file's text: does the problem reproduce? */
export function patternReproduces(fileText: string, c: Extract<AuditCheck, { kind: 'pattern' }>): boolean {
  const re = safeRegex(c.regex, c.ignoreCase)
  if (!re) return false
  const lines = fileText.split('\n')
  const from = c.line ? Math.max(1, c.line - 3) : 1
  const to = c.line ? Math.min(lines.length, c.line + 3) : lines.length
  let found = false
  for (let n = from; n <= to && !found; n++) found = re.test((lines[n - 1] ?? '').slice(0, 1000))
  return c.expect === 'present' ? found : !found
}

/** @internal Exported for tests only. A failing script run reproduces a finding when its output names the file and the expected text. */
export function scriptReproduces(run: { code: number | null; stdout: string; stderr: string; timedOut: boolean }, file: string, expect: string): boolean {
  if (run.timedOut || run.code === 0 || run.code === null) return false
  const out = `${run.stdout}\n${run.stderr}`
  return out.includes(file) && out.toLowerCase().includes(expect.toLowerCase())
}

/** @internal Exported for tests only. What the check was, in one line. */
export function checkSummary(c: AuditCheck): string {
  return c.kind === 'pattern'
    ? `/${c.regex}/${c.ignoreCase ? 'i' : ''} is ${c.expect} in ${c.file}${c.line ? ` near line ${c.line}` : ''}`.slice(0, 300)
    : `\`${c.script}\` fails and prints "${c.expect}" for this file`.slice(0, 300)
}

/** @internal Exported for tests only. A veto answer: only an explicit "no veto" lets a finding through. */
export function vetoed(text: string): { vetoed: boolean; reason: string } {
  const j = jsonIn(text)
  if (!j || typeof j.veto !== 'boolean') return { vetoed: true, reason: 'the second model gave no clear answer' }
  return { vetoed: j.veto, reason: str(j.reason, 200) }
}

// ── State ───────────────────────────────────────────────────────────────────

function statePath(lane: string): string {
  return join(homedir(), '.cache', 'mushi', 'audit', `${lane}.json`)
}

function loadAuditState(lane: string): AuditState {
  try {
    const s = JSON.parse(readFileSync(statePath(lane), 'utf8')) as Partial<AuditState>
    return { pass: Number.isInteger(s.pass) && s.pass! >= 1 ? s.pass! : 1, done: Array.isArray(s.done) ? s.done.filter((x) => typeof x === 'string') : [], pending: Array.isArray(s.pending) ? s.pending.slice(0, MAX_PENDING) : [] }
  } catch {
    return { pass: 1, done: [], pending: [] }
  }
}

function saveAuditState(lane: string, s: AuditState): void {
  mkdirSync(join(homedir(), '.cache', 'mushi', 'audit'), { recursive: true })
  writeFileSync(statePath(lane), JSON.stringify({ ...s, pending: s.pending.slice(0, MAX_PENDING) }, null, 1), { mode: 0o600 })
}

// ── The run ─────────────────────────────────────────────────────────────────

interface AuditRunOptions {
  repoDir: string
  laneName: string
  model?: string
  reviewModel: string | null
  log: (line: string) => void
  signal?: AbortSignal
}

type FileResult = 'filed' | 'duplicate' | 'capped' | 'refused' | 'error'

/** One audit pass over one screen. Never throws: every end is an outcome the daemon reports. */
export async function auditPass(api: Api, claimId: string, o: AuditRunOptions): Promise<AuditOutcome> {
  const root = join(homedir(), '.cache', 'mushi', 'audit', basename(o.repoDir))
  const wt = join(root, o.laneName)
  const empty = join(tmpdir(), `mushi-audit-${process.pid}`)
  let state = loadAuditState(o.laneName)
  const fileOne = async (body: FindingBody): Promise<FileResult> => {
    try {
      await api(`/v1/worker/claims/${claimId}/findings`, { method: 'POST', body: JSON.stringify(body) })
      return 'filed'
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      if (/DUPLICATE/.test(m)) return 'duplicate'
      if (/AUDIT_CAP|RATE_LIMITED|QUOTA_EXCEEDED/.test(m)) return 'capped'
      if (/REFUSED|VALIDATION_ERROR/.test(m)) return 'refused'
      o.log(`  audit: not filed (${m.slice(0, 160)})`)
      return 'error'
    }
  }
  const ask = async (model: string | undefined, prompt: string) =>
    runProc('cursor-agent', ['-p', '--mode', 'ask', '--trust', '--output-format', 'text', '--workspace', wt, ...(model ? ['--model', model] : []), prompt], {
      cwd: wt,
      env: agentEnv(process.env, empty),
      timeoutMs: ASK_TIMEOUT_MS,
      signal: o.signal,
    })

  let filed = 0
  let held = 0
  try {
    // Findings the cap held back last time go first.
    const waiting = state.pending
    state.pending = []
    for (const body of waiting) {
      const r = await fileOne(body)
      if (r === 'filed') filed++
      else if (r === 'capped' || r === 'error') state.pending.push(body)
    }
    saveAuditState(o.laneName, state)
    if (state.pending.length) return { result: filed ? 'filed' : 'no_change', detail: `filed ${filed} waiting finding(s); ${state.pending.length} still wait for the hourly cap` }

    const base = await defaultBranch(o.repoDir)
    await git(o.repoDir, ['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`])
    mkdirSync(root, { recursive: true })
    mkdirSync(empty, { recursive: true })
    await clearWorktree(o.repoDir, wt)
    await git(o.repoDir, ['worktree', 'add', '--detach', wt, `refs/remotes/origin/${base}`])
    const files = (await git(wt, ['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n').filter(Boolean)
    const pick = nextScreen(state, listScreens(files))
    state = pick.state
    if (!pick.screen) return { result: 'no_change', detail: 'no screen or UI file found in the default branch' }
    const screen = pick.screen

    const proposed = await ask(o.model, proposePrompt(screen, state.pass))
    if (o.signal?.aborted) return { result: 'stopped', detail: `stopped (lost the lease) while reading ${screen}` }
    if (proposed.timedOut) return { result: 'timeout', failureKind: 'code', detail: `the model did not answer about ${screen} within ${ASK_TIMEOUT_MS / 60_000} min` }
    if (proposed.code !== 0) return { result: 'failed', failureKind: 'infra', detail: `cursor-agent exited ${proposed.code}: ${failureTail(proposed, 200)}` }
    const proposals = parseProposals(proposed.stdout)

    let reproduced = 0
    let vetoes = 0
    let duplicates = 0
    let depsReady = false
    let scriptRuns = 0
    for (const p of proposals) {
      const path = join(wt, p.file)
      if (!existsSync(path) || statSync(path).size > MAX_FILE_BYTES) continue
      const evidence = evidenceLine(readFileSync(path, 'utf8'), p.line, p.quote)
      if (!evidence) continue
      let ok = false
      if (p.check.kind === 'pattern') {
        const cpath = join(wt, p.check.file)
        ok = existsSync(cpath) && statSync(cpath).size <= MAX_FILE_BYTES && patternReproduces(readFileSync(cpath, 'utf8'), p.check)
      } else if (scriptRuns < 1) {
        // One script run per pass: they are slow and take memory.
        const pkg = existsSync(join(wt, 'package.json')) ? (JSON.parse(readFileSync(join(wt, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }) : {}
        const pm = installCommand((f) => existsSync(join(wt, f)))?.[0] ?? 'npm'
        if (pkg.scripts?.[p.check.script]) {
          if (!depsReady) {
            await installDeps(wt, o.log)
            depsReady = true
          }
          scriptRuns++
          const run = await runProc(pm, ['run', p.check.script], { cwd: wt, timeoutMs: SCRIPT_TIMEOUT_MS, signal: o.signal })
          ok = scriptReproduces(run, p.file, p.check.expect)
        }
      }
      if (!ok) continue
      reproduced++
      const body: FindingBody = {
        title: p.title,
        severity: p.severity,
        file: p.file,
        line: evidence.line,
        rule: p.rule,
        evidenceLine: evidence.text,
        userImpact: p.userImpact || p.title,
        fix: p.fix || 'See the finding.',
        doneWhen: p.doneWhen || 'The check above no longer reproduces.',
        check: { kind: p.check.kind, summary: checkSummary(p.check) },
        screen,
        proposedBy: o.model ?? null,
        vetoBy: o.reviewModel,
      }
      if (o.reviewModel) {
        const v = await ask(o.reviewModel, vetoPrompt(body))
        const verdict = v.code === 0 && !v.timedOut ? vetoed(v.stdout) : { vetoed: true, reason: 'the second model did not answer' }
        if (verdict.vetoed) {
          vetoes++
          o.log(`  audit: vetoed ${p.file}:${evidence.line} (${verdict.reason})`)
          continue
        }
      }
      const r = await fileOne(body)
      if (r === 'filed') filed++
      else if (r === 'duplicate') duplicates++
      else if (r === 'capped' || r === 'error') {
        held++
        state.pending.push(body)
      }
    }
    state.done = [...state.done, screen]
    saveAuditState(o.laneName, state)
    const detail = `${screen} (pass ${state.pass}): ${proposals.length} proposed, ${reproduced} reproduced, ${vetoes} vetoed, ${duplicates} already filed, ${filed} filed${held ? `, ${held} wait for the hourly cap` : ''}`
    return { result: filed ? 'filed' : 'no_change', detail }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    saveAuditState(o.laneName, state)
    return { result: 'failed', failureKind: 'infra', detail: message.slice(0, 600) }
  } finally {
    await clearWorktree(o.repoDir, wt).catch(() => undefined)
  }
}
