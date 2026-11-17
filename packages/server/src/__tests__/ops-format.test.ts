/**
 * FILE: ops-format.test.ts
 * PURPOSE: The pure half of the Ops hub (docs/execplans/ops-hub-slack.md):
 *          the PII guard (and what it must NOT flag: amounts, dates, ids),
 *          the Slack payload for one event, where an event goes in a thread,
 *          and the slash command grammar.
 */
import { describe, expect, it } from 'vitest'
import {
  buildOpsMessage,
  buildResolvedParent,
  clampEvent,
  findEventPii,
  findPii,
  formatMoney,
  matchApp,
  opsEmoji,
  opsHelpText,
  parseMuteDuration,
  parseOpsCommand,
  planThread,
  redactEventPii,
  redactPii,
  type OpsEventRow,
} from '../../supabase/functions/_shared/ops-format.ts'

function row(over: Partial<OpsEventRow> = {}): OpsEventRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: 'org-1',
    project_id: 'proj-1',
    category: 'payments',
    severity: 'info',
    kind: 'payment.succeeded',
    title: 'New subscription',
    body: 'Pro plan, monthly',
    facts: [{ label: 'Plan', value: 'Pro' }],
    url: 'https://dashboard.stripe.com/payments/pi_1',
    amount_minor: 1200,
    currency: 'JPY',
    thread_key: null,
    dedupe_key: null,
    parent_id: null,
    occurred_at: '2026-11-17T05:02:00.000Z',
    source: 'app',
    slack_channel: null,
    slack_ts: null,
    slack_thread_ts: null,
    slack_error: null,
    acked_by: null,
    acked_at: null,
    ...over,
  }
}

describe('PII guard', () => {
  it('finds emails and phone numbers', () => {
    expect(findPii('paid by jane.doe@example.com')).toBe('email')
    expect(findPii('call +81 90-1234-5678 now')).toBe('phone')
    expect(findPii('call 090-1234-5678')).toBe('phone')
    expect(findPii('(555) 123-4567')).toBe('phone')
    expect(findPii('+1 415 555 0100')).toBe('phone')
  })

  it('never flags money, dates, times, versions or ids', () => {
    for (const ok of [
      '¥12,000',
      '$1,234.56',
      '1 234 567 JPY',
      '2026-11-17',
      '2026-11-17T05:02:00Z',
      '14:02:33',
      'v1.36.0',
      '1.2.3',
      '123e4567-e89b-12d3-a456-426614174000',
      '12345678-1234-1234-1234-123456789012',
      '3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39',
      'in_1PxAbCdEfGh12345',
      'INV-2026-0042',
      'order 20261117-0001',
      '192.168.1.1',
      '+12.5%',
      'run 18234567890',
    ]) {
      expect(findPii(ok), ok).toBeNull()
    }
  })

  it('says which field carries it', () => {
    expect(findEventPii({ title: 'ok', body: 'fine', facts: [{ label: 'Customer', value: 'a@b.co' }] })).toEqual({ field: 'facts[0].value', kind: 'email' })
    expect(findEventPii({ title: 'ok', facts: [{ label: 'Plan', value: 'Pro' }] })).toBeNull()
  })

  it('redacts instead of refusing for internal sources: email to its domain, phone to [phone]', () => {
    expect(redactPii('TypeError for jane@example.com at 090-1234-5678')).toBe('TypeError for @example.com at [phone]')
    const out = redactEventPii({ category: 'alerts', severity: 'warn', kind: 'sentry.new_issue', title: 'Failed for bob@acme.io', facts: [{ label: 'User', value: 'x@y.dev' }] })
    expect(out.title).toBe('Failed for @acme.io')
    expect(out.facts?.[0].value).toBe('@y.dev')
  })
})

describe('clampEvent', () => {
  it('trims to the stored bounds and drops non-https links', () => {
    const out = clampEvent({ category: 'alerts', severity: 'warn', kind: 'x.y', title: 'a'.repeat(400), body: 'b'.repeat(900), url: 'http://insecure.test', facts: Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: 'v' })) })
    expect(out.title.length).toBe(150)
    expect(out.body?.length).toBe(600)
    expect(out.url).toBeNull()
    expect(out.facts).toHaveLength(8)
  })
})

