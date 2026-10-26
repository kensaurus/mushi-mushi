/**
 * `_shared/sdk-health.ts`: each SDK problem and when it does not fire, CSP
 * matching (keywords, schemes, wildcards, ports, paths, the default-src
 * fallback, several policies, meta tags), framework detection, and the task
 * reports' observable "Done when" lines.
 */
import { describe, expect, it } from 'vitest'
import { GLOT_IT_CSP_META } from './fixtures/glot-it-csp-meta.ts'
import {
  appPackageFiles,
  cspAllowsConnect,
  cspTaskReport,
  detectAppTarget,
  installTaskReport,
  metaCspValues,
  mushiDeps,
  packageJsonPaths,
  parseCspPolicies,
  sdkHealthProblems,
  siteUrlsFromManifest,
  sourceMatches,
  type SdkHealthInput,
} from '../../supabase/functions/_shared/sdk-health.ts'

const NOW = new Date('2026-10-26T12:00:00Z')
const API = new URL('https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/reports')
const PAGE = new URL('https://lets-talk.kensaur.us/')
const pkg = (deps: Record<string, string>, devDeps: Record<string, string> = {}) => JSON.stringify({ dependencies: deps, devDependencies: devDeps })

function input(over: Partial<SdkHealthInput> = {}): SdkHealthInput {
  return {
    projectId: 'p1',
    repoConnected: true,
    repoLabel: 'kensaurus/lets-talk',
    packages: { ok: true, value: [{ path: 'package.json', text: pkg({ react: '19.0.0' }, { vite: '7.0.0' }) }] },
    missingCiVars: { ok: true, value: [] },
    lastSeenAt: null,
    nativeEverSeen: false,
    sdkKeyCount: 1,
    openUpgradePr: null,
    latest: { ok: true, value: { '@mushi-mushi/web': '1.33.1', '@mushi-mushi/react-native': '0.24.3' } },
    csp: null,
    now: NOW,
    ...over,
  }
}

const ids = (r: ReturnType<typeof sdkHealthProblems>) => r.problems.map((p) => p.id)

