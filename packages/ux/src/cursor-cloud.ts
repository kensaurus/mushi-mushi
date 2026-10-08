// SPDX-License-Identifier: MIT
/**
 * `--agent cursor-cloud`: the edit runs in a Cursor Cloud agent (your Cursor
 * plan pays), the measuring stays local. One attempt:
 *
 *   push the run branch → POST /v1/agents on it (workOnCurrentBranch, no PR)
 *   → poll the run → fetch the branch → apply the agent's commit to the
 *   worktree, uncommitted
 *
 * so the loop's own capture, verdict and commit/revert work unchanged. The
 * agent cannot see the local `.mushi-ux/` files, so the prompt text and the
 * screenshots are sent inline.
 *
 * Wire shape: cursor.com/docs/cloud-agent/api/endpoints (read 2026-10-06).
 * `workOnCurrentBranch: true` makes the agent push to the run branch itself
 * instead of a new `cursor/...` branch, so every push of a run is under
 * `mushi-ux/**` and one `branches-ignore` keeps the host's CI quiet. The next
 * attempt's force-with-lease push replaces whatever the loop did not keep.
 * Images are `{ data, mimeType }`, at most 5; if Cursor still refuses them the
 * run goes on text only.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentAdapter, AgentRunOptions } from './agents.js'
import { run, type RunResult } from './proc.js'
import { SCRATCH_DIR } from './worktree.js'

const API = 'https://api.cursor.com'
const POLL_MS = 10_000
const MAX_IMAGES = 4 // Cursor allows 5

export interface CursorCloudDeps {
  fetch?: typeof fetch
  apiKey?: string
  /** Override the repo URL read from `git remote get-url origin` (tests). */
  repoUrl?: string
  sleep?: (ms: number) => Promise<void>
}

async function git(cwd: string, args: string[], stdin?: string): Promise<RunResult> {
  return run('git', args, { cwd, stdin, timeoutMs: 120_000 })
}

/** `git@github.com:o/r.git` / `https://github.com/o/r(.git)` → `https://github.com/o/r`. */
export function httpsRepoUrl(remote: string): string | null {
  const s = remote.trim()
  const ssh = s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(\.git)?$/)
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`
  const https = s.match(/^https:\/\/(?:[^@/]+@)?github\.com\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/)
  if (https) return `https://github.com/${https[1]}/${https[2]}`
  return null
}

/** Model spec like `grok-4.7?reasoning_effort=xhigh` → Cursor's `{ id, params }`. */
export function cursorModel(spec: string | null | undefined): Record<string, unknown> | undefined {
  if (!spec) return undefined
  const [id, query] = spec.split('?')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id)) return undefined
  const params = query
    ? query.split('&').filter(Boolean).map((p) => {
        const [k, v] = p.split('=')
        return { id: k, value: v ?? '' }
      })
    : []
  return params.length ? { id, params } : { id }
}

function promptAndImages(cwd: string): { text: string; images: Array<{ data: string; mimeType: 'image/png' }> } {
  const dir = join(cwd, SCRATCH_DIR)
  const text = readFileSync(join(dir, 'PROMPT.md'), 'utf8')
  const images = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .slice(0, MAX_IMAGES)
    .map((f) => ({ data: readFileSync(join(dir, f)).toString('base64'), mimeType: 'image/png' as const }))
  // The cloud agent sees the screenshots inline, not at these paths.
  return { text: text.replace(/\.mushi-ux\/(desktop|mobile)\.png/g, 'the attached $1 screenshot'), images }
}