describe('Slack message for one event', () => {
  const ctx = { appName: 'glot.it', iconUrl: 'https://cdn.test/glot.png', consoleUrl: 'https://kensaur.us/ops?event=1' }

  it('leads with the app icon and lowercase name, then the emoji headline, the facts and the buttons', () => {
    const msg = buildOpsMessage(row(), ctx)
    expect(msg.text).toBe('glot.it · New subscription')
    const [context, section, facts, actions] = msg.blocks as Array<Record<string, any>>
    expect(context.type).toBe('context')
    expect(context.elements[0]).toMatchObject({ type: 'image', image_url: 'https://cdn.test/glot.png' })
    expect(context.elements[1].text).toContain('*glot.it*')
    expect(section.text.text).toBe('*💳 New subscription*\nPro plan, monthly')
    expect(facts.elements[0].text).toBe('*Amount:* ¥1,200  ·  *Plan:* Pro')
    expect(actions.elements.map((b: { text: { text: string } }) => b.text.text)).toEqual(['Acknowledge', 'Mute 24h', 'Open', 'Open in Mushi Mushi'])
    expect(actions.elements[0]).toMatchObject({ action_id: 'ops_ack', value: row().id })
  })

  it('escapes Slack control characters from the sender', () => {
    const msg = buildOpsMessage(row({ title: '<!channel> & <b>', body: null, facts: [] }), ctx)
    expect(JSON.stringify(msg.blocks)).not.toContain('<!channel>')
    expect(msg.text).toBe('glot.it · &lt;!channel&gt; &amp; &lt;b&gt;')
    expect(buildResolvedParent(row(), { title: '<!here>', occurred_at: '2026-11-17T00:00:00Z' }, ctx).text).not.toContain('<!here>')
    expect((msg.blocks[1] as any).text.text).toBe('*💳 &lt;!channel&gt; &amp; &lt;b&gt;*')
  })

  it('shows a refund with a minus sign and the refund emoji', () => {
    const msg = buildOpsMessage(row({ kind: 'refund.succeeded', title: 'Refund', amount_minor: 500, currency: 'USD', facts: [] }), ctx)
    expect((msg.blocks[1] as any).text.text).toContain('↩️')
    expect((msg.blocks[2] as any).elements[0].text).toBe('*Amount:* −$5.00')
  })

  it('a resolved event has no Acknowledge or Mute buttons', () => {
    const msg = buildOpsMessage(row({ category: 'alerts', severity: 'resolved', url: null }), { ...ctx, consoleUrl: null })
    expect(msg.blocks.find((b) => (b as { type: string }).type === 'actions')).toBeUndefined()
  })

  it('picks one emoji per kind of event', () => {
    expect(opsEmoji({ category: 'alerts', severity: 'urgent', kind: 'deploy.failed' })).toBe('🔴')
    expect(opsEmoji({ category: 'alerts', severity: 'warn', kind: 'x' })).toBe('⚠️')
    expect(opsEmoji({ category: 'releases', severity: 'info', kind: 'deploy.succeeded' })).toBe('🚀')
    expect(opsEmoji({ category: 'alerts', severity: 'resolved', kind: 'x' })).toBe('✅')
  })

  it('edits a resolved parent: a ✅ line on top, no buttons', () => {
    const parent = row({ category: 'alerts', severity: 'urgent', title: 'Production deploy failed', slack_ts: '1.1', slack_channel: 'C1' })
    const edit = buildResolvedParent(parent, { title: 'Fixed by the next deploy', occurred_at: '2026-11-17T14:02:00Z' }, ctx)
    expect((edit.blocks[0] as any).elements[0].text).toBe('✅ Fixed by the next deploy · 14:02 UTC')
    expect(edit.blocks.some((b) => (b as { type: string }).type === 'actions')).toBe(false)
  })
})

