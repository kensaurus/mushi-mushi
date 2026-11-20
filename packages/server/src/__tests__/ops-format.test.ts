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
  cleanErrorTitle,
  cutAtWord,
  eventCommit,
  muteCovers,
  opsMuteScope,
  opsThreadKey,
  stripLeadingMark,
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

/** Every plain_text object anywhere in a Block Kit payload. */
function plainTexts(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => plainTexts(n, out))
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (o.type === 'plain_text' && typeof o.text === 'string') out.push(o.text)
    for (const v of Object.values(o)) plainTexts(v, out)
  }
  return out
}
const blockOf = (msg: { blocks: unknown[] }, type: string) => msg.blocks.filter((b) => (b as { type: string }).type === type) as Array<Record<string, any>>
const actionLabels = (msg: { blocks: unknown[] }) =>
  (blockOf(msg, 'actions')[0]?.elements ?? []).map((el: Record<string, any>) => (el.type === 'overflow' ? `⋯[${el.options.map((o: any) => o.text.text).join(', ')}]` : el.text.text))

describe('Slack message for one event (one format, 2026-11-20)', () => {
  const ctx = { appName: 'glot.it', iconUrl: 'https://cdn.test/glot.png', consoleUrl: 'https://kensaur.us/ops?event=1' }

  it('context (icon, app · category · env · time), then the title once as a plain_text header, the summary, fields, buttons', () => {
    const msg = buildOpsMessage(row({ facts: [{ label: 'Plan', value: 'Pro' }] }), ctx)
    expect(msg.text).toBe('💳 glot.it: New subscription')
    expect(msg.blocks.map((b) => (b as { type: string }).type)).toEqual(['context', 'header', 'section', 'section', 'actions'])
    const [context, header, summary, fields] = msg.blocks as Array<Record<string, any>>
    expect(context.elements[0]).toMatchObject({ type: 'image', image_url: 'https://cdn.test/glot.png' })
    expect(context.elements[1].text).toMatch(/^glot\.it {2}· {2}Payments {2}· {2}<!date\^\d+\^\{date_short_pretty\} \{time\}\|05:02 UTC>$/)
    expect(header.text).toEqual({ type: 'plain_text', text: '💳 New subscription', emoji: true })
    expect(summary.text).toEqual({ type: 'mrkdwn', text: 'Pro plan, monthly' })
    expect(fields.fields.map((f: { text: string }) => f.text)).toEqual(['*Amount*\n¥1,200', '*Plan*\nPro'])
  })

  it('shows the title once: no legacy attachments, and the title text appears in one block only', () => {
    const msg = buildOpsMessage(row({ category: 'alerts', severity: 'urgent', kind: 'deploy.failed', title: 'Android 1.22.65 release failed', body: null }), ctx)
    expect(msg).not.toHaveProperty('attachments')
    const holders = msg.blocks.filter((b) => JSON.stringify(b).includes('Android 1.22.65 release failed'))
    expect(holders).toHaveLength(1)
    expect((holders[0] as { type: string }).type).toBe('header')
  })

  it('never puts an asterisk around sender text: titles with _ { * … and CJK stay plain_text', () => {
    for (const title of ['Error: new row for relation "glot_exercise_answers" violates check', '*bold* attempt', '回答の受信が途中で切れました…', '🚀 Admin console 0.1.700 is live']) {
      const msg = buildOpsMessage(row({ category: 'alerts', severity: 'warn', kind: 'x', title, body: null, facts: [] }), ctx)
      const header = blockOf(msg, 'header')[0]
      expect(header.text.type).toBe('plain_text')
      for (const t of plainTexts(msg.blocks)) expect(t.startsWith('*') || t.endsWith('*')).toBe(false)
      expect(JSON.stringify(msg.blocks)).not.toMatch(/"\*[^"]*\*"/)
    }
  })

  it('marks a title once, even when the sender already put the mark in (mushi-mushi’s “🚀 Admin console …”)', () => {
    const msg = buildOpsMessage(row({ category: 'releases', kind: 'deploy.succeeded', title: '🚀 Admin console 0.1.700 is live', amount_minor: null, currency: null, facts: [] }), ctx)
    expect(blockOf(msg, 'header')[0].text.text).toBe('🚀 Admin console 0.1.700 is live')
    expect(msg.text).toBe('🚀 glot.it: Admin console 0.1.700 is live')
    expect(stripLeadingMark('⚠️ ⚠️ Disk full')).toBe('Disk full')
    expect(stripLeadingMark('🚀')).toBe('🚀')
  })

  it('names the environment only when the sender verified it, and never says production otherwise', () => {
    const verified = buildOpsMessage(row({ category: 'alerts', severity: 'urgent', kind: 'x', title: 'Checkout error', facts: [{ label: 'Environment', value: 'production' }] }), ctx)
    expect(verified.text).toBe('🔴 glot.it: Checkout error (production)')
    expect(blockOf(verified, 'context')[0].elements[1].text).toContain('  ·  production  ·  ')
    // A verified environment lives in the context line, not again as a field.
    expect(JSON.stringify(blockOf(verified, 'section'))).not.toContain('Environment')
    const unset = buildOpsMessage(row({ category: 'alerts', severity: 'warn', kind: 'x', title: 'Error spike: >10 errors in 15min', body: null, amount_minor: null, currency: null, facts: [{ label: 'Environment', value: 'not set' }] }), ctx)
    expect(JSON.stringify(unset)).not.toContain('production')
    expect(unset.text).toBe('⚠️ glot.it: Error spike: &gt;10 errors in 15min')
    expect(blockOf(unset, 'section')[0].fields[0].text).toBe('*Environment*\nnot set')
  })

  it('at most four fields; the rest of the facts go in one context line, none dropped', () => {
    const facts = [1, 2, 3, 4, 5, 6].map((i) => ({ label: `F${i}`, value: `v${i}` }))
    const msg = buildOpsMessage(row({ amount_minor: null, currency: null, facts }), ctx)
    expect(blockOf(msg, 'section').find((b) => b.fields)!.fields).toHaveLength(4)
    expect(blockOf(msg, 'context')[1].elements[0].text).toBe('*F5*: v5  ·  *F6*: v6')
  })

  it('buttons by kind, three at most: releases and payments get no Acknowledge or Mute', () => {
    const release = buildOpsMessage(row({ category: 'releases', kind: 'deploy.succeeded', title: 'v1 is live', amount_minor: null, currency: null }), ctx)
    expect(actionLabels(release)).toEqual(['Open', 'Open in Mushi Mushi'])
    const payment = buildOpsMessage(row(), ctx)
    expect(actionLabels(payment)).toEqual(['Open', 'Open in Mushi Mushi'])
    const alert = buildOpsMessage(row({ category: 'alerts', severity: 'urgent', kind: 'deploy.failed', title: 'Deploy failed' }), ctx)
    expect(actionLabels(alert)).toEqual(['Acknowledge', 'Open', '⋯[Open in Mushi Mushi, Mute this alert for 24 h]'])
    const [ack, , more] = blockOf(alert, 'actions')[0].elements
    expect(ack).toMatchObject({ action_id: 'ops_ack', value: row().id, style: 'primary' })
    expect(more).toMatchObject({ type: 'overflow', action_id: 'ops_more' })
    expect(more.options[1].value).toBe(`ops_mute:${row().id}`)
    const noLink = buildOpsMessage(row({ category: 'alerts', severity: 'warn', kind: 'x', title: 'Slow', url: null }), ctx)
    // Slack refuses a one-option menu: a lone item is a plain button.
    expect(actionLabels(noLink)).toEqual(['Acknowledge', 'Open in Mushi Mushi', 'Mute 24h'])
    expect(blockOf(noLink, 'actions')[0].elements[2]).toMatchObject({ action_id: 'ops_mute', value: row().id })
    const noConsole = buildOpsMessage(row({ category: 'alerts', severity: 'warn', kind: 'x', title: 'Slow' }), { ...ctx, consoleUrl: null })
    expect(actionLabels(noConsole)).toEqual(['Acknowledge', 'Open', 'Mute 24h'])
    for (const m of [alert, noLink, noConsole]) {
      for (const el of blockOf(m, 'actions')[0].elements) if (el.type === 'overflow') expect(el.options.length).toBeGreaterThanOrEqual(2)
    }
    for (const m of [release, payment, alert, noLink]) expect(blockOf(m, 'actions')[0].elements.length).toBeLessThanOrEqual(3)
  })

  it('escapes Slack control characters from the sender', () => {
    const msg = buildOpsMessage(row({ title: '<!channel> & <b>', body: '<!here> now', facts: [] }), ctx)
    expect(msg.text).toBe('💳 glot.it: &lt;!channel&gt; &amp; &lt;b&gt;')
    expect(JSON.stringify(blockOf(msg, 'section'))).not.toContain('<!here>')
    expect(buildResolvedParent(row(), { title: '<!here>', occurred_at: '2026-11-17T00:00:00Z' }, ctx).text).not.toContain('<!here>')
  })

  it('shows a refund with a minus sign and the refund emoji', () => {
    const msg = buildOpsMessage(row({ kind: 'refund.succeeded', title: 'Refund', amount_minor: 500, currency: 'USD', facts: [] }), ctx)
    expect(blockOf(msg, 'header')[0].text.text).toBe('↩️ Refund')
    expect(blockOf(msg, 'section').find((b) => b.fields)!.fields[0].text).toBe('*Amount*\n−$5.00')
  })

  it('a resolved event has no Acknowledge or Mute, only its links', () => {
    expect(blockOf(buildOpsMessage(row({ category: 'alerts', severity: 'resolved', url: null }), { ...ctx, consoleUrl: null }), 'actions')).toHaveLength(0)
    expect(actionLabels(buildOpsMessage(row({ category: 'alerts', severity: 'resolved' }), ctx))).toEqual(['Open', 'Open in Mushi Mushi'])
  })

  it('picks one emoji per kind of event', () => {
    expect(opsEmoji({ category: 'alerts', severity: 'urgent', kind: 'deploy.failed' })).toBe('🔴')
    expect(opsEmoji({ category: 'alerts', severity: 'warn', kind: 'x' })).toBe('⚠️')
    expect(opsEmoji({ category: 'releases', severity: 'info', kind: 'deploy.succeeded' })).toBe('🚀')
    expect(opsEmoji({ category: 'alerts', severity: 'resolved', kind: 'x' })).toBe('✅')
  })

  it('edits a resolved parent: its mark becomes ✅, a “Resolved:” line under the title, only link buttons', () => {
    const parent = row({ category: 'alerts', severity: 'urgent', kind: 'deploy.failed', title: 'Production deploy failed', slack_ts: '1.1', slack_channel: 'C1' })
    const edit = buildResolvedParent(parent, { title: 'Fixed by the next deploy', occurred_at: '2026-11-17T14:02:00Z' }, ctx)
    expect(blockOf(edit, 'header')[0].text.text).toBe('✅ Production deploy failed')
    expect(blockOf(edit, 'context')[1].elements[0].text).toMatch(/^✅ Resolved: Fixed by the next deploy {2}· {2}<!date\^\d+\^.*\|14:02 UTC>$/)
    expect(actionLabels(edit)).toEqual(['Open', 'Open in Mushi Mushi'])
    expect(edit.text).toBe('✅ glot.it: Production deploy failed (resolved)')
  })
})

