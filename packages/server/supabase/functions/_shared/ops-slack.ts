/**
 * FILE: packages/server/supabase/functions/_shared/ops-slack.ts
 * PURPOSE: The Slack Web API calls the Ops hub makes with an organization's
 *          own bot token: chat.postMessage (store the returned ts),
 *          chat.update (a parent once its incident resolved), reactions.add
 *          (✅ on Acknowledge), auth.test (which workspace and bot a token
 *          belongs to). Plus the incoming-webhook fallback for a team with no
 *          bot token.
 *
 * Rate limits: Slack allows about one message a second per channel
 * (docs.slack.dev, chat.postMessage, read 2026-11-17). On HTTP 429 the call
 * waits for Retry-After, capped at OPS_SLACK_MAX_RETRY_WAIT_MS because it runs
 * inside a request's waitUntil, and tries once more.
 *
 * Fetch and sleep are injected so the vitest suite never touches Slack.
 */

export const SLACK_API_BASE = 'https://slack.com/api'
export const OPS_SLACK_TIMEOUT_MS = 5_000
export const OPS_SLACK_MAX_RETRY_WAIT_MS = 3_000

export interface SlackCallDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type SlackCallResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** One Web API call with a JSON body; a 429 waits (capped) and retries once. */
export async function slackApi<T = Record<string, unknown>>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  deps: SlackCallDeps = {},
): Promise<SlackCallResult<T>> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? defaultSleep
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response
    try {
      res = await fetchImpl(`${SLACK_API_BASE}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPS_SLACK_TIMEOUT_MS),
      })
    } catch (err) {
      return { ok: false, error: `network: ${String(err instanceof Error ? err.message : err).slice(0, 120)}` }
    }
    if (res.status === 429) {
      if (attempt === 0) {
        const wait = Math.min(OPS_SLACK_MAX_RETRY_WAIT_MS, Math.max(0, Number(res.headers.get('retry-after') ?? '1') * 1000))
        await sleep(wait)
        continue
      }
      return { ok: false, error: 'ratelimited' }
    }
    let json: Record<string, unknown>
    try {
      json = (await res.json()) as Record<string, unknown>
    } catch {
      return { ok: false, error: `http_${res.status}` }
    }
    if (json.ok === true) return json as { ok: true } & T
    return { ok: false, error: typeof json.error === 'string' ? json.error.slice(0, 120) : `http_${res.status}` }
  }
  return { ok: false, error: 'ratelimited' }
}

/** The workspace and bot user a token belongs to (auth.test). */
export async function slackAuthTest(token: string, deps: SlackCallDeps = {}): Promise<SlackCallResult<{ team_id: string; user_id: string; team?: string }>> {
  const res = await slackApi<{ team_id?: string; user_id?: string; team?: string }>(token, 'auth.test', {}, deps)
  if (!res.ok) return res
  if (typeof res.team_id !== 'string' || typeof res.user_id !== 'string') return { ok: false, error: 'auth_test_incomplete' }
  return { ok: true, team_id: res.team_id, user_id: res.user_id, team: res.team }
}

export const SLACK_WEBHOOK_HOST = 'hooks.slack.com'

/**
 * Post to an incoming webhook (no ts comes back, so no threads or edits).
 * The host is compared parsed, never as a substring, and must be Slack's.
 */
export async function postSlackWebhook(url: string, payload: Record<string, unknown>, deps: SlackCallDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    return { ok: false, error: 'webhook_url_invalid' }
  }
  if (host !== SLACK_WEBHOOK_HOST) return { ok: false, error: 'webhook_host_not_slack' }
  try {
    const res = await (deps.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(OPS_SLACK_TIMEOUT_MS),
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: `webhook_http_${res.status}` }
  } catch (err) {
    return { ok: false, error: `network: ${String(err instanceof Error ? err.message : err).slice(0, 120)}` }
  }
}

/** True for a string shaped like a Slack bot token (never logged). */
export function looksLikeBotToken(v: string): boolean {
  return /^xoxb-[A-Za-z0-9-]{10,250}$/.test(v)
}

/** True for a string shaped like a Slack signing secret (32+ hex). */
export function looksLikeSigningSecret(v: string): boolean {
  return /^[a-f0-9]{32,64}$/i.test(v)
}
