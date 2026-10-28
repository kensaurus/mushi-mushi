/**
 * FILE: packages/cli/src/worker/fresh-eyes.ts
 * PURPOSE: A local worker runs a first-time user test the console queued
 *          (fresh-eyes "Run now", ADR 0053 amendment 2026-10-28). Any lane of
 *          the app takes one before its own work; the test needs no clone.
 *
 *          It starts `mushi-ux fresh-eyes --request-stdin --sync` (plus
 *          `--file` unless it only looks around) with Node itself, never a
 *          shell. Everything the server chose (the start page, the goal, the
 *          test accounts) goes in one JSON document on stdin: not in argv,
 *          where `ps` and a shell could read it, and not in the environment.
 *          The child gets the worker key to sync into the console's run row;
 *          mushi-ux drops every MUSHI_* variable before its model runs, and
 *          the key reaches only that one run (the server checks the claim).
 *
 *          Nothing here logs the request: it can hold passwords.
 */

import { uxCommandLine } from '../commands/ux.js'
import { failureTail, runProc, type Proc } from '../commands/work.js'
import type { FreshEyesTarget } from './protocol.js'

/** Three visitors of 30 steps finish in well under this; a hung browser or model does not. */
const RUN_TIMEOUT_MS = 75 * 60_000

interface FreshEyesOutcome {
  result: 'ran' | 'failed' | 'timeout' | 'stopped'
  failureKind?: 'infra' | 'code'
  detail: string
}

/** @internal Exported for tests only. What mushi-ux reads on stdin; the CLI's own parser checks it again. */
export function freshEyesStdin(t: FreshEyesTarget): string {
  return JSON.stringify({
    runId: t.runId,
    url: t.url,
    goal: t.goal,
    sessions: t.sessions,
    successText: t.successText,
    dryRun: t.dryRun,
    accounts: t.accounts,
  })
}

/** @internal Exported for tests only. The child's environment: the machine's, minus every other Mushi credential, plus the run's sync target. */
export function freshEyesEnv(base: NodeJS.ProcessEnv, sync: { apiKey: string; projectId: string; endpoint: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) if (!k.startsWith('MUSHI_') || k === 'MUSHI_UX_BIN' || k === 'MUSHI_CONSOLE_URL') env[k] = v
  return { ...env, MUSHI_API_KEY: sync.apiKey, MUSHI_PROJECT_ID: sync.projectId, MUSHI_API_ENDPOINT: sync.endpoint }
}

/** @internal Exported for tests only. How the run ended, from the child's exit. */
export function freshEyesOutcome(r: Proc, aborted: boolean): FreshEyesOutcome {
  if (aborted) return { result: 'stopped', detail: 'The worker stopped before the test finished.' }
  if (r.timedOut) return { result: 'timeout', failureKind: 'infra', detail: `The test ran over ${RUN_TIMEOUT_MS / 60_000} minutes and was stopped.` }
  if (r.code === null) return { result: 'failed', failureKind: 'infra', detail: `mushi-ux could not start on this computer: ${failureTail(r, 300)}` }
  if (r.code !== 0) return { result: 'failed', failureKind: 'code', detail: failureTail(r, 600) || `mushi-ux ended with code ${r.code}.` }
  const summary = r.stdout.split('\n').map((l) => l.trim()).find((l) => /session\(s\) reached the goal/.test(l))
  return { result: 'ran', detail: summary ?? 'The test finished and synced.' }
}

/** Run one first-time user test on this machine and say how it ended. */
export async function runFreshEyesClaim(
  t: FreshEyesTarget,
  opts: { projectId: string; apiKey: string; endpoint: string; signal: AbortSignal; log: (line: string) => void; run?: typeof runProc; env?: NodeJS.ProcessEnv },
): Promise<FreshEyesOutcome> {
  const args = ['fresh-eyes', '--request-stdin', '--sync', ...(t.dryRun ? ['--dry-run'] : ['--file'])]
  const line = uxCommandLine(args, opts.env ?? process.env)
  // Fixed arguments only, and still never a shell: refuse rather than fall back to one.
  if (line.shell) {
    return { result: 'failed', failureKind: 'infra', detail: "npm's npx was not found next to Node on this computer. Install @mushi-mushi/ux (npm i -g @mushi-mushi/ux) and set MUSHI_UX_BIN to its cli.js." }
  }
  // The accounts' user ids are printed so the sweep can be checked; never an email or a password.
  const ids = t.accounts.map((a) => a.userId).filter((x): x is string => !!x)
  opts.log(`first-time user test ${t.runId}: ${t.sessions} visitor(s)${t.dryRun ? ', look around only' : t.accounts.length ? `, with test accounts${ids.length ? ` ${ids.join(', ')}` : ''}` : ''}`)
  const r = await (opts.run ?? runProc)(line.cmd, line.argv, {
    env: freshEyesEnv(opts.env ?? process.env, { apiKey: opts.apiKey, projectId: opts.projectId, endpoint: opts.endpoint }),
    input: freshEyesStdin(t),
    timeoutMs: RUN_TIMEOUT_MS,
    signal: opts.signal,
  })
  return freshEyesOutcome(r, opts.signal.aborted)
}