describe('sdkHealthProblems', () => {
  it('not_installed: a readable repo with no @mushi-mushi dependency and no heartbeat', () => {
    const r = sdkHealthProblems(input())
    expect(ids(r)).toEqual(['not_installed'])
    expect(r.problems[0].fix).toEqual({ kind: 'install_task', label: 'File install task' })
    expect(r.installed).toBe(false)
  })

  it('not_installed never fires on an unread repo, an empty repo, or when a heartbeat proves an install', () => {
    const unread = sdkHealthProblems(input({ packages: { ok: false, reason: 'GitHub answered 502' } }))
    expect(ids(unread)).not.toContain('not_installed')
    expect(unread.installed).toBeNull()
    expect(unread.notes.map((n) => n.check)).toContain('repo')
    expect(ids(sdkHealthProblems(input({ packages: { ok: true, value: [] } })))).not.toContain('not_installed')
    const seen = sdkHealthProblems(input({ lastSeenAt: '2026-10-25T00:00:00Z' }))
    expect(ids(seen)).not.toContain('not_installed')
    expect(seen.installed).toBe(true)
  })

  it('the CLI or MCP alone is not the SDK', () => {
    const cliOnly = sdkHealthProblems(input({ packages: { ok: true, value: [{ path: 'package.json', text: pkg({ react: '19' }, { vite: '7', '@mushi-mushi/cli': '^0.30.0', '@mushi-mushi/mcp': '0.24.0' }) }] } }))
    expect(ids(cliOnly)).toEqual(['not_installed'])
    expect(cliOnly.installed).toBe(false)
  })

  it('ci_secrets_missing: names absent and no build has checked in', () => {
    const r = sdkHealthProblems(input({ missingCiVars: { ok: true, value: ['VITE_MUSHI_PROJECT_ID', 'VITE_MUSHI_API_KEY'] } }))
    const p = r.problems.find((x) => x.id === 'ci_secrets_missing')!
    expect(p.fix?.kind).toBe('sync_ci_secrets')
    expect(p.detail).toContain('VITE_MUSHI_PROJECT_ID and VITE_MUSHI_API_KEY are not set')
  })

  it('ci_secrets_missing stays quiet when a web app checks in (its env comes from elsewhere) or CI could not be read', () => {
    const web = input({
      packages: { ok: true, value: [{ path: 'package.json', text: pkg({ '@mushi-mushi/web': '^1.33.1' }, { vite: '7.0.0' }) }] },
      missingCiVars: { ok: true, value: ['VITE_MUSHI_API_KEY'] },
      lastSeenAt: '2026-10-25T00:00:00Z',
    })
    expect(ids(sdkHealthProblems(web))).toEqual([])
    const unknown = sdkHealthProblems(input({ missingCiVars: { ok: false, reason: 'the token cannot list Actions secrets (403)' } }))
    expect(ids(unknown)).not.toContain('ci_secrets_missing')
    expect(unknown.notes.find((n) => n.check === 'ci_secrets')?.detail).toContain('403')
  })

  it('ci_secrets_missing still fires for a native app seen only from the web', () => {
    const r = sdkHealthProblems(input({
      packages: { ok: true, value: [{ path: 'apps/mobile/package.json', text: pkg({ expo: '54.0.0', '@mushi-mushi/react-native': '0.24.3' }) }] },
      missingCiVars: { ok: true, value: ['EXPO_PUBLIC_MUSHI_API_KEY'] },
      lastSeenAt: '2026-10-25T00:00:00Z',
      nativeEverSeen: false,
    }))
    expect(r.problems.find((p) => p.id === 'ci_secrets_missing')?.severity).toBe('warn')
    const seenNative = sdkHealthProblems(input({
      packages: { ok: true, value: [{ path: 'apps/mobile/package.json', text: pkg({ expo: '54.0.0', '@mushi-mushi/react-native': '0.24.3' }) }] },
      missingCiVars: { ok: true, value: ['EXPO_PUBLIC_MUSHI_API_KEY'] },
      lastSeenAt: '2026-10-25T00:00:00Z',
      nativeEverSeen: true,
    }))
    expect(ids(seenNative)).toEqual([])
  })

  it('never_seen: installed with no heartbeat; points at the CI problem instead of a second fix', () => {
    const installed = { ok: true as const, value: [{ path: 'package.json', text: pkg({ '@mushi-mushi/web': '^1.33.1' }, { vite: '7.0.0' }) }] }
    const alone = sdkHealthProblems(input({ packages: installed }))
    expect(ids(alone)).toEqual(['never_seen'])
    expect(alone.problems[0].fix).toBeNull()
    const withCi = sdkHealthProblems(input({ packages: installed, missingCiVars: { ok: true, value: ['VITE_MUSHI_API_KEY'] } }))
    expect(ids(withCi).sort()).toEqual(['ci_secrets_missing', 'never_seen'])
    expect(withCi.problems.find((p) => p.id === 'never_seen')?.detail).toContain('missing CI keys above')
    expect(withCi.problems.filter((p) => p.fix?.kind === 'sync_ci_secrets')).toHaveLength(1)
    expect(ids(sdkHealthProblems(input({ packages: installed, lastSeenAt: '2026-10-25T00:00:00Z' })))).not.toContain('never_seen')
  })

  it('outdated: a registry pin below the newest catalogue version, not workspace: or equal pins', () => {
    const r = sdkHealthProblems(input({
      packages: { ok: true, value: [{ path: 'apps/mobile/package.json', text: pkg({ expo: '54.0.0', '@mushi-mushi/react-native': '0.24.0' }) }] },
      lastSeenAt: '2026-10-25T00:00:00Z',
      nativeEverSeen: true,
    }))
    expect(r.problems[0]).toMatchObject({ id: 'outdated', fix: { kind: 'upgrade_pr' } })
    expect(r.problems[0].detail).toBe('@mushi-mushi/react-native 0.24.0 → 0.24.3 (apps/mobile/package.json).')
    const ok = (spec: string) => sdkHealthProblems(input({
      packages: { ok: true, value: [{ path: 'package.json', text: pkg({ '@mushi-mushi/web': spec }, { vite: '7.0.0' }) }] },
      lastSeenAt: '2026-10-25T00:00:00Z',
    }))
    expect(ids(ok('^1.33.1'))).toEqual([])
    expect(ids(ok('workspace:*'))).toEqual([])
    // A jump of more than one major: the upgrade PR would not bump it either.
    expect(ids(sdkHealthProblems(input({
      packages: { ok: true, value: [{ path: 'package.json', text: pkg({ '@mushi-mushi/web': '1.33.1' }) }] },
      lastSeenAt: '2026-10-25T00:00:00Z',
      latest: { ok: true, value: { '@mushi-mushi/web': '3.0.0' } },
    })))).toEqual([])
    const noCatalog = sdkHealthProblems(input({
      packages: { ok: true, value: [{ path: 'package.json', text: pkg({ '@mushi-mushi/web': '1.0.0' }) }] },
      lastSeenAt: '2026-10-25T00:00:00Z',
      latest: { ok: false, reason: 'db down' },
    }))
    expect(ids(noCatalog)).toEqual([])
    expect(noCatalog.notes.map((n) => n.check)).toContain('versions')
  })

  it('csp_blocks_api only on a read policy that blocks; no site and an unreadable site are notes', () => {
    const blocked = sdkHealthProblems(input({
      lastSeenAt: '2026-10-25T00:00:00Z',
      csp: { ok: true, value: { url: PAGE.toString(), apiOrigin: API.origin, verdict: { allowed: false, directive: 'connect-src', sources: ["'self'"] } } },
    }))
    expect(blocked.problems[0]).toMatchObject({ id: 'csp_blocks_api', fix: { kind: 'csp_task' } })
    const allowed = sdkHealthProblems(input({
      lastSeenAt: '2026-10-25T00:00:00Z',
      csp: { ok: true, value: { url: PAGE.toString(), apiOrigin: API.origin, verdict: { allowed: true, directive: null, sources: [] } } },
    }))
    expect(ids(allowed)).toEqual([])
    expect(allowed.notes).toEqual([])
    expect(sdkHealthProblems(input({ lastSeenAt: '2026-10-25T00:00:00Z' })).notes.map((n) => n.check)).toEqual(['site_csp'])
    expect(sdkHealthProblems(input({ lastSeenAt: '2026-10-25T00:00:00Z', csp: { ok: false, reason: 'timed out' } })).notes[0].detail).toContain('timed out')
  })

  it('an Expo app without the web SDK skips the site CSP check entirely', () => {
    const expo = { ok: true as const, value: [{ path: 'apps/mobile/package.json', text: pkg({ expo: '54.0.0', '@mushi-mushi/react-native': '0.24.3' }) }] }
    const blocked = { ok: true as const, value: { url: PAGE.toString(), apiOrigin: API.origin, verdict: { allowed: false, directive: 'connect-src' as const, sources: ["'self'"] } } }
    const r = sdkHealthProblems(input({ packages: expo, lastSeenAt: '2026-10-25T00:00:00Z', nativeEverSeen: true, csp: blocked }))
    expect(r.problems).toEqual([])
    expect(r.notes).toEqual([])
    expect(sdkHealthProblems(input({ packages: expo, lastSeenAt: '2026-10-25T00:00:00Z', nativeEverSeen: true })).notes).toEqual([])
  })

  it('never seen with no repo (mushi-demo): never_seen plus a Connect your GitHub repo link, never "healthy"', () => {
    const r = sdkHealthProblems(input({ repoConnected: false, packages: { ok: false, reason: 'No primary GitHub repo is connected to this project.' }, missingCiVars: { ok: false, reason: 'no repo' } }))
    expect(ids(r).sort()).toEqual(['never_seen', 'no_repo'])
    expect(r.problems.find((p) => p.id === 'no_repo')).toMatchObject({ fix: null, link: { label: 'Connect your GitHub repo', href: '/connect?project=p1#connect-github' } })
    expect(r.notes.map((n) => n.check)).not.toContain('repo')
  })

  it('never_seen when the repo could not be read, and not beside not_installed', () => {
    expect(ids(sdkHealthProblems(input({ packages: { ok: false, reason: 'GitHub answered 502' } })))).toContain('never_seen')
    expect(ids(sdkHealthProblems(input()))).toEqual(['not_installed'])
  })

  it('stale: Cold on the key legend, over 7 days without a check-in; no fix', () => {
    const r = sdkHealthProblems(input({ lastSeenAt: '2026-10-11T12:00:00Z' }))
    expect(r.problems).toEqual([expect.objectContaining({ id: 'stale', severity: 'warn', fix: null, title: 'Cold: no check-in for 15 days' })])
    expect(ids(sdkHealthProblems(input({ lastSeenAt: '2026-10-19T12:00:01Z' })))).toEqual([])
    expect(ids(sdkHealthProblems(input({ lastSeenAt: '2026-10-19T11:59:59Z' })))).toEqual(['stale'])
  })

  it('no_sdk_key: no active SDK key offers Write CI secrets, once, even with the names present', () => {
    const installed = { ok: true as const, value: [{ path: 'package.json', text: pkg({ '@mushi-mushi/web': '^1.33.1' }, { vite: '7.0.0' }) }] }
    const r = sdkHealthProblems(input({ packages: installed, sdkKeyCount: 0, lastSeenAt: '2026-10-25T00:00:00Z' }))
    expect(r.problems).toEqual([expect.objectContaining({ id: 'no_sdk_key', fix: { kind: 'sync_ci_secrets', label: 'Write CI secrets' } })])
    // The missing names already carry the same fix: no second row.
    const both = sdkHealthProblems(input({ sdkKeyCount: 0, missingCiVars: { ok: true, value: ['VITE_MUSHI_API_KEY'] } }))
    expect(both.problems.filter((p) => p.fix?.kind === 'sync_ci_secrets').map((p) => p.id)).toEqual(['ci_secrets_missing'])
  })

  it('Write CI secrets is never offered for a stale or silent app whose secrets are present', () => {
    const installed = { ok: true as const, value: [{ path: 'package.json', text: pkg({ '@mushi-mushi/web': '^1.33.1' }, { vite: '7.0.0' }) }] }
    for (const lastSeenAt of [null, '2026-09-01T00:00:00Z']) {
      const r = sdkHealthProblems(input({ packages: installed, lastSeenAt }))
      expect(r.problems.some((p) => p.fix?.kind === 'sync_ci_secrets')).toBe(false)
    }
  })

  it('outdated with an open upgrade PR links it and offers no second PR', () => {
    const r = sdkHealthProblems(input({
      packages: { ok: true, value: [{ path: 'apps/mobile/package.json', text: pkg({ expo: '54.0.0', '@mushi-mushi/react-native': '0.24.0' }) }] },
      lastSeenAt: '2026-10-25T00:00:00Z',
      nativeEverSeen: true,
      openUpgradePr: { url: 'https://github.com/kensaurus/yen-yen/pull/359', number: 359, ci: 'failing' },
    }))
    expect(r.problems[0]).toMatchObject({
      id: 'outdated',
      fix: null,
      link: { label: 'Open PR #359', href: 'https://github.com/kensaurus/yen-yen/pull/359' },
    })
    expect(r.problems[0].detail).toMatch(/^Upgrade PR #359 is open; CI failing\. @mushi-mushi\/react-native 0\.24\.0/)
  })

  it('orders errors before warnings before info', () => {
    const r = sdkHealthProblems(input({
      packages: { ok: true, value: [{ path: 'package.json', text: pkg({ '@mushi-mushi/web': '1.0.0' }) }] },
      lastSeenAt: '2026-09-01T00:00:00Z',
      csp: { ok: true, value: { url: PAGE.toString(), apiOrigin: API.origin, verdict: { allowed: false, directive: 'default-src', sources: ["'self'"] } } },
      missingCiVars: { ok: true, value: [] },
      sdkKeyCount: 0,
    }))
    expect(ids(r)).toEqual(['no_sdk_key', 'csp_blocks_api', 'outdated', 'stale'])
  })
})

describe('CSP matching', () => {
  const allows = (...values: string[]) => cspAllowsConnect(parseCspPolicies(values), API, PAGE).allowed

  it('no policy, or a policy with neither connect-src nor default-src, allows it', () => {
    expect(allows()).toBe(true)
    expect(allows("script-src 'self'; frame-ancestors 'none'")).toBe(true)
  })

  it("'self' and 'none' block a different origin", () => {
    expect(allows("connect-src 'self'")).toBe(false)
    expect(allows("connect-src 'none'")).toBe(false)
    expect(sourceMatches("'self'", new URL('https://lets-talk.kensaur.us/api'), PAGE)).toBe(true)
  })

  it('falls back to default-src when connect-src is absent (CSP3)', () => {
    expect(allows("default-src 'self'")).toBe(false)
    expect(allows("default-src 'self' https://*.supabase.co")).toBe(true)
    // connect-src wins over default-src.
    expect(allows("default-src 'self'; connect-src https://dxptnwrhwsqckaftyymj.supabase.co")).toBe(true)
  })

  it('schemes, wildcards and hosts', () => {
    expect(allows('connect-src *')).toBe(true)
    expect(allows('connect-src https:')).toBe(true)
    expect(allows('connect-src http:')).toBe(true)
    expect(allows('connect-src wss:')).toBe(true)
    expect(allows('connect-src data: blob:')).toBe(false)
    expect(allows('connect-src *.supabase.co')).toBe(true)
    expect(allows('connect-src https://*.supabase.co')).toBe(true)
    expect(allows('connect-src https://*.dxptnwrhwsqckaftyymj.supabase.co')).toBe(false)
    expect(allows('connect-src https://supabase.co')).toBe(false)
    expect(allows('connect-src https://DXPTNWRHWSQCKAFTYYMJ.supabase.co')).toBe(true)
    expect(allows('connect-src http://dxptnwrhwsqckaftyymj.supabase.co')).toBe(true)
    expect(allows('connect-src ftp://dxptnwrhwsqckaftyymj.supabase.co')).toBe(false)
  })

  it('ports and paths', () => {
    expect(allows('connect-src https://dxptnwrhwsqckaftyymj.supabase.co:443')).toBe(true)
    expect(allows('connect-src https://dxptnwrhwsqckaftyymj.supabase.co:8443')).toBe(false)
    expect(allows('connect-src https://dxptnwrhwsqckaftyymj.supabase.co:*')).toBe(true)
    expect(allows('connect-src https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/')).toBe(true)
    expect(allows('connect-src https://dxptnwrhwsqckaftyymj.supabase.co/rest/v1/')).toBe(false)
    expect(allows('connect-src https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1')).toBe(false)
  })

  it('every policy must allow it; the first repeated directive wins; names ignore case', () => {
    expect(allows("connect-src https:, connect-src 'self'")).toBe(false)
    expect(allows('connect-src https:', "connect-src 'self'")).toBe(false)
    expect(allows("CONNECT-SRC 'self'; connect-src https:")).toBe(false)
    expect(cspAllowsConnect(parseCspPolicies(["default-src 'self'"]), API, PAGE)).toEqual({ allowed: false, directive: 'default-src', sources: ["'self'"] })
  })

  it("nonces, hashes and other keywords never allow a connection", () => {
    expect(allows("connect-src 'unsafe-inline' 'nonce-abc' 'sha256-xyz' 'strict-dynamic'")).toBe(false)
  })

  it("glot.it's live meta tag (quotes as &#x27;) allows the API through https://*.supabase.co", () => {
    const values = metaCspValues(`<html><head>${GLOT_IT_CSP_META}</head></html>`)
    expect(values).toHaveLength(1)
    expect(values[0]).toContain("connect-src 'self' blob: https://*.supabase.co")
    const policies = parseCspPolicies(values)
    expect(policies[0].get('connect-src')!.slice(0, 3)).toEqual(["'self'", 'blob:', 'https://*.supabase.co'])
    expect(cspAllowsConnect(policies, API, new URL('https://kensaur.us/glot-it/')).allowed).toBe(true)
    expect(cspAllowsConnect(policies, new URL('https://evil.example/x'), new URL('https://kensaur.us/glot-it/')).allowed).toBe(false)
  })

  it('decodes hex, decimal and named entities before splitting on ;', () => {
    expect(metaCspValues('<meta http-equiv="Content-Security-Policy" content="connect-src &#x27;self&#x27; &#39;none&#39; https://a.dev&#59; img-src *">')).toEqual([
      "connect-src 'self' 'none' https://a.dev; img-src *",
    ])
  })

  it('reads meta CSP tags and ignores Report-Only and other metas', () => {
    const html = `<html><head>
      <meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://x.dev">
      <meta http-equiv='content-security-policy-report-only' content="connect-src 'none'">
      <meta name="description" content="connect-src 'none'">
    </head></html>`
    expect(metaCspValues(html)).toEqual(["default-src 'self'; connect-src 'self' https://x.dev"])
    expect(metaCspValues('<meta http-equiv="Content-Security-Policy" content="connect-src &#39;self&#39;">')).toEqual(["connect-src 'self'"])
  })
})

describe('repo reading helpers', () => {
  it('packageJsonPaths: shallow first, no node_modules, fixtures, examples or archived dirs', () => {
    expect(packageJsonPaths([
      'apps/web/package.json',
      'package.json',
      'node_modules/x/package.json',
      'examples/demo/package.json',
      'packages/a/test/fixtures/package.json',
      'apps/old/ARCHIVED.md',
      'apps/old/package.json',
      'a/b/c/d/e/package.json',
      'apps/web/dist/package.json',
      'README.md',
    ])).toEqual(['package.json', 'apps/web/package.json'])
  })

  it('mushiDeps reads both sections and keeps non-registry specs without a version', () => {
    expect(mushiDeps([{ path: 'package.json', text: pkg({ '@mushi-mushi/web': '~1.2.3' }, { '@mushi-mushi/cli': 'workspace:*', react: '19' }) }, { path: 'x/package.json', text: 'not json' }])).toEqual([
      { path: 'package.json', name: '@mushi-mushi/web', spec: '~1.2.3', version: '1.2.3' },
      { path: 'package.json', name: '@mushi-mushi/cli', spec: 'workspace:*', version: null },
    ])
  })

  it("the mushi-mushi monorepo: the SDK's own packages are not the app; the Next docs site is", () => {
    const files = [
      { path: 'package.json', text: JSON.stringify({ name: 'mushi-mushi', devDependencies: { turbo: '2', vite: '7' } }) },
      { path: 'apps/admin/package.json', text: JSON.stringify({ name: '@mushi-mushi/admin', dependencies: { '@mushi-mushi/web': 'workspace:*' }, devDependencies: { vite: '7' } }) },
      { path: 'apps/docs/package.json', text: JSON.stringify({ name: 'docs', dependencies: { next: '16', '@mushi-mushi/web': 'workspace:*' } }) },
      { path: 'packages/react-native/package.json', text: JSON.stringify({ name: '@mushi-mushi/react-native', dependencies: { '@mushi-mushi/core': 'workspace:*' }, devDependencies: { 'react-native': '0.81', expo: '54' } }) },
      { path: 'packages/web/package.json', text: JSON.stringify({ name: '@mushi-mushi/web', dependencies: { '@mushi-mushi/core': '1.30.0' } }) },
    ]
    const apps = appPackageFiles(files)
    expect(apps.map((f) => f.path)).toEqual(['package.json', 'apps/docs/package.json'])
    expect(detectAppTarget(apps)).toMatchObject({ stack: 'nextjs', path: 'apps/docs/package.json', sdkPackage: '@mushi-mushi/web' })
    // Live through the docs site: no Expo CI names, no outdated pin from packages/web.
    const r = sdkHealthProblems(input({ packages: { ok: true, value: files }, lastSeenAt: '2026-10-26T11:30:00Z', latest: { ok: true, value: { '@mushi-mushi/core': '1.33.0' } } }))
    expect(r.problems).toEqual([])
    expect(r.installed).toBe(true)
  })

  it('prefers the root and apps/* over packages/* for the same framework', () => {
    expect(detectAppTarget([
      { path: 'packages/ui/package.json', text: pkg({ next: '16' }) },
      { path: 'apps/site/package.json', text: pkg({ next: '16' }) },
    ])?.path).toBe('apps/site/package.json')
  })

  it('detectAppTarget: Vite, Next, Expo and Capacitor; the app with the framework, not the root', () => {
    expect(detectAppTarget([{ path: 'package.json', text: pkg({ react: '19' }, { vite: '7' }) }])).toMatchObject({ stack: 'vite', dir: '', capacitor: false, sdkPackage: '@mushi-mushi/web' })
    expect(detectAppTarget([{ path: 'package.json', text: pkg({ next: '16' }, { vite: '7', vitest: '3' }) }])?.stack).toBe('nextjs')
    expect(detectAppTarget([
      { path: 'package.json', text: pkg({}, { turbo: '2' }) },
      { path: 'apps/mobile/package.json', text: pkg({ expo: '54', 'react-native': '0.81' }) },
    ])).toMatchObject({ stack: 'expo', path: 'apps/mobile/package.json', dir: 'apps/mobile', sdkPackage: '@mushi-mushi/react-native' })
    expect(detectAppTarget([{ path: 'package.json', text: pkg({ '@capacitor/core': '8' }, { vite: '7' }) }])).toMatchObject({ stack: 'vite', capacitor: true })
    expect(detectAppTarget([{ path: 'package.json', text: pkg({ express: '5' }) }])).toBeNull()
  })

  it('siteUrlsFromManifest keeps https deploy targets only', () => {
    expect(siteUrlsFromManifest({ deploy: { targets: [{ url: 'https://a.dev/' }, { url: 'http://b.dev' }, { url: 'nope' }, {}] } })).toEqual(['https://a.dev/'])
    expect(siteUrlsFromManifest(null)).toEqual([])
  })
})

describe('task reports', () => {
  const base = {
    appName: 'lets-talk',
    repoLabel: 'kensaurus/lets-talk',
    repoUrl: 'https://github.com/kensaurus/lets-talk',
    fallbackStack: 'nextjs' as const,
    projectId: 'proj-1',
    endpoint: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
    workflows: ['.github/workflows/deploy.yml'],
    commitSha: 'abcdef1234567',
  }

  it('install (Vite): VITE_ names, the twm template, the workflow env lines, CSP and observable Done when', () => {
    const r = installTaskReport({ ...base, target: { stack: 'vite', capacitor: false, path: 'package.json', dir: '', sdkPackage: '@mushi-mushi/web' } })
    expect(r.component).toBe('sdk-health:install')
    expect(r.description).toContain('VITE_MUSHI_API_KEY: ${{ secrets.VITE_MUSHI_API_KEY }}')
    expect(r.description).toContain('VITE_MUSHI_PROJECT_ID = proj-1')
    expect(r.description).toContain('`.github/workflows/deploy.yml`')
    expect(r.description).toContain('kensaurus/the-wanting-mind src/lib/mushi.ts')
    expect(r.description).toContain('import.meta.env.VITE_MUSHI_API_KEY')
    expect(r.description).toContain('add `https://dxptnwrhwsqckaftyymj.supabase.co` to its connect-src')
    expect(r.description).toMatch(/Done when:\n- After the PR merges .* SDK check-in/)
    expect(r.description).not.toContain('guideline 2.2')
  })

  it('install (Next): NEXT_PUBLIC_ names and a client-only init', () => {
    const r = installTaskReport({ ...base, target: { stack: 'nextjs', capacitor: false, path: 'apps/web/package.json', dir: 'apps/web', sdkPackage: '@mushi-mushi/web' } })
    expect(r.description).toContain('NEXT_PUBLIC_MUSHI_API_KEY')
    expect(r.description).toContain("'use client'")
    expect(r.description).toContain('apps/web/src/lib/mushi.ts')
  })

  it('install (Expo, Capacitor): the manual launcher rule from App Review guideline 2.2', () => {
    const expo = installTaskReport({ ...base, target: { stack: 'expo', capacitor: false, path: 'apps/mobile/package.json', dir: 'apps/mobile', sdkPackage: '@mushi-mushi/react-native' } })
    expect(expo.description).toContain('EXPO_PUBLIC_MUSHI_API_KEY')
    expect(expo.description).toContain('@mushi-mushi/react-native')
    expect(expo.description).toContain("trigger: 'manual'")
    expect(expo.description).toContain('guideline 2.2')
    expect(expo.description).not.toContain('connect-src')
    const cap = installTaskReport({ ...base, target: { stack: 'vite', capacitor: true, path: 'package.json', dir: '', sdkPackage: '@mushi-mushi/web' } })
    expect(cap.description).toContain('mushi-launcher.ts')
    expect(cap.description).toContain('guideline 2.2')
  })

  it('install with no framework found falls back to the slug stack and says so', () => {
    const r = installTaskReport({ ...base, target: null, workflows: [] })
    expect(r.description).toContain('no framework found in package.json')
    expect(r.description).toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID')
    expect(r.description).toContain('the workflow that builds and deploys the app')
  })

  it('csp: the exact origin, never a wildcard, and a Done when on the live header', () => {
    const r = cspTaskReport({ appName: 'lets-talk', repoLabel: 'kensaurus/lets-talk', siteUrl: 'https://lets-talk.kensaur.us/', apiOrigin: API.origin, verdict: { allowed: false, directive: 'connect-src', sources: ["'self'"] } })
    expect(r.component).toBe('sdk-health:csp')
    expect(r.description).toContain("Current connect-src: 'self'")
    expect(r.description).toContain(`Add \`${API.origin}\` to connect-src. Do not add`)
    expect(r.description).toContain(`https://lets-talk.kensaur.us/ sends a policy whose connect-src includes ${API.origin}`)
    const viaDefault = cspTaskReport({ appName: 'x', repoLabel: null, siteUrl: 'https://x.dev/', apiOrigin: API.origin, verdict: { allowed: false, directive: 'default-src', sources: ["'self'"] } })
    expect(viaDefault.description).toContain('Add a connect-src directive')
  })
})
