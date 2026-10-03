import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  bindFindingsToRegistry,
  compareSemver,
  npmLatestStable,
  parseSemver,
  upgradeCandidates,
  upgradeTarget,
} from '../_shared/modernizer-versions.ts'

const v = (s: string) => parseSemver(s)!

Deno.test('tsumagoi 2026-10-02: the model proposed downgrades; the registry check files nothing', () => {
  // What the model stored: @sentry/react ^10.45.0 → 8.55.0, @stripe/react-stripe-js ^6.2.0 → 3.5.0.
  // Even if a stale or broken registry answered the same, no proposal is filed.
  assertEquals(upgradeTarget('^10.45.0', '8.55.0'), null)
  assertEquals(upgradeTarget('^6.2.0', '3.5.0'), null)
  // And with npm's real latest inside the declared range, nothing either.
  assertEquals(upgradeTarget('^10.45.0', '10.52.0'), null)
  assertEquals(upgradeTarget('^6.2.0', '6.2.0'), null)
})

Deno.test('the model\'s versions are replaced by the manifest and the registry', () => {
  const candidates = upgradeCandidates(
    [
      { name: '@sentry/react', version: '^10.45.0' },
      { name: '@stripe/react-stripe-js', version: '^6.2.0' },
      { name: 'next', version: '^14.2.3' },
    ],
    new Map([
      ['@sentry/react', '10.52.0'],
      ['@stripe/react-stripe-js', '6.4.0'],
      ['next', '15.1.0'],
    ]),
  )
  assertEquals(candidates, [{ name: 'next', installed: '^14.2.3', latest: '15.1.0' }])
  const bound = bindFindingsToRegistry(
    [
      { name: '@sentry/react', currentVersion: '^10.45.0', suggestedVersion: '8.55.0', severity: 'major' },
      { name: 'next', currentVersion: '14', suggestedVersion: '15.x latest', severity: 'major' },
      { name: 'next', currentVersion: '14', suggestedVersion: 'dup', severity: 'minor' },
    ],
    candidates,
  )
  assertEquals(bound, [{ name: 'next', currentVersion: '^14.2.3', suggestedVersion: '15.1.0', severity: 'major' }])
})

Deno.test('a strictly newer stable release outside the range is proposed', () => {
  assertEquals(upgradeTarget('^10.45.0', '11.0.0'), '11.0.0')
  assertEquals(upgradeTarget('~6.2.0', '6.3.0'), '6.3.0')
  assertEquals(upgradeTarget('6.2.0', '6.2.1'), '6.2.1')
  // 0.x caret ranges stop at the minor.
  assertEquals(upgradeTarget('^0.99.0', '1.0.0'), '1.0.0')
  assertEquals(upgradeTarget('^0.99.0', '0.99.4'), null)
  // >= ranges admit anything newer: a fresh install already gets it.
  assertEquals(upgradeTarget('>=2.0.0', '3.0.0'), null)
})

Deno.test('prereleases and unparseable ranges are never proposed', () => {
  assertEquals(upgradeTarget('^1.0.0', '2.0.0-beta.1'), null)
  assertEquals(upgradeTarget('workspace:*', '9.9.9'), null)
  assertEquals(upgradeTarget('latest', '9.9.9'), null)
  assertEquals(upgradeTarget('github:org/repo#main', '9.9.9'), null)
  assertEquals(upgradeTarget('^1.2.3 || ^2.0.0', '3.0.0'), null)
  assertEquals(upgradeTarget('^1.0.0', null), null)
  // A prerelease install is behind its own release.
  assertEquals(upgradeTarget('1.0.0-rc.2', '1.0.0'), '1.0.0')
})

Deno.test('semver precedence', () => {
  assertEquals(compareSemver(v('10.45.0'), v('8.55.0')), 1)
  assertEquals(compareSemver(v('1.0.0-rc.2'), v('1.0.0')), -1)
  assertEquals(compareSemver(v('1.0.0-alpha.10'), v('1.0.0-alpha.9')), 1)
  assertEquals(compareSemver(v('1.0.0-alpha'), v('1.0.0-alpha.1')), -1)
  assertEquals(compareSemver(v('2.0.0'), v('2.0.0')), 0)
})

Deno.test('npm latest stable: dist-tags.latest, or the highest release when latest is a prerelease', async () => {
  const registry = (body: unknown, status = 200): typeof fetch =>
    (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch
  assertEquals(await npmLatestStable('@sentry/react', registry({ 'dist-tags': { latest: '10.52.0' } })), '10.52.0')
  assertEquals(
    await npmLatestStable('pkg', registry({ 'dist-tags': { latest: '3.0.0-beta.2' }, versions: { '2.9.0': {}, '2.10.1': {}, '3.0.0-beta.2': {} } })),
    '2.10.1',
  )
  assertEquals(await npmLatestStable('missing', registry({}, 404)), null)
  assertEquals(await npmLatestStable('../etc/passwd', registry({ 'dist-tags': { latest: '1.0.0' } })), null)
  const down: typeof fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch
  assertEquals(await npmLatestStable('pkg', down), null)
})

Deno.test('npm latest stable: a scoped name is one registry path segment, and an extra slash is refused', async () => {
  const urls: string[] = []
  const recording: typeof fetch = ((url: string | URL | Request) => {
    urls.push(String(url))
    return Promise.resolve(new Response(JSON.stringify({ 'dist-tags': { latest: '1.0.0' } })))
  }) as typeof fetch
  assertEquals(await npmLatestStable('@sentry/react', recording), '1.0.0')
  assertEquals(urls, ['https://registry.npmjs.org/@sentry%2freact'])
  assertEquals(await npmLatestStable('@a/b/c', recording), null)
  assertEquals(urls.length, 1)
})