describe('fingerprints and mutes', () => {
  it('an alert without a thread key threads on its kind and title; payments and releases never get one', () => {
    expect(opsThreadKey({ category: 'alerts', kind: 'deploy.failed', title: 'Android 1.22.62  release failed', threadKey: null })).toBe('fp:deploy.failed:android 1.22.62 release failed')
    expect(opsThreadKey({ category: 'alerts', kind: 'x', title: 'y', threadKey: 'sentry:1' })).toBe('sentry:1')
    expect(opsThreadKey({ category: 'payments', kind: 'payment.succeeded', title: 'New sale', threadKey: null })).toBeNull()
    expect(opsThreadKey({ category: 'releases', kind: 'deploy.succeeded', title: 'v1', threadKey: null })).toBeNull()
  })

  it('a Mute 24h scope covers that alert’s kind and fingerprint only; the empty scope is the whole app', () => {
    const alert = { category: 'alerts' as const, kind: 'deploy.failed', thread_key: 'fp:deploy.failed:android release failed' }
    const scope = opsMuteScope(alert)
    expect(scope).toBe('alerts:deploy.failed:fp:deploy.failed:android release failed')
    expect(muteCovers(scope, alert)).toBe(true)
    expect(muteCovers(scope, { ...alert, thread_key: 'fp:deploy.failed:ios release failed' })).toBe(false)
    expect(muteCovers(scope, { ...alert, kind: 'sentry.new_issue' })).toBe(false)
    expect(muteCovers(scope, { category: 'payments', kind: 'payment.succeeded', thread_key: null })).toBe(false)
    expect(muteCovers(scope, { category: 'releases', kind: 'deploy.succeeded', thread_key: null })).toBe(false)
    expect(muteCovers('', { category: 'payments', kind: 'payment.succeeded', thread_key: null })).toBe(true)
    expect(muteCovers(undefined, alert)).toBe(true)
  })

  it('reads the short commit an event names', () => {
    expect(eventCommit({ facts: [{ label: 'Commit', value: 'F40221C' }] })).toBe('f40221c')
    expect(eventCommit({ facts: [{ label: 'commit', value: '76f5bb1aa0c3 (main)' }] })).toBe('76f5bb1')
    expect(eventCommit({ facts: [{ label: 'Commit', value: 'n/a' }] })).toBeNull()
    expect(eventCommit({ facts: [] })).toBeNull()
  })
})

