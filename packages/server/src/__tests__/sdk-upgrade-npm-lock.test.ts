/**
 * FILE: sdk-upgrade-npm-lock.test.ts
 * PURPOSE: An upgrade without the host lockfile workflow rewrites
 *          package-lock.json v3 @mushi-mushi entries, including a transitive
 *          @mushi-mushi/core nested under @mushi-mushi/web.
 */

import { describe, expect, it } from 'vitest'
import { patchNpmLockfile } from '../../supabase/functions/_shared/sdk-upgrade-npm-patch.ts'
import { bumpedRanges } from '../../supabase/functions/_shared/sdk-upgrade-lock-edit.ts'
import { semverSatisfies } from '../../supabase/functions/_shared/sdk-upgrade-semver.ts'
import type { NpmPackument } from '../../supabase/functions/_shared/sdk-upgrade-npm-lock.ts'

const WEB = '1.33.1'
const CORE = '1.33.2'

function pack(name: string, version: string, deps: Record<string, string> = {}): NpmPackument['versions'][string] {
  const short = name.split('/')[1]
  return {
    version,
    dependencies: deps,
    dist: {
      tarball: `https://registry.npmjs.org/${name}/-/${short}-${version}.tgz`,
      integrity: `sha512-${short}-${version}`,
    },
  }
}

const packs: Record<string, NpmPackument> = {
  '@mushi-mushi/web': {
    latest: WEB,
    versions: { [WEB]: { ...pack('@mushi-mushi/web', WEB, { '@mushi-mushi/core': '^1.33.1' }), peerDependencies: { rrweb: '^2.0.1' } } },
  },
  '@mushi-mushi/core': {
    latest: CORE,
    versions: {
      '1.33.1': pack('@mushi-mushi/core', '1.33.1', { '@noble/hashes': '^2.2.0' }),
      [CORE]: pack('@mushi-mushi/core', CORE, { '@noble/hashes': '^2.2.0' }),
      '1.34.0-rc.1': pack('@mushi-mushi/core', '1.34.0-rc.1', { '@noble/hashes': '^2.2.0' }),
    },
  },
}

function lock(coreVersion = '1.31.0'): Record<string, unknown> {
  return {
    name: 'app',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'app', dependencies: { '@mushi-mushi/web': '^1.31.0' }, devDependencies: { '@mushi-mushi/cli': '^0.31.0' } },
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
        integrity: coreVersion === '1.33.1' ? 'sha512-core-1.33.1' : 'sha512-oldcore',
        dependencies: { '@noble/hashes': '^2.2.0' },
        license: 'MIT',
      },
      'node_modules/@mushi-mushi/web/node_modules/@mushi-mushi/core': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.31.0.tgz',
        integrity: 'sha512-oldcore',
        dependencies: { '@noble/hashes': '^2.2.0' },
      },
      'node_modules/@mushi-mushi/cli': { version: '0.31.0', integrity: 'sha512-cli', dev: true },
      'node_modules/@noble/hashes': { version: '2.2.0', integrity: 'sha512-noble' },
    },
  }
}

const manifest = JSON.stringify({
  dependencies: { '@mushi-mushi/web': '^1.33.1' },
  devDependencies: { '@mushi-mushi/cli': '^0.31.0' },
})

function patch(text: string, corePack = packs) {
  return patchNpmLockfile(text, {
    direct: { '@mushi-mushi/web': WEB },
    packuments: corePack,
    manifests: [{ lockKey: '', ranges: bumpedRanges(manifest, new Set(['@mushi-mushi/web'])) }],
  })
}

describe('semverSatisfies', () => {
  it('keeps caret rules and rejects a prerelease the range did not name', () => {
    expect(semverSatisfies('1.33.2', '^1.31.0')).toBe(true)
    expect(semverSatisfies('1.31.0', '^1.33.1')).toBe(false)
    expect(semverSatisfies('0.31.5', '^0.31.0')).toBe(true)
    expect(semverSatisfies('0.32.0', '^0.31.0')).toBe(false)
    expect(semverSatisfies('1.33.2', '>=1.33.1 <2.0.0')).toBe(true)
    expect(semverSatisfies('1.33.2-rc.1', '^1.33.0')).toBe(false)
    expect(semverSatisfies('1.33.2-rc.1', '1.33.2')).toBe(false)
    expect(semverSatisfies('1.33.2-rc.1', '1.33.2-rc.1')).toBe(true)
    expect(semverSatisfies('1.33.2', '1.33.2-rc.1')).toBe(false)
  })
})

describe('patchNpmLockfile v3', () => {
  const raw = JSON.stringify(lock(), null, 2) + '\n'

  it('updates web, the hoisted core, and core nested under web', () => {
    const result = patch(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pkgs = JSON.parse(result.text).packages
    expect(pkgs[''].dependencies).toEqual({ '@mushi-mushi/web': '^1.33.1' })
    expect(pkgs[''].devDependencies).toEqual({ '@mushi-mushi/cli': '^0.31.0' })
    expect(pkgs['node_modules/@mushi-mushi/web']).toMatchObject({
      version: WEB,
      resolved: 'https://registry.npmjs.org/@mushi-mushi/web/-/web-1.33.1.tgz',
      integrity: 'sha512-web-1.33.1',
      dependencies: { '@mushi-mushi/core': '^1.33.1' },
      engines: { node: '>=20' },
    })
    for (const key of ['node_modules/@mushi-mushi/core', 'node_modules/@mushi-mushi/web/node_modules/@mushi-mushi/core']) {
      expect(pkgs[key]).toMatchObject({
        version: CORE,
        resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.33.2.tgz',
        integrity: 'sha512-core-1.33.2',
        dependencies: { '@noble/hashes': '^2.2.0' },
      })
    }
    expect(pkgs['node_modules/@mushi-mushi/core'].license).toBe('MIT')
    expect(pkgs['node_modules/@mushi-mushi/cli']).toEqual(JSON.parse(raw).packages['node_modules/@mushi-mushi/cli'])
    expect(pkgs['node_modules/@noble/hashes'].integrity).toBe('sha512-noble')
  })

  it('keeps a transitive core that already satisfies the new range', () => {
    const result = patch(JSON.stringify(lock('1.33.1'), null, 2) + '\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const pkgs = JSON.parse(result.text).packages
    expect(pkgs['node_modules/@mushi-mushi/core'].version).toBe('1.33.1')
    expect(pkgs['node_modules/@mushi-mushi/core'].integrity).toBe('sha512-core-1.33.1')
    expect(pkgs['node_modules/@mushi-mushi/web/node_modules/@mushi-mushi/core'].version).toBe('1.33.1')
  })

  it('does not move a hoisted copy onto a version its other requirer rejects', () => {
    const body = lock()
    const packages = body.packages as Record<string, Record<string, unknown>>
    packages['node_modules/old-plugin'] = {
      version: '1.0.0',
      dependencies: { '@mushi-mushi/core': '^0.24.0' },
    }
    const result = patch(JSON.stringify(body, null, 2) + '\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('^0.24.0')
    expect(result.reason).toContain('@mushi-mushi/core@1.33.2')
  })

  it('ignores a prerelease even when it is the registry latest', () => {
    const withRc: Record<string, NpmPackument> = {
      ...packs,
      '@mushi-mushi/core': { ...packs['@mushi-mushi/core']!, latest: '1.34.0-rc.1' },
    }
    const result = patch(JSON.stringify(lock(), null, 2) + '\n', withRc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.parse(result.text).packages['node_modules/@mushi-mushi/core'].version).toBe(CORE)
  })
})
