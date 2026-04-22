/**
 * FILE: apps/admin/src/lib/userAgent.ts
 * PURPOSE: Tiny, dependency-free user-agent parser for the report-detail
 *          Environment card. The raw UA string is useless to triagers —
 *          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
 *          (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36" is visual
 *          noise. This module extracts the three facts that actually matter
 *          (Browser + version, OS, Engine) so the UI can render them as
 *          scannable chips instead of a prose wall.
 *
 *          Intentionally minimal — we only need to recognise the common
 *          desktop/mobile browsers. `raw` is always preserved so the user
 *          can copy the full string if they need the edge-case bits
 *          (architecture, build number, embedded SDK markers).
 */

export interface ParsedUserAgent {
  browser: string | null
  browserVersion: string | null
  os: string | null
  engine: string | null
  mobile: boolean
  raw: string
}

/**
 * Extracts browser, OS, and engine from a standard user-agent string.
 * Returns null fields when nothing matches — the caller decides whether to
 * fall back to raw.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const raw = (ua ?? '').trim()
  if (!raw) {
    return { browser: null, browserVersion: null, os: null, engine: null, mobile: false, raw }
  }

  // Browser detection order matters — Edge's UA includes "Chrome", Opera's
  // includes "Chrome" and "Safari", etc. Check the most specific tokens first.
  const browserRules: Array<[RegExp, string]> = [
    [/Edg\/([\d.]+)/i,       'Edge'],
    [/OPR\/([\d.]+)/i,       'Opera'],
    [/Firefox\/([\d.]+)/i,   'Firefox'],
    [/Chrome\/([\d.]+)/i,    'Chrome'],
    [/Version\/([\d.]+).*Safari\//i, 'Safari'],
    [/Safari\/([\d.]+)/i,    'Safari'],
  ]
  let browser: string | null = null
  let browserVersion: string | null = null
  for (const [re, name] of browserRules) {
    const m = raw.match(re)
    if (m) {
      browser = name
      browserVersion = m[1]?.split('.').slice(0, 2).join('.') ?? null
      break
    }
  }

  const osRules: Array<[RegExp, string]> = [
    [/Windows NT 10\.0/i, 'Windows 10/11'],
    [/Windows NT 6\.3/i,  'Windows 8.1'],
    [/Windows NT 6\.2/i,  'Windows 8'],
    [/Windows NT 6\.1/i,  'Windows 7'],
    [/Windows/i,          'Windows'],
    [/Mac OS X ([\d_.]+)/i, 'macOS'],
    [/Android ([\d.]+)/i,   'Android'],
    [/iPhone OS ([\d_]+)/i, 'iOS'],
    [/iPad.*OS ([\d_]+)/i,  'iPadOS'],
    [/Linux/i,            'Linux'],
  ]
  let os: string | null = null
  for (const [re, name] of osRules) {
    const m = raw.match(re)
    if (m) {
      const version = m[1]?.replace(/_/g, '.')?.split('.').slice(0, 2).join('.') ?? null
      os = version && !/Windows/i.test(name) ? `${name} ${version}` : name
      break
    }
  }

  const engine = /WebKit/i.test(raw)
    ? /Blink|Chrome/i.test(raw)
      ? 'Blink'
      : 'WebKit'
    : /Gecko\/\d/i.test(raw)
      ? 'Gecko'
      : null

  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(raw)

  return { browser, browserVersion, os, engine, mobile, raw }
}
