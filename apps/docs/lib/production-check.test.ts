import { describe, expect, it, vi } from 'vitest'
import {
  CHECK_SIGNUP_HREF,
  cachedNotice,
  checkIdFromLocation,
  countLine,
  groupBySeverity,
  isCheckReportPath,
  loadCheck,
  reportShareUrl,
  srcFromSearch,
  urlFromSearch,
  startCheck,
  type CheckFinding,
} from './production-check'

const ID = '0b7c6f3e-2a51-4c8e-9d1f-5a6b7c8d9e0f'
const f = (severity: CheckFinding['severity'], rule: string): CheckFinding => ({ rule, severity, title: rule, why: 'w', fix: 'f' })

describe('report location', () => {
  it('reads the id from ?id= and from /check/<uuid>, nothing else', () => {
    expect(checkIdFromLocation('/mushi-mushi/docs/check', `?id=${ID}`)).toBe(ID)
    expect(checkIdFromLocation(`/mushi-mushi/docs/check/${ID}`, '')).toBe(ID)
    expect(checkIdFromLocation('/mushi-mushi/docs/check', '?id=../../etc')).toBeNull()
    expect(checkIdFromLocation('/mushi-mushi/docs/check', '')).toBeNull()
    expect(isCheckReportPath(`/mushi-mushi/docs/check/${ID}/`)).toBe(true)
    expect(isCheckReportPath('/mushi-mushi/docs/check/not-a-report')).toBe(false)
  })

  it('shares the query-string link and signs up with src=check', () => {
    expect(reportShareUrl(ID)).toMatch(new RegExp(`/check\\?id=${ID}$`))
    expect(CHECK_SIGNUP_HREF).toMatch(/\/signup\?src=check$/)
  })

  it('passes a clean ?src= through and drops anything else', () => {
    expect(srcFromSearch('?src=hn')).toBe('hn')
    expect(srcFromSearch('?src=<script>')).toBeNull()
    expect(srcFromSearch('')).toBeNull()
  })
})

describe('urlFromSearch', () => {
  it('pre-fills an http(s) address from ?url=, and nothing else', () => {
    expect(urlFromSearch('?src=outreach&url=https%3A%2F%2Fgetboativa.com%2F')).toBe('https://getboativa.com/')
    expect(urlFromSearch('?url=http://example.com/a?b=1')).toBe('http://example.com/a?b=1')
    expect(urlFromSearch('?url=javascript%3Aalert(1)')).toBeNull()
    expect(urlFromSearch('?url=not a url')).toBeNull()
    expect(urlFromSearch('?url=https://x.com/' + 'a'.repeat(2050))).toBeNull()
    expect(urlFromSearch('')).toBeNull()
  })
})

describe('cachedNotice', () => {
  it('says a same-day repeat is the earlier report, and whether an email went out', () => {
    expect(cachedNotice(false, true, true)).toBeNull()
    expect(cachedNotice(true, false, false)).toMatch(/already checked in the last 24 hours/)
    expect(cachedNotice(true, true, true)).toMatch(/We emailed you the link\.$/)
    expect(cachedNotice(true, true, false)).toMatch(/No email was sent/)
  })
})

describe('grouping', () => {
  it('groups high → low and drops empty groups', () => {
    const groups = groupBySeverity([f('low', 'a'), f('high', 'b'), f('low', 'c')])
    expect(groups.map((g) => [g.label, g.items.map((i) => i.rule)])).toEqual([
      ['Fix first', ['b']],
      ['Nice to fix', ['a', 'c']],
    ])
  })

  it('counts in plain words', () => {
    expect(countLine([f('high', 'a'), f('high', 'b'), f('medium', 'c')])).toBe('2 to fix first, 1 to fix soon')
    expect(countLine([])).toMatch(/^Nothing to fix/)
  })
})

describe('API calls', () => {
  it('posts url, email and src; surfaces the server message on a refusal', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: false, error: { message: 'You can run 5 checks an hour. Try again later.' } }, { status: 429 }))
    const r = await startCheck({ url: 'acme.app', email: 'a@acme.app', src: 'hn' }, fetchImpl as unknown as typeof fetch)
    expect(r).toEqual({ ok: false, status: 429, message: 'You can run 5 checks an hour. Try again later.' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/v1\/public\/production-check$/)
    expect(JSON.parse(String(init.body))).toEqual({ url: 'acme.app', email: 'a@acme.app', src: 'hn' })
  })

  it('a network failure is a plain message, not a throw', async () => {
    const r = await loadCheck(ID, (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch)
    expect(r.ok).toBe(false)
  })
})
