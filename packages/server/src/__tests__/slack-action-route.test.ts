/**
 * FILE: slack-action-route.test.ts
 * PURPOSE: Which handler a Slack click reaches (2026-11-20): an Ops hub
 *          action is forwarded untouched to api-ext's Ops route instead of
 *          the report lookup ("That report no longer exists"); a bug card's
 *          ⋯ menu choice is read from selected_option.value. Also the
 *          owner check behind "Reporter: kenji (owner)".
 */
import { describe, expect, it, vi } from 'vitest'
import {
  forwardOpsInteraction,
  isOpsAction,
  opsInteractionsUrl,
  peekActionId,
  reportAction,
} from '../../supabase/functions/_shared/slack-action-route.ts'
import { reporterIsProjectOwner } from '../../supabase/functions/_shared/reporter-owner.ts'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

const body = (actions: unknown[]) => new URLSearchParams({ payload: JSON.stringify({ type: 'block_actions', trigger_id: 't1', actions }) }).toString()

describe('routing a Slack click', () => {
  it('every Ops hub action goes to the Ops route; report and story actions do not', () => {
    for (const id of ['ops_ack', 'ops_more', 'ops_mute', 'ops_open', 'ops_open_console']) expect(isOpsAction(id)).toBe(true)
    for (const id of ['dispatch_fix:1', 'resolve_report:1', 'report_more:1', 'pause_story:1', '', null]) expect(isOpsAction(id)).toBe(false)
    expect(peekActionId(body([{ action_id: 'ops_ack', value: 'x' }]))).toBe('ops_ack')
    expect(peekActionId('not a form')).toBeNull()
  })

  it('reads a card’s ⋯ menu choice from selected_option.value, a button from its action_id', () => {
    expect(reportAction({ type: 'overflow', action_id: 'report_more:r1', selected_option: { value: 'dismiss_report_ask:r1' } })).toEqual({ kind: 'dismiss_report_ask', value: 'r1' })
    expect(reportAction({ type: 'overflow', action_id: 'report_more:r1', selected_option: { value: 'reply_reporter:r1' } })).toEqual({ kind: 'reply_reporter', value: 'r1' })
    expect(reportAction({ type: 'button', action_id: 'dismiss_report:r1', value: 'r1' })).toEqual({ kind: 'dismiss_report', value: 'r1' })
    expect(reportAction({ type: 'button', action_id: 'dispatch_fix', value: 'r2' })).toEqual({ kind: 'dispatch_fix', value: 'r2' })
  })

  it('forwards the body and Slack’s signature headers as they came, to the region-pinned api-ext route', async () => {
    const url = opsInteractionsUrl('https://x.supabase.co/', 'ap-northeast-1')
    expect(url).toBe('https://x.supabase.co/functions/v1/api-ext/v1/ops/slack/interactions?forceFunctionRegion=ap-northeast-1')
    expect(opsInteractionsUrl('https://x.supabase.co', 'nope')).toBe('https://x.supabase.co/functions/v1/api-ext/v1/ops/slack/interactions')
    expect(opsInteractionsUrl(null, null)).toBeNull()
    const raw = body([{ action_id: 'ops_ack', value: 'e1' }])
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch
    const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded', 'x-slack-signature': 'v0=abc', 'x-slack-request-timestamp': '1795000000' })
    const res = await forwardOpsInteraction({ headers }, raw, url!, fetchImpl)
    expect(res.status).toBe(200)
    const [calledUrl, init] = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(calledUrl).toBe(url)
    expect(init.body).toBe(raw)
    expect(init.headers).toMatchObject({ 'x-slack-signature': 'v0=abc', 'x-slack-request-timestamp': '1795000000' })
  })

  it('a failed hop answers Slack’s empty 200 (nothing retried, nothing posted twice)', async () => {
    const res = await forwardOpsInteraction({ headers: new Headers() }, 'payload=%7B%7D', 'https://x.test/r', (async () => { throw new Error('down') }) as unknown as typeof fetch)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})

describe('reporterIsProjectOwner', () => {
  const OWNER_HASH = 'b0b7a89c3ec53a0b4d4f7f0b6bcfb5d0e8d5a1d2c6e1f7c0e9a3b1d2c4e5f6a7'
  async function sha(s: string) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  function db(emailHash: string | null, ownerEmail: string | null) {
    const fake = makeFakeDb({ end_users: [{ id: 'eu1', email_hash: emailHash }], projects: [{ id: 'p1', owner_id: 'u1' }] }) as unknown as Record<string, unknown>
    fake.auth = { admin: { getUserById: async () => ({ data: { user: ownerEmail ? { email: ownerEmail } : null } }) } }
    return fake
  }

  it('true only when the end user’s email hash is the owner’s', async () => {
    const hash = await sha('owner@example.com')
    expect(await reporterIsProjectOwner(db(hash, ' Owner@Example.com ') as never, 'p1', 'eu1')).toBe(true)
    expect(await reporterIsProjectOwner(db(OWNER_HASH, 'owner@example.com') as never, 'p1', 'eu1')).toBe(false)
    expect(await reporterIsProjectOwner(db(null, 'owner@example.com') as never, 'p1', 'eu1')).toBe(false)
    expect(await reporterIsProjectOwner(db(hash, null) as never, 'p1', 'eu1')).toBe(false)
    expect(await reporterIsProjectOwner(db(hash, 'owner@example.com') as never, 'p1', null)).toBe(false)
  })
})
