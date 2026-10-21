/**
 * FILE: packages/cli/src/runner/key.ts
 * PURPOSE: The runner key (scope `runner:write`) that the heartbeat and the job
 *          hooks send to POST /v1/ingest/runner. It can only report runner
 *          health: if a CI job steals it (the hooks run as the same user as
 *          the jobs, so a pull request's code can read the key file), all it
 *          can do is send fake numbers. The CLI's own key (mcp:write can merge
 *          PRs) is never written into a hook key file or a systemd unit.
 *
 *          Where the key comes from, in order: MUSHI_RUNNER_KEY, or a fresh one
 *          minted with the CLI key (POST /v1/admin/projects/:id/runner-key,
 *          needs mcp:write; the plaintext comes back once and is never printed).
 */

import { apiCall, type ApiResult } from '../cli-shared.js'
import type { CliConfig } from '../config.js'
import { MushiCliError } from '../errors.js'

/** Where `mushi runner key` and `mushi runner add` keep the heartbeat's key (root, 0600). */
export const RUNNER_KEY_PATH = '/etc/mushi/runner.key'
/** systemd LoadCredential name; the heartbeat reads $CREDENTIALS_DIRECTORY/<this>. */
export const RUNNER_KEY_CREDENTIAL = 'runner-key'

const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** `runner-<short host>`: the server's key label rule (1-40, lowercase, digits, hyphens). */
export function defaultRunnerKeyLabel(hostname: string): string {
  const short = hostname.split('.')[0]!.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return `runner-${short || 'host'}`.slice(0, 40).replace(/-+$/, '')
}

/** The plaintext key from the mint response, whatever the field is called. */
export function keyFromMintResponse(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  for (const k of ['key', 'apiKey', 'api_key', 'rawKey', 'plaintext']) {
    if (typeof d[k] === 'string' && (d[k] as string).length >= 8) return d[k] as string
  }
  return null
}

/** Refuse to use the CLI's own key where a runner key belongs. */
export function assertNotCliKey(runnerKey: string, cliKey: string | undefined): void {
  if (cliKey && runnerKey === cliKey) {
    throw new MushiCliError(
      'E_INVALID_INPUT',
      'That is your CLI key, not a runner key. A runner key can only report runner health; the CLI key can merge pull requests, so it never goes on a runner.',
      'unset MUSHI_RUNNER_KEY, or set it to a key from `mushi runner key`',
    )
  }
}

export async function mintRunnerKey(config: CliConfig, projectId: string, label: string): Promise<string> {
  if (!LABEL_RE.test(label)) {
    throw new MushiCliError('E_INVALID_INPUT', `Key label "${label}" must be 1-40 lowercase letters, digits and hyphens.`)
  }
  const result: ApiResult<unknown> = await apiCall<unknown>(
    `/v1/admin/projects/${encodeURIComponent(projectId)}/runner-key`,
    config,
    { method: 'POST', body: JSON.stringify({ label }) },
  )
  if (!result.ok) {
    const scope = result.error.code === 'INSUFFICIENT_SCOPE' || result.httpStatus === 403
    throw new MushiCliError(
      'E_INVALID_INPUT',
      `Could not create a runner key: ${result.error.code} — ${result.error.message}`,
      scope ? 'creating one needs a CLI key with mcp:write: run `mushi login --upgrade-scope`' : undefined,
    )
  }
  const key = keyFromMintResponse(result.data)
  if (!key) throw new MushiCliError('E_INVALID_INPUT', 'The server answered without a runner key.')
  assertNotCliKey(key, config.apiKey)
  return key
}

/** MUSHI_RUNNER_KEY, or mint one. Never the CLI key. */
export async function resolveRunnerKey(
  config: CliConfig,
  opts: { projectId: string | undefined; label: string; env?: NodeJS.ProcessEnv },
): Promise<{ key: string; source: 'env' | 'minted' }> {
  const fromEnv = (opts.env ?? process.env)['MUSHI_RUNNER_KEY']?.trim()
  if (fromEnv) {
    assertNotCliKey(fromEnv, config.apiKey)
    return { key: fromEnv, source: 'env' }
  }
  if (!config.apiKey) {
    throw new MushiCliError('E_AUTH_MISSING', 'No runner key and no CLI key to create one.', 'set MUSHI_RUNNER_KEY, or run `mushi login` first')
  }
  if (!opts.projectId) {
    throw new MushiCliError('E_PROJECT_MISSING', 'Which project is the runner key for?', 'pass --project <uuid>, or set MUSHI_RUNNER_KEY')
  }
  return { key: await mintRunnerKey(config, opts.projectId, opts.label), source: 'minted' }
}