describe('error messages as titles', () => {
  it('moves a JSON payload out of the title into a snippet', () => {
    const r = cleanErrorTitle('Error: Langfuse HTTP 410: {"_deprecation":{"message":"Removed on 2026-11-16, except for score events…')
    expect(r.title).toBe('Langfuse HTTP 410')
    expect(r.snippet).toMatch(/^\{"_deprecation":/)
  })

  it('keeps the first line only, the rest as the snippet', () => {
    expect(cleanErrorTitle('TypeError: x is undefined\n  at foo (a.ts:1)')).toEqual({ title: 'TypeError: x is undefined', snippet: 'at foo (a.ts:1)' })
  })

  it('cuts to 120 characters at a word boundary, and hard for text with no spaces', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const cut = cleanErrorTitle(long).title
    expect(cut.length).toBeLessThanOrEqual(120)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.slice(0, -1).split(' ').every((w) => /^word\d+$/.test(w))).toBe(true)
    const ja = 'エラー'.repeat(60)
    expect(cutAtWord(ja, 120)).toHaveLength(120)
  })

  it('an empty message stays empty, for the caller’s fallback', () => {
    expect(cleanErrorTitle('   ').title).toBe('')
    expect(cleanErrorTitle(null).title).toBe('')
  })
})

describe('threads', () => {
  it('a first event posts on its own', () => {
    expect(planThread({ severity: 'urgent' }, null, 'C1')).toEqual({ threadTs: null, broadcast: false, updateParent: false })
  })
  it('a follow-up replies under its parent; a resolve is a thread reply (not broadcast) and edits the parent', () => {
    const parent = { slack_ts: '171.0001', slack_channel: 'C1' }
    expect(planThread({ severity: 'warn' }, parent, 'C1')).toEqual({ threadTs: '171.0001', broadcast: false, updateParent: false })
    expect(planThread({ severity: 'resolved' }, parent, 'C1')).toEqual({ threadTs: '171.0001', broadcast: false, updateParent: true })
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
