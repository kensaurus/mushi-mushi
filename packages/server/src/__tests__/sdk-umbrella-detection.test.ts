/**
 * FILE: sdk-umbrella-detection.test.ts
 * PURPOSE: A host that installs only the `mushi-mushi` umbrella (ADR 0060) is
 *          recognised everywhere the server reads a host's SDK: the repo scan,
 *          the observation guard, SDK health's dependency scan, and the
 *          report-list SDK filter. Old `@mushi-mushi/*` installs keep working.
 */

import { describe, expect, it, vi } from 'vitest'

// sdk-repo-scan imports github-pr.ts, which reads Deno.env at module load.
vi.hoisted(() => {
  const g = globalThis as { Deno?: unknown }
  g.Deno ??= { env: { get: () => undefined } }
})
import { detectDeclaredSdkFromDeps } from '../../supabase/functions/_shared/sdk-repo-scan.ts'
import { isValidSdkObservation } from '../../supabase/functions/_shared/sdk-observation.ts'
import {
  detectAppTarget,
  installTaskReport,
  isMushiPackageName,
  isSdkDependency,
  isSdkPackage,
  mushiDeps,
} from '../../supabase/functions/_shared/sdk-health.ts'
import { computeBumpPlan, isUmbrellaLauncherOnly } from '../../supabase/functions/_shared/sdk-upgrade-plan.ts'
import { resolveSdkPackageFilter } from '../../supabase/functions/_shared/report-list-filters.ts'

const pkg = (dependencies: Record<string, string>, devDependencies: Record<string, string> = {}) =>
  JSON.stringify({ name: 'host-app', dependencies, devDependencies })

describe('repo scan', () => {
  it('reads the umbrella as its own package and version', () => {
    expect(detectDeclaredSdkFromDeps({ 'mushi-mushi': '^1.35.0', react: '^19.0.0' }, {})).toEqual({
      sdkPackage: 'mushi-mushi',
      sdkVersion: '1.35.0',
    })
  })

  it('prefers the umbrella over an old scoped SDK declared next to it', () => {
    expect(detectDeclaredSdkFromDeps({ '@mushi-mushi/react': '1.34.0', 'mushi-mushi': '1.35.0' }, {})?.sdkPackage).toBe('mushi-mushi')
  })

  it('still reads an old scoped install', () => {
    expect(detectDeclaredSdkFromDeps({ '@mushi-mushi/web': '~1.30.2' }, {})).toEqual({
      sdkPackage: '@mushi-mushi/web',
      sdkVersion: '1.30.2',
    })
  })
})

describe('observation guard', () => {
  it('accepts an umbrella observation', () => {
    expect(isValidSdkObservation('mushi-mushi', '1.35.0')).toBe(true)
  })

  it('rejects look-alike names', () => {
    expect(isValidSdkObservation('create-mushi-mushi', '0.6.15')).toBe(false)
    expect(isValidSdkObservation('mushi-mushi-vscode', '1.0.0')).toBe(false)
  })
})

describe('SDK health dependency scan', () => {
  it('counts the umbrella as an installed SDK', () => {
    expect(isSdkPackage('mushi-mushi')).toBe(true)
    expect(isMushiPackageName('mushi-mushi')).toBe(true)
    expect(isMushiPackageName('@mushi-mushi/vue')).toBe(true)
    expect(isMushiPackageName('create-mushi-mushi')).toBe(false)
    expect(mushiDeps([{ path: 'package.json', text: pkg({ 'mushi-mushi': '^1.35.0' }) }])).toEqual([
      { path: 'package.json', name: 'mushi-mushi', spec: '^1.35.0', version: '1.35.0' },
    ])
  })

  it('picks the app that already uses the umbrella', () => {
    expect(detectAppTarget([
      { path: 'apps/a/package.json', text: pkg({ next: '16' }) },
      { path: 'apps/b/package.json', text: pkg({ next: '16', 'mushi-mushi': '1.35.0' }) },
    ])?.path).toBe('apps/b/package.json')
  })

  it('the install task tells a web app to install mushi-mushi', () => {
    const task = installTaskReport({
      appName: 'Host',
      repoLabel: 'o/r',
      repoUrl: 'https://github.com/o/r',
      target: detectAppTarget([{ path: 'package.json', text: pkg({ react: '19' }, { vite: '7' }) }]),
      fallbackStack: 'vite',
      projectId: 'p1',
      endpoint: 'https://example.com/functions/v1/api',
      workflows: [],
      commitSha: '0123456789abcdef',
    })
    expect(task.description).toContain("`mushi-mushi` (`import { Mushi } from 'mushi-mushi'`)")
    expect(task.description).not.toContain('`@mushi-mushi/web`')
  })
})

describe('report-list SDK filter', () => {
  it('resolves the umbrella to the web SDK identity reports carry', () => {
    expect(resolveSdkPackageFilter('mushi-mushi')).toBe('@mushi-mushi/web')
  })
})

// Before ADR 0060, `mushi-mushi` 0.x was only the `npx mushi-mushi` setup
// command. Hosts that keep it as a devDependency to run the wizard have no SDK
// from it, so nothing may read it as one.
describe('the pre-1.0 launcher is not the SDK', () => {
  it('recognises a launcher-only spec, and only for mushi-mushi', () => {
    expect(isUmbrellaLauncherOnly('mushi-mushi', '^0.8.15')).toBe(true)
    expect(isUmbrellaLauncherOnly('mushi-mushi', '0.8.15')).toBe(true)
    expect(isUmbrellaLauncherOnly('mushi-mushi', '^1.35.0')).toBe(false)
    expect(isUmbrellaLauncherOnly('mushi-mushi', 'latest')).toBe(false)
    expect(isUmbrellaLauncherOnly('mushi-mushi', 'workspace:^')).toBe(false)
    expect(isUmbrellaLauncherOnly('@mushi-mushi/web', '^0.9.0')).toBe(false)
  })

  it('the repo scan reports the scoped SDK, not the launcher next to it', () => {
    expect(detectDeclaredSdkFromDeps({ 'mushi-mushi': '^0.8.15', '@mushi-mushi/web': '1.34.1' }, {})).toEqual({
      sdkPackage: '@mushi-mushi/web',
      sdkVersion: '1.34.1',
    })
    expect(detectDeclaredSdkFromDeps({ 'mushi-mushi': '^0.8.15' }, {})).toBeNull()
  })

  it('SDK health does not count the launcher as an installed SDK', () => {
    const [dep] = mushiDeps([{ path: 'package.json', text: pkg({ react: '^19.0.0' }, { 'mushi-mushi': '^0.8.15' }) }])
    expect(dep!.name).toBe('mushi-mushi')
    expect(isSdkDependency(dep!)).toBe(false)
    expect(isSdkDependency({ name: 'mushi-mushi', spec: '^1.35.0' })).toBe(true)
  })

  it('an upgrade PR leaves the launcher alone and still bumps the SDK', () => {
    const plan = computeBumpPlan(
      { dependencies: { '@mushi-mushi/web': '^1.34.1' }, devDependencies: { 'mushi-mushi': '^0.8.15' } },
      { 'mushi-mushi': '1.35.0', '@mushi-mushi/web': '1.35.0' },
    )
    expect(plan.bumps.map((b) => b.package)).toEqual(['@mushi-mushi/web'])
  })
})