export function cursorCloudAdapter(deps: CursorCloudDeps = {}): AgentAdapter {
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  return {
    name: 'cursor-cloud',
    verified: false,
    async run({ cwd, model, timeoutMs, onLine }: AgentRunOptions): Promise<RunResult> {
      const started = Date.now()
      const log = (l: string) => onLine?.(l)
      const fail = (tail: string): RunResult => ({ exitCode: 1, timedOut: false, durationMs: Date.now() - started, tail, stdout: '' })
      const apiKey = deps.apiKey ?? process.env.CURSOR_API_KEY
      if (!apiKey) return fail('CURSOR_API_KEY is not set. Create one at cursor.com/settings (Integrations → API keys).')

      const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
      const remote = deps.repoUrl ?? httpsRepoUrl((await git(cwd, ['remote', 'get-url', 'origin'])).stdout)
      if (!remote) return fail('cursor-cloud needs an `origin` remote on GitHub.')
      log(`pushing ${branch} so the cloud agent can start from it`)
      const push = await git(cwd, ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${branch}`])
      if (push.exitCode !== 0) return fail(`Could not push ${branch}: ${push.tail.trim()}`)

      const { text, images } = promptAndImages(cwd)
      const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      const body = (withImages: boolean) =>
        JSON.stringify({
          prompt: withImages && images.length ? { text, images } : { text },
          repos: [{ url: remote, startingRef: branch }],
          workOnCurrentBranch: true,
          autoCreatePR: false,
          name: `mushi-ux ${branch}`.slice(0, 100),
          ...(cursorModel(model) ? { model: cursorModel(model) } : {}),
        })
      let res = await doFetch(`${API}/v1/agents`, { method: 'POST', headers, body: body(true) })
      if (res.status === 400 && images.length) {
        log('Cursor refused the inline screenshots; retrying with text only')
        res = await doFetch(`${API}/v1/agents`, { method: 'POST', headers, body: body(false) })
      }
      const created = (await res.json().catch(() => null)) as { agent?: { id?: string }; run?: { id?: string }; error?: { message?: string } } | null
      if (!res.ok || !created?.agent?.id || !created.run?.id) {
        return fail(`Cursor did not start the agent (HTTP ${res.status}): ${created?.error?.message ?? 'no agent id'}`)
      }
      const agentId = created.agent.id
      const runId = created.run.id
      log(`cloud agent ${agentId} running`)

      let status = 'CREATING'
      let resultBranch: string | null = null
      let result = ''
      while (Date.now() - started < timeoutMs) {
        await sleep(POLL_MS)
        const poll = await doFetch(`${API}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`, { headers })
        const r = (await poll.json().catch(() => null)) as { status?: string; result?: string; git?: { branches?: Array<{ branch?: string }> } } | null
        status = r?.status ?? status
        log(`cloud agent ${status.toLowerCase()}`)
        if (status === 'FINISHED' || status === 'ERROR' || status === 'CANCELLED' || status === 'EXPIRED') {
          resultBranch = r?.git?.branches?.find((b) => b.branch)?.branch ?? null
          result = r?.result ?? ''
          break
        }
      }
      if (status !== 'FINISHED') {
        if (Date.now() - started >= timeoutMs) {
          await doFetch(`${API}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', headers }).catch(() => undefined)
          return { exitCode: null, timedOut: true, durationMs: Date.now() - started, tail: `Cloud agent still ${status.toLowerCase()} at the time box; cancelled.`, stdout: '' }
        }
        return fail(`Cloud agent ended ${status.toLowerCase()}. ${result}`.trim())
      }
      if (!resultBranch) return { exitCode: 0, timedOut: false, durationMs: Date.now() - started, tail: result || 'Cloud agent made no edits.', stdout: '' }

      const fetched = await git(cwd, ['fetch', 'origin', resultBranch])
      if (fetched.exitCode !== 0) return fail(`Could not fetch ${resultBranch}: ${fetched.tail.trim()}`)
      const diff = await git(cwd, ['diff', '--binary', 'HEAD', 'FETCH_HEAD'])
      if (diff.stdout.trim()) {
        const applied = await git(cwd, ['apply', '--whitespace=nowarn'], diff.stdout)
        if (applied.exitCode !== 0) return fail(`The agent's change did not apply: ${applied.tail.trim()}`)
      }
      // The loop commits what it keeps; the next push replaces the agent's commit.
      log(`applied the cloud agent's change from ${resultBranch}`)
      return { exitCode: 0, timedOut: false, durationMs: Date.now() - started, tail: result.slice(-2000), stdout: result }
    },
  }
}