describe('threads', () => {
  it('a first event posts on its own', () => {
    expect(planThread({ severity: 'urgent' }, null, 'C1')).toEqual({ threadTs: null, broadcast: false, updateParent: false })
  })
  it('a follow-up replies under its parent; a resolve is broadcast and edits the parent', () => {
    const parent = { slack_ts: '171.0001', slack_channel: 'C1' }
    expect(planThread({ severity: 'warn' }, parent, 'C1')).toEqual({ threadTs: '171.0001', broadcast: false, updateParent: false })
    expect(planThread({ severity: 'resolved' }, parent, 'C1')).toEqual({ threadTs: '171.0001', broadcast: true, updateParent: true })
  })
  it('a parent in another channel, or never posted, cannot be replied to', () => {
    expect(planThread({ severity: 'resolved' }, { slack_ts: '1.1', slack_channel: 'C2' }, 'C1').threadTs).toBeNull()
    expect(planThread({ severity: 'resolved' }, { slack_ts: null, slack_channel: null }, 'C1').threadTs).toBeNull()
  })
})

describe('slash command grammar', () => {
  it('parses every subcommand', () => {
    expect(parseOpsCommand('')).toEqual({ sub: 'help' })
    expect(parseOpsCommand('status')).toEqual({ sub: 'status' })
    expect(parseOpsCommand('sales')).toEqual({ sub: 'sales', range: 'today' })
    expect(parseOpsCommand('sales week')).toEqual({ sub: 'sales', range: 'week' })
    expect(parseOpsCommand('SALES Month')).toEqual({ sub: 'sales', range: 'month' })
    expect(parseOpsCommand('releases')).toEqual({ sub: 'releases', n: 5 })
    expect(parseOpsCommand('releases 50')).toEqual({ sub: 'releases', n: 20 })
    expect(parseOpsCommand('alerts')).toEqual({ sub: 'alerts' })
    expect(parseOpsCommand('bugs')).toEqual({ sub: 'bugs' })
    expect(parseOpsCommand('ci')).toEqual({ sub: 'ci' })
    expect(parseOpsCommand('apps')).toEqual({ sub: 'apps' })
    expect(parseOpsCommand('mute glot.it 2h')).toEqual({ sub: 'mute', app: 'glot.it', ms: 7_200_000, label: '2h' })
    expect(parseOpsCommand('mute yen yen 1d')).toMatchObject({ sub: 'mute', app: 'yen yen', ms: 86_400_000 })
    expect(parseOpsCommand('unmute glot.it')).toEqual({ sub: 'unmute', app: 'glot.it' })
  })
  it('answers usage for bad input', () => {
    expect(parseOpsCommand('sales year').sub).toBe('usage')
    expect(parseOpsCommand('releases -1').sub).toBe('usage')
    expect(parseOpsCommand('mute glot.it').sub).toBe('usage')
    expect(parseOpsCommand('mute glot.it 30d').sub).toBe('usage')
    expect(parseOpsCommand('unmute').sub).toBe('usage')
    expect(parseOpsCommand('dance').sub).toBe('usage')
  })
  it('caps a mute at 7 days', () => {
    expect(parseMuteDuration('7d')?.ms).toBe(604_800_000)
    expect(parseMuteDuration('8d')).toBeNull()
    expect(parseMuteDuration('0h')).toBeNull()
  })
  it('the help card uses the team’s own command name', () => {
    expect(opsHelpText('/kensaurus')).toContain('`/kensaurus sales [today|week|month]`')
  })
  it('finds an app by name, slug or unique prefix', () => {
    const apps = [
      { id: '1', name: 'glot.it', slug: 'glot-it' },
      { id: '2', name: 'yen-yen', slug: 'yen-yen' },
      { id: '3', name: 'yen-yen admin', slug: 'yen-admin' },
    ]
    expect(matchApp(apps, 'GLOT.IT')).toMatchObject({ ok: true, app: { id: '1' } })
    expect(matchApp(apps, 'glot')).toMatchObject({ ok: true, app: { id: '1' } })
    expect(matchApp(apps, 'yen-yen')).toMatchObject({ ok: true, app: { id: '2' } })
    expect(matchApp(apps, 'yen')).toMatchObject({ ok: false })
    expect(matchApp(apps, 'nope')).toMatchObject({ ok: false })
  })
})

describe('money', () => {
  it('uses each currency’s own minor unit', () => {
    expect(formatMoney(12000, 'JPY')).toBe('¥12,000')
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56')
  })
})
