/**
 * FILE: report-origin-filter.test.ts
 * PURPOSE: The reports list "Where" filter tells a developer's machine from a
 *          deployed app, without flagging Capacitor apps (https://localhost).
 *
 * 11 of 61 reports on 2026-10-09 came from local dev servers and were not
 * product bugs; glot.it and the-wanting-mind real users report from
 * https://localhost (Capacitor), which must stay "deployed".
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LOCAL_DEV_URL_PATTERN,
  isLocalDevUrl,
  reportOriginFilter,
} from '../../supabase/functions/_shared/report-origin.ts'

describe('isLocalDevUrl', () => {
  it('flags dev servers, LAN phones and dev hostnames', () => {
    for (const url of [
      'http://localhost:8081/albums',
      'http://127.0.0.1:8081/',
      'http://localhost:5174/bank-statement?tab=accounts',
      'http://192.168.0.12:8081',
      'http://my-mac.local:3000/',
    ]) {
      expect(isLocalDevUrl(url), url).toBe(true)
    }
  })

  it('leaves Capacitor apps and real sites alone', () => {
    for (const url of ['https://localhost/', 'capacitor://localhost/home', 'https://kensaur.us/the-wanting-mind/', null]) {
      expect(isLocalDevUrl(url), String(url)).toBe(false)
    }
  })
})

describe('reportOriginFilter', () => {
  it('local is one imatch on the page URL', () => {
    expect(reportOriginFilter('local')).toEqual({
      kind: 'filter',
      column: 'environment->>url',
      operator: 'imatch',
      value: LOCAL_DEV_URL_PATTERN,
    })
  })

  it('deployed keeps reports with no page URL (native apps, Sentry)', () => {
    const f = reportOriginFilter('deployed')
    expect(f).toEqual({
      kind: 'or',
      clause: `environment->>url.is.null,environment->>url.not.imatch."${LOCAL_DEV_URL_PATTERN}"`,
    })
  })

  it('anything else is not a filter', () => {
    expect(reportOriginFilter('moon')).toBeNull()
  })
})

describe('list route wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/reports.ts'), 'utf8')
  it('rejects an unknown origin and applies the filter', () => {
    expect(src).toContain("const originParam = c.req.query('origin')?.trim() ?? '';")
    expect(src).toContain('`origin must be one of: ${REPORT_ORIGIN_FILTERS.join(\', \')}`')
    expect(src).toContain("if (originFilter?.kind === 'or') orGroups.push(originFilter.clause);")
  })
})
