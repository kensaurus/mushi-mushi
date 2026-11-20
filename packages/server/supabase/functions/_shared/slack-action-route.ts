/**
 * FILE: packages/server/supabase/functions/_shared/slack-action-route.ts
 * PURPOSE: Which handler a Slack click belongs to (2026-11-20).
 *
 *   - `ops_*` actions (the Ops hub's Acknowledge, its ⋯ menu, its links) are
 *     the Ops hub's: slack-interactions forwards them, body and Slack
 *     signature headers untouched, to api-ext's /v1/ops/slack/interactions,
 *     which verifies them with the organization's own signing secret. It
 *     forwards before it audits, so the click has one audit row and the Ops
 *     handler's replay check never sees it twice. A Slack app whose
 *     Interactivity URL points at slack-interactions then still reaches the
 *     Ops handler instead of a report lookup.
 *   - a bug card's ⋯ menu (`report_more:<id>`) carries its choice in
 *     `selected_option.value` (`reply_reporter:<id>`, `dismiss_report_ask:<id>`),
 *     not in action_id: reportAction reads both shapes.
 *
 * Dependency-free: vitest imports it.
 */

interface SlackAction {
  action_id?: string
  value?: string
  type?: string
  selected_option?: { value?: string }
}

/** True for an Ops hub action id (`ops_ack`, `ops_more`, `ops_mute`, `ops_open…`). */
export function isOpsAction(actionId: string | null | undefined): boolean {
  return typeof actionId === 'string' && /^ops_[a-z_]+$/.test(actionId)
}

/** The first action's id from a raw interaction body, without verifying it (routing only). */
export function peekActionId(rawBody: string): string | null {
  try {
    const payload = JSON.parse(new URLSearchParams(rawBody).get('payload') ?? '{}') as { actions?: SlackAction[] }
    const id = payload.actions?.[0]?.action_id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

/**
 * `kind:value` of a report-card click. A menu's choice is in
 * `selected_option.value`; a button's in its action_id (`dismiss_report:<id>`)
 * or, for older cards, in `value`.
 */
export function reportAction(action: SlackAction | undefined): { kind: string; value: string } {
  const raw = action?.type === 'overflow' || action?.selected_option ? (action?.selected_option?.value ?? '') : (action?.action_id ?? '')
  const at = raw.indexOf(':')
  return at >= 0 ? { kind: raw.slice(0, at), value: raw.slice(at + 1) } : { kind: raw, value: action?.value ?? '' }
}

/** The api-ext URL of the Ops interactions route, pinned to the database region when one is set. */
export function opsInteractionsUrl(supabaseUrl: string | null | undefined, region: string | null | undefined): string | null {
  const base = (supabaseUrl ?? '').replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) return null
  const r = region && /^[a-z]{2}-[a-z]+-\d$/.test(region) ? `?forceFunctionRegion=${region}` : ''
  return `${base}/functions/v1/api-ext/v1/ops/slack/interactions${r}`
}

/** Forward the click as Slack sent it. Answers Slack's empty 200 when the hop fails (nothing posted twice). */
export async function forwardOpsInteraction(
  req: { headers: { get(name: string): string | null } },
  rawBody: string,
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': req.headers.get('content-type') ?? 'application/x-www-form-urlencoded' }
  for (const h of ['x-slack-signature', 'x-slack-request-timestamp']) {
    const v = req.headers.get(h)
    if (v) headers[h] = v
  }
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body: rawBody, signal: AbortSignal.timeout(2_500) })
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': res.headers.get('content-type') ?? 'text/plain' } })
  } catch {
    return new Response(null, { status: 200 })
  }
}
