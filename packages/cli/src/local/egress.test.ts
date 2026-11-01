import { describe, expect, it } from 'vitest'
import { hostCheck, renderStatus, renderVerify, type EgressSelftest } from './egress.js'

const PASSING: EgressSelftest = {
  localOnly: true,
  results: [
    { host: 'api.anthropic.com', outcome: 'blocked_by_mushi', ms: 1 },
    { host: 'registry.npmjs.org', outcome: 'network_unreachable', ms: 3001 },
  ],
  passed: true,
}

describe('renderVerify', () => {
  it('passes when local-only is on and nothing was reachable', () => {
    const r = renderVerify(PASSING, null)
    expect(r.ok).toBe(true)
    expect(r.lines.at(-1)).toBe('Nothing left this stack.')
    expect(r.lines.join('\n')).toMatch(/api\.anthropic\.com\s+blocked by Mushi \(1 ms\)/)
  })

  it('names every reachable host, from the stack or this machine', () => {
    const r = renderVerify(PASSING, [
      { host: 'api.anthropic.com', outcome: 'network_unreachable', ms: 3000 },
      { host: 'registry.npmjs.org', outcome: 'reachable', ms: 40 },
    ])
    expect(r.ok).toBe(false)
    expect(r.reachable).toEqual(['registry.npmjs.org'])
    expect(r.lines.at(-1)).toBe('These hosts were reachable: registry.npmjs.org')
    expect(r.lines.join('\n')).toContain('From this machine')
  })

  it('fails when local-only is off, even if nothing answered', () => {
    const r = renderVerify({ ...PASSING, localOnly: false, passed: false }, null)
    expect(r.ok).toBe(false)
    expect(r.lines.at(-1)).toMatch(/Local-only is off/)
  })
})

describe('renderStatus', () => {
  it('prints the switch, allowlist, denials and integrations', () => {
    const text = renderStatus({
      localOnly: true,
      allowlist: ['db.internal'],
      denials: [{ host: 'api.openai.com', caller: 'classify-report', day: '2026-10-21', count: 3, lastAt: null }],
      integrations: [{ id: 'sentry', label: 'Sentry', destination: 'sentry.io', enabled: true, allowed: false, note: 'blocked' }],
    }).join('\n')
    expect(text).toContain('Local-only: on')
    expect(text).toContain('  db.internal')
    expect(text).toMatch(/2026-10-21\s+api\.openai\.com\s+3\s+classify-report/)
    expect(text).toMatch(/Sentry\s+sentry\.io\s+yes\s+no\s+blocked/)
  })

  it('says how to turn local-only on', () => {
    expect(renderStatus({ localOnly: false, allowlist: [], denials: [], integrations: [] })[0]).toMatch(/off .*MUSHI_LOCAL_ONLY=1/)
  })
})

describe('hostCheck', () => {
  it('tries port 443 of each host with a 3 s timeout and never throws', async () => {
    const seen: Array<[string, number, number]> = []
    const res = await hostCheck(['a.test', 'b.test'], async (host, port, timeoutMs) => {
      seen.push([host, port, timeoutMs])
      if (host === 'b.test') throw new Error('boom')
      return 'reachable'
    })
    expect(seen).toEqual([['a.test', 443, 3000], ['b.test', 443, 3000]])
    expect(res.map((r) => [r.host, r.outcome])).toEqual([['a.test', 'reachable'], ['b.test', 'network_unreachable']])
  })
})
