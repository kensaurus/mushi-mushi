/**
 * FILE: sdk-upgrade-npm-lock.test.ts
 * PURPOSE: ADR 0043 — an upgrade without the host lockfile workflow rewrites
 *          package-lock.json v3 @mushi-mushi entries (including a transitive
 *          @mushi-mushi/core nested under @mushi-mushi/web) and leaves every
 *          other entry alone. pnpm and yarn are named, not edited.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bumpedRanges,
  governedLocks,
  lockKeyFor,
  patchNpmLockfile,
  semverSatisfies,
  type NpmPackument,
} from '../../supabase/functions/_shared/sdk-upgrade-npm-lock.ts'

const WEB = '1.33.1'
const CORE = '1.33.2'

const packs: Record<string, NpmPackument> = {
  '@mushi-mushi/web': {
    latest: WEB,
    versions: {
      [WEB]: {
        version: WEB,
        dependencies: { '@mushi-mushi/core': '^1.33.1' },
        peerDependencies: { rrweb: '^2.0.1' },
        dist: {
          tarball: 'https://registry.npmjs.org/@mushi-mushi/web/-/web-1.33.1.tgz',
          integrity: 'sha512-web',
        },
      },
    },
  },
  '@mushi-mushi/core': {
    latest: CORE,
    versions: {
      '1.33.1': {
        version: '1.33.1',
        dependencies: { '@noble/hashes': '^2.2.0' },
        dist: {
          tarball: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.33.1.tgz',
          integrity: 'sha512-core131',
        },
      },
      [CORE]: {
        version: CORE,
        dependencies: { '@noble/hashes': '^2.2.0' },
        dist: {
          tarball: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.33.2.tgz',
          integrity: 'sha512-core',
        },
      },
    },
  },
}

function lock(coreVersion = '1.31.0'): Record<string, unknown> {
  return {
    name: 'app',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'app',
        version: '1.0.0',
        dependencies: { '@mushi-mushi/web': '^1.31.0' },
        devDependencies: { typescript: '^5.4.0', '@mushi-mushi/cli': '^0.31.0' },
      },
      'node_modules/@mushi-mushi/web': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/web/-/web-1.31.0.tgz',
        integrity: 'sha512-oldweb',
        dependencies: { '@mushi-mushi/core': '^1.31.0' },
        peerDependencies: { rrweb: '^2.0.1' },
        engines: { node: '>=20' },
      },
      'node_modules/@mushi-mushi/core': {
        version: coreVersion,
        resolved: `https://registry.npmjs.org/@mushi-mushi/core/-/core-${coreVersion}.tgz`,
        integrity: coreVersion === '1.33.1' ? 'sha512-core131' : 'sha512-oldcore',
        dependencies: { '@noble/hashes': '^2.2.0' },
        license: 'MIT',
      },
      'node_modules/@mushi-mushi/web/node_modules/@mushi-mushi/core': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.31.0.tgz',
        integrity: 'sha512-oldcore',
        dependencies: { '@noble/hashes': '^2.2.0' },
      },
      'node_modules/@mushi-mushi/cli': {
        version: '0.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/cli/-/cli-0.31.0.tgz',
        integrity: 'sha512-cli',
        dev: true,
      },
      'node_modules/@noble/hashes': {
        version: '2.2.0',
        resolved: 'https://registry.npmjs.org/@noble/hashes/-/hashes-2.2.0.tgz',
        integrity: 'sha512-noble',
      },
      'node_modules/typescript': {
        version: '5.4.5',
        resolved: 'https://registry.npmjs.org/typescript/-/typescript-5.4.5.tgz',
        integrity: 'sha512-ts',
        dev: true,
      },
    },
  }
}

const manifest = JSON.stringify({
  dependencies: { '@mushi-mushi/web': '^1.33.1' },
  devDependencies: { typescript: '^5.4.0', '@mushi-mushi/cli': '^0.31.0' },
})

function patch(text: string, corePack = packs) {
  return patchNpmLockfile(text, {
    direct: { '@mushi-mushi/web': WEB },
    packuments: corePack,
    manifests: [{ lockKey: '', ranges: bumpedRanges(manifest, new Set(['@mushi-mushi/web'])) }],
  })
}

describe('ADR citation', () => {
  it('amends 0019 as ADR 0043, and this file says 0043', () => {
    const index = readFileSync(resolve(__dirname, '../../../../docs/adr/INDEX.md'), 'utf8')
    const row = index.split('\n').find((line) => line.includes('0019-sdk-upgrade-lockfile-helper.md'))
    expect(row).toContain('[0043](0043-npm-lock-entries-on-sdk-upgrade.md)')
    expect(row).not.toContain('0042')
    expect(existsSync(resolve(__dirname, '../../../../docs/adr/0043-npm-lock-entries-on-sdk-upgrade.md'))).toBe(true)
    const header = readFileSync(resolve(__dirname, 'sdk-upgrade-npm-lock.test.ts'), 'utf8').split('\n').slice(0, 8).join('\n')
    expect(header).toContain('ADR 0043')
    expect(header).not.toContain('ADR 0042')
  })
})

describe('semverSatisfies', () => {
  it('applies caret, including 0.x', () => {
    expect(semverSatisfies('1.33.2', '^1.31.0')).toBe(true)
    expect(semverSatisfies('1.31.0', '^1.33.1')).toBe(false)
    expect(semverSatisfies('0.31.5', '^0.31.0')).toBe(true)
    expect(semverSatisfies('0.32.0', '^0.31.0')).toBe(false)
    expect(semverSatisfies('1.33.2', '>=1.33.1 <2.0.0')).toBe(true)
  })
})

describe('patchNpmLockfile', () => {
  const raw = JSON.stringify(lock(), null, 2) + '\n'

  it('updates web, the hoisted core, and core nested under web', () => {
    const result = patch(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const out = JSON.parse(result.text) as { packages: Record<string, { version: string; resolved: string; integrity: string; dependencies?: Record<string, string>; engines?: unknown; license?: string; dev?: boolean }> }
    const pkgs = out.packages
    expect(pkgs[''].dependencies).toEqual({ '@mushi-mushi/web': '^1.33.1' })
    expect(pkgs[''].devDependencies).toEqual({ typescript: '^5.4.0', '@mushi-mushi/cli': '^0.31.0' })

    expect(pkgs['node_modules/@mushi-mushi/web']).toMatchObject({
      version: WEB,
      resolved: 'https://registry.npmjs.org/@mushi-mushi/web/-/web-1.33.1.tgz',
      integrity: 'sha512-web',
      dependencies: { '@mushi-mushi/core': '^1.33.1' },
      engines: { node: '>=20' },
    })
    for (const key of ['node_modules/@mushi-mushi/core', 'node_modules/@mushi-mushi/web/node_modules/@mushi-mushi/core']) {
      expect(pkgs[key]).toMatchObject({
        version: CORE,
        resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.33.2.tgz',
        integrity: 'sha512-core',
        dependencies: { '@noble/hashes': '^2.2.0' },
      })
    }
    expect(pkgs['node_modules/@mushi-mushi/core'].license).toBe('MIT')
    expect(pkgs['node_modules/@mushi-mushi/cli']).toEqual(JSON.parse(raw).packages['node_modules/@mushi-mushi/cli'])
    expect(pkgs['node_modules/@noble/hashes']).toEqual(JSON.parse(raw).packages['node_modules/@noble/hashes'])
    expect(pkgs['node_modules/typescript']).toEqual(JSON.parse(raw).packages['node_modules/typescript'])
    expect(result.text).toContain('"integrity": "sha512-noble"')
  })

  it('keeps a transitive core that already satisfies the new range', () => {
    const text = JSON.stringify(lock('1.33.1'), null, 2) + '\n'
    const result = patch(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const core = JSON.parse(result.text).packages['node_modules/@mushi-mushi/core']
    expect(core.version).toBe('1.33.1')
    expect(core.integrity).toBe('sha512-core131')
    // The nested copy was still 1.31.0, so it moves to the satisfying locked version.
    expect(JSON.parse(result.text).packages['node_modules/@mushi-mushi/web/node_modules/@mushi-mushi/core'].version).toBe('1.33.1')
  })

  it('is stable when run again, and updates a v2 legacy dependencies tree', () => {
    const once = patch(raw)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = patch(once.text)
    expect(twice).toEqual(once)

    const v2 = JSON.parse(raw) as { lockfileVersion: number; dependencies: Record<string, unknown> }
    v2.lockfileVersion = 2
    v2.dependencies = {
      '@mushi-mushi/web': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/web/-/web-1.31.0.tgz',
        integrity: 'sha512-oldweb',
        requires: { '@mushi-mushi/core': '^1.31.0' },
        dependencies: {
          '@mushi-mushi/core': {
            version: '1.31.0',
            resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.31.0.tgz',
            integrity: 'sha512-oldcore',
          },
        },
      },
      '@mushi-mushi/core': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.31.0.tgz',
        integrity: 'sha512-oldcore',
      },
    }
    const legacy = patch(JSON.stringify(v2, null, 2) + '\n')
    expect(legacy.ok).toBe(true)
    if (!legacy.ok) return
    const deps = JSON.parse(legacy.text).dependencies
    expect(deps['@mushi-mushi/web']).toMatchObject({ version: WEB, integrity: 'sha512-web', requires: { '@mushi-mushi/core': '^1.33.1' } })
    expect(deps['@mushi-mushi/web'].dependencies['@mushi-mushi/core'].version).toBe(CORE)
    expect(deps['@mushi-mushi/core'].version).toBe(CORE)
  })

  it('updates a nested copy when that parent range accepts the chosen version', () => {
    const body = lock()
    const packages = body.packages as Record<string, Record<string, unknown>>
    packages['node_modules/widget'] = {
      version: '2.0.0',
      resolved: 'https://registry.npmjs.org/widget/-/widget-2.0.0.tgz',
      integrity: 'sha512-widget',
      dependencies: { '@mushi-mushi/core': '^1.0.0' },
    }
    packages['node_modules/widget/node_modules/@mushi-mushi/core'] = {
      version: '1.2.0',
      resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.2.0.tgz',
      integrity: 'sha512-core120',
      dependencies: { '@noble/hashes': '^2.2.0' },
    }
    const result = patch(JSON.stringify(body, null, 2) + '\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const out = JSON.parse(result.text).packages
    expect(out['node_modules/widget/node_modules/@mushi-mushi/core'].version).toBe(CORE)
    expect(out['node_modules/widget'].dependencies).toEqual({ '@mushi-mushi/core': '^1.0.0' })
  })

  it('refuses a nested copy whose parent range rejects the chosen version', () => {
    const body = lock()
    const packages = body.packages as Record<string, Record<string, unknown>>
    packages['node_modules/old-plugin'] = {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/old-plugin/-/old-plugin-1.0.0.tgz',
      integrity: 'sha512-oldplugin',
      dependencies: { '@mushi-mushi/core': '^0.24.0' },
    }
    packages['node_modules/old-plugin/node_modules/@mushi-mushi/core'] = {
      version: '0.24.1',
      resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-0.24.1.tgz',
      integrity: 'sha512-core024',
      dependencies: { '@noble/hashes': '^1.0.0' },
    }
    const result = patch(JSON.stringify(body, null, 2) + '\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('^0.24.0')
    expect(result.reason).toContain('node_modules/old-plugin')
    expect(result.reason).toContain(`@mushi-mushi/core@${CORE}`)
  })

  it('refuses a nested copy whose parent declares no range', () => {
    const body = lock()
    const packages = body.packages as Record<string, Record<string, unknown>>
    packages['node_modules/widget'] = {
      version: '2.0.0',
      resolved: 'https://registry.npmjs.org/widget/-/widget-2.0.0.tgz',
      integrity: 'sha512-widget',
    }
    packages['node_modules/widget/node_modules/@mushi-mushi/core'] = {
      version: '1.2.0',
      resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.2.0.tgz',
      integrity: 'sha512-core120',
    }
    const result = patch(JSON.stringify(body, null, 2) + '\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('no declared range')
    expect(result.reason).toContain('node_modules/widget')
  })

  it('refuses a v2 legacy nested copy whose parent range rejects the chosen version', () => {
    const v2 = JSON.parse(raw) as { lockfileVersion: number; dependencies: Record<string, unknown> }
    v2.lockfileVersion = 2
    v2.dependencies = {
      '@mushi-mushi/web': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/web/-/web-1.31.0.tgz',
        integrity: 'sha512-oldweb',
        requires: { '@mushi-mushi/core': '^1.31.0' },
      },
      '@mushi-mushi/core': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.31.0.tgz',
        integrity: 'sha512-oldcore',
      },
      'old-plugin': {
        version: '1.0.0',
        requires: { '@mushi-mushi/core': '^0.24.0' },
        dependencies: {
          '@mushi-mushi/core': {
            version: '0.24.1',
            resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-0.24.1.tgz',
            integrity: 'sha512-core024',
          },
        },
      },
    }
    const result = patch(JSON.stringify(v2, null, 2) + '\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('^0.24.0')
    expect(result.reason).toContain('old-plugin')
  })

  it('refuses a lockfile it cannot make pass npm ci', () => {
    expect(patch('{').ok).toBe(false)
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: {} })
    expect(patch(v1).ok).toBe(false)
    const moved = JSON.parse(raw) as { packages: Record<string, { dependencies: Record<string, string> }> }
    moved.packages['node_modules/@noble/hashes'].version = '1.0.0'
    const strict = {
      ...packs,
      '@mushi-mushi/core': {
        ...packs['@mushi-mushi/core']!,
        versions: {
          ...packs['@mushi-mushi/core']!.versions,
          [CORE]: {
            ...packs['@mushi-mushi/core']!.versions[CORE]!,
            dependencies: { '@noble/hashes': '^9.0.0' },
          },
        },
      },
    }
    const refused = patch(JSON.stringify(moved, null, 2) + '\n', strict)
    expect(refused.ok).toBe(false)
  })
})

describe('governedLocks', () => {
  it('uses the nearest lockfile and prefers pnpm when both are present', () => {
    const files = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'apps/web/package.json', 'apps/web/package-lock.json'])
    expect(governedLocks(['package.json'], files, new Map())).toEqual([
      { kind: 'pnpm', path: 'pnpm-lock.yaml', manifests: ['package.json'] },
    ])
    expect(governedLocks(['apps/web/package.json'], files, new Map())).toEqual([
      { kind: 'npm', path: 'apps/web/package-lock.json', manifests: ['apps/web/package.json'] },
    ])
    expect(governedLocks(['package.json'], new Set(['package.json', 'package-lock.json']), new Map())).toEqual([
      { kind: 'npm', path: 'package-lock.json', manifests: ['package.json'] },
    ])
    expect(lockKeyFor('apps/web/package.json', 'package-lock.json')).toBe('apps/web')
    expect(lockKeyFor('package.json', 'package-lock.json')).toBe('')
  })
})
