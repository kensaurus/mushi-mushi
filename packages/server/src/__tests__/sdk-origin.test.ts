/**
 * FILE: packages/server/src/__tests__/sdk-origin.test.ts
 * PURPOSE: Pins where an SDK key checked in from (_shared/sdk-origin.ts), the
 *          sample that is stored for it, and the migration that keeps it
 *          (project_api_key_origins, plan-simplicity Phase 0):
 *          - five kinds, with a dev machine told apart from a live site the
 *            same way report-origin.ts tells local reports from deployed ones;
 *          - the sample is scheme + host (+ port): the heartbeat falls back to
 *            Referer, so paths, queries, fragments and credentials must never
 *            reach the table;
 *          - the per-isolate write throttle;
 *          - the table is service-role only and the backfill uses the same
 *            local-dev pattern as the classifier.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifySdkOrigin,
  funnelStepForOriginKind,
  LIVE_ORIGIN_KINDS,
  MAX_ORIGIN_SAMPLE_LEN,
  OriginWriteThrottle,
  sanitizeOriginSample,
  SDK_ORIGIN_KINDS,
} from '../../supabase/functions/_shared/sdk-origin.ts'
import { LOCAL_DEV_URL_PATTERN } from '../../supabase/functions/_shared/report-origin.ts'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

function kindOf(origin: string | null, userAgent: string | null = CHROME, sdkPackage: string | null = null) {
  return classifySdkOrigin({ origin, userAgent, sdkPackage }).kind
}

describe('classifySdkOrigin', () => {
  it.each([
    ['http://localhost:5173', 'localhost'],
    ['http://127.0.0.1:8081', 'localhost'],
    ['http://[::1]:3000', 'localhost'],
    ['http://192.168.1.20:8081', 'localhost'],
    ['http://10.0.2.2:8081', 'localhost'],
    ['http://172.20.0.5', 'localhost'],
    ['http://myapp.local:3000', 'localhost'],
    ['http://app.test', 'localhost'],
    ['https://kensaur.us', 'live_web'],
    ['https://glot.it', 'live_web'],
    ['https://my-app.vercel.app', 'live_web'],
    ['http://172.32.0.5', 'live_web'], // outside 172.16/12
    ['capacitor://localhost', 'native'],
    ['ionic://localhost', 'native'],
    ['android-app://com.example.app', 'native'],
    // Capacitor on Android serves its store build from https://localhost (no
    // port); report-origin.ts counts that as deployed, so it is not a dev box.
    ['https://localhost', 'native'],
    ['http://localhost', 'native'],
  ] as const)('%s → %s', (origin, kind) => {
    expect(kindOf(origin)).toBe(kind)
  })

  it('agrees with report-origin.ts on every localhost case', () => {
    const local = new RegExp(LOCAL_DEV_URL_PATTERN, 'i')
    for (const origin of ['http://localhost:5173', 'http://192.168.1.20:8081', 'http://myapp.local:3000']) {
      expect(local.test(origin)).toBe(true)
      expect(kindOf(origin)).toBe('localhost')
    }
    for (const origin of ['https://localhost', 'capacitor://localhost', 'https://kensaur.us']) {
      expect(local.test(origin)).toBe(false)
      expect(kindOf(origin)).not.toBe('localhost')
    }
  })

  it('classifies a Referer by its origin, not its path', () => {
    expect(kindOf('https://kensaur.us/glot-it/learn?lesson=3#top')).toBe('live_web')
    expect(kindOf('http://localhost:5173/settings?tab=keys')).toBe('localhost')
    // A live page whose path mentions localhost is still live.
    expect(kindOf('https://kensaur.us/docs/localhost:5173')).toBe('live_web')
  })

  it('with no Origin, reads the SDK package, then the User-Agent', () => {
    expect(kindOf(null, 'okhttp/4.12.0')).toBe('native')
    expect(kindOf(null, 'glot/42 CFNetwork/1498 Darwin/24.0.0')).toBe('native')
    expect(kindOf(null, 'Dalvik/2.1.0 (Linux; U; Android 14)')).toBe('native')
    expect(kindOf(null, null, '@mushi-mushi/react-native')).toBe('native')
    expect(kindOf(null, 'node', '@mushi-mushi/node')).toBe('server')
    expect(kindOf(null, 'mushi-cli/0.31.0 node/22')).toBe('server')
    expect(kindOf(null, 'curl/8.4.0')).toBe('server')
    expect(kindOf(null, 'GitHub-Actions')).toBe('server')
    // A browser always sends Origin on a cross-origin POST: without one it is
    // a stripped request, not a server.
    expect(kindOf(null, CHROME)).toBe('unknown')
    expect(kindOf(null, null)).toBe('unknown')
    expect(kindOf('', '')).toBe('unknown')
  })

  it('treats Origin: null, file:// and junk as unknown with no sample', () => {
    for (const origin of ['null', 'NULL', 'file:///Users/me/index.html', 'chrome-extension://abc', 'not a url', '://x']) {
      const out = classifySdkOrigin({ origin, userAgent: CHROME })
      expect(out.kind, origin).toBe('unknown')
      expect(out.sample, origin).toBeNull()
    }
  })

  it('keeps no sample for server or unknown check-ins without an Origin', () => {
    expect(classifySdkOrigin({ origin: null, userAgent: 'curl/8' }).sample).toBeNull()
    expect(classifySdkOrigin({ origin: null, userAgent: 'okhttp/4' }).sample).toBeNull()
  })

  it('only knows the five kinds the table allows', () => {
    const migration = readFileSync(resolve(__dirname, '../../supabase/migrations/20261029120000_project_api_key_origins.sql'), 'utf8')
    const check = /origin_kind IN \(([^)]*)\)/.exec(migration)![1]
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...SDK_ORIGIN_KINDS])
  })
})

describe('sanitizeOriginSample', () => {
  it('keeps scheme + host (+ port) and drops path, query, fragment and credentials', () => {
    expect(sanitizeOriginSample('https://kensaur.us/glot-it/learn?token=abc#x')).toBe('https://kensaur.us')
    expect(sanitizeOriginSample('https://user:hunter2@example.com/a?b=c')).toBe('https://example.com')
    expect(sanitizeOriginSample('http://localhost:5173/settings?email=a@b.c')).toBe('http://localhost:5173')
    expect(sanitizeOriginSample('HTTPS://Glot.IT')).toBe('https://glot.it')
    expect(sanitizeOriginSample('  https://glot.it  ')).toBe('https://glot.it')
  })

  it('builds capacitor:// itself (URL.origin is "null" for non-special schemes)', () => {
    expect(new URL('capacitor://localhost').origin).toBe('null')
    expect(sanitizeOriginSample('capacitor://localhost')).toBe('capacitor://localhost')
    expect(sanitizeOriginSample('capacitor://localhost/index.html?x=1')).toBe('capacitor://localhost')
    expect(sanitizeOriginSample('android-app://com.example.app/path')).toBe('android-app://com.example.app')
  })

  it('never returns anything but scheme://host[:port]', () => {
    const inputs = [
      'https://a.example/p/q?r=s#t',
      'https://u:p@a.example:8443/x',
      'http://[::1]:3000/x?y',
      'capacitor://localhost/x#y',
      'https://xn--bcher-kva.example/ü?q',
    ]
    for (const raw of inputs) {
      const sample = sanitizeOriginSample(raw)!
      expect(sample, raw).toMatch(/^[a-z][a-z0-9+.-]*:\/\/[^/?#@\s]+$/)
    }
  })

  it('returns null for empty, null-origin and unparseable input', () => {
    for (const raw of [null, undefined, '', '   ', 'null', 'file:///etc/passwd', 'nonsense']) {
      expect(sanitizeOriginSample(raw as string | null | undefined), String(raw)).toBeNull()
    }
  })

  it('caps the length', () => {
    const host = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.example`
    const sample = sanitizeOriginSample(`https://${host}/path`)!
    expect(sample.length).toBeLessThanOrEqual(MAX_ORIGIN_SAMPLE_LEN)
  })
})

describe('funnelStepForOriginKind', () => {
  it('maps a dev machine to sdk_seen_localhost and a live site or store app to sdk_seen_live', () => {
    expect(funnelStepForOriginKind('localhost')).toBe('sdk_seen_localhost')
    expect(funnelStepForOriginKind('live_web')).toBe('sdk_seen_live')
    expect(funnelStepForOriginKind('native')).toBe('sdk_seen_live')
    expect(funnelStepForOriginKind('server')).toBeNull()
    expect(funnelStepForOriginKind('unknown')).toBeNull()
    expect([...LIVE_ORIGIN_KINDS].sort()).toEqual(['live_web', 'native'])
  })
})

describe('OriginWriteThrottle', () => {
  it('writes once per key and kind per window', () => {
    const t = new OriginWriteThrottle(300_000, 100)
    expect(t.shouldWrite('k1', 'localhost', 0)).toBe(true)
    expect(t.shouldWrite('k1', 'localhost', 1_000)).toBe(false)
    // Another kind or key is its own entry: localhost then live inside 30 s
    // records both.
    expect(t.shouldWrite('k1', 'live_web', 1_000)).toBe(true)
    expect(t.shouldWrite('k2', 'localhost', 1_000)).toBe(true)
    expect(t.shouldWrite('k1', 'localhost', 300_001)).toBe(true)
  })

  it('forgets a failed write so the next check-in retries', () => {
    const t = new OriginWriteThrottle(300_000, 100)
    expect(t.shouldWrite('k1', 'native', 0)).toBe(true)
    t.forget('k1', 'native')
    expect(t.shouldWrite('k1', 'native', 10)).toBe(true)
  })

  it('stays bounded, dropping the oldest entry', () => {
    const t = new OriginWriteThrottle(300_000, 3)
    for (const k of ['a', 'b', 'c', 'd']) expect(t.shouldWrite(k, 'live_web', 0)).toBe(true)
    // 'a' was dropped to make room for 'd', so it writes again.
    expect(t.shouldWrite('a', 'live_web', 1)).toBe(true)
    expect(t.shouldWrite('d', 'live_web', 1)).toBe(false)
  })
})

describe('20261029120000_project_api_key_origins.sql', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261029120000_project_api_key_origins.sql'), 'utf8')

  it('is service-role only: RLS on, no policies, grants revoked', () => {
    expect(sql).toContain('ALTER TABLE public.project_api_key_origins ENABLE ROW LEVEL SECURITY;')
    expect(sql).toContain('REVOKE ALL ON TABLE public.project_api_key_origins FROM PUBLIC, anon, authenticated;')
    expect(sql).not.toMatch(/CREATE POLICY[^;]*project_api_key_origins/i)
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.record_api_key_origin(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.record_api_key_origin(uuid, text, text, integer) TO service_role;')
  })

  it('stores only scheme://host[:port] samples', () => {
    expect(sql).toMatch(/CHECK \(origin_sample IS NULL\s+OR \(char_length\(origin_sample\) <= 200 AND origin_sample ~ '\^\[a-z\]\[a-z0-9\+\.-\]\*:\/\/\[\^\/\?#@\[:space:\]\]\+\$'\)\)/)
  })

  it('backfills with the same local-dev pattern as report-origin.ts', () => {
    const start = sql.indexOf("WHEN sample ~* ('")
    const end = sql.indexOf(") THEN 'localhost'", start)
    expect(start).toBeGreaterThan(-1)
    const pattern = sql
      .slice(start + "WHEN sample ~* (".length, end)
      .split('||')
      .map((part) => part.trim().replace(/^'|'$/g, ''))
      .join('')
    expect(pattern).toBe(LOCAL_DEV_URL_PATTERN)
  })
})
