/**
 * FILE: sdk-upgrade-npm-lock-collect.test.ts
 * PURPOSE: collectLockfileChanges updates an npm lock from packuments and
 *          names the install command for pnpm, yarn, and locks it cannot edit.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/github-pr.ts', () => ({
  ghFetchOptional: async () => null,
  openPullRequestForBranch: async () => ({ url: '', number: 0 }),
}))
import { collectLockfileChanges } from '../../supabase/functions/_shared/sdk-upgrade-lock-collect.ts'
import { governedLocks, lockKeyFor } from '../../supabase/functions/_shared/sdk-upgrade-lock-edit.ts'
import { lockfileNeedsSentence, planWithLockfileNote } from '../../supabase/functions/_shared/sdk-upgrade-pr.ts'
import { patchNpmLockfile } from '../../supabase/functions/_shared/sdk-upgrade-npm-patch.ts'
import type { NpmPackument } from '../../supabase/functions/_shared/sdk-upgrade-npm-lock.ts'

const WEB = '1.33.1'
const manifest = JSON.stringify({ dependencies: { '@mushi-mushi/web': '^1.33.1' } })

function npmLock(): string {
  return JSON.stringify({
    name: 'app',
    lockfileVersion: 2,
    packages: {
      '': { dependencies: { '@mushi-mushi/web': '^1.31.0' } },
      'node_modules/@mushi-mushi/web': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/web/-/web-1.31.0.tgz',
        integrity: 'sha512-old',
        dependencies: { '@mushi-mushi/core': '^1.31.0' },
      },
      'node_modules/@mushi-mushi/core': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.31.0.tgz',
        integrity: 'sha512-oldcore',
      },
    },
    dependencies: {
      '@mushi-mushi/web': {
        version: '1.31.0',
        resolved: 'https://registry.npmjs.org/@mushi-mushi/web/-/web-1.31.0.tgz',
        integrity: 'sha512-old',
        requires: { '@mushi-mushi/core': '^1.31.0' },
        dependencies: {
          '@mushi-mushi/core': {
            version: '1.31.0',
            resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.31.0.tgz',
            integrity: 'sha512-oldcore',
          },
        },
      },
      'old-plugin': {
        version: '1.0.0',
        requires: { '@mushi-mushi/core': '^0.24.0' },
        dependencies: {
          '@mushi-mushi/core': {
            version: '0.24.1',
            resolved: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-0.24.1.tgz',
            integrity: 'sha512-old024',
          },
        },
      },
    },
  }, null, 2) + '\n'
}

function fetchImpl(coreDeps: Record<string, string> = {}): typeof fetch {
  const packs: Record<string, NpmPackument> = {
    '@mushi-mushi/web': {
      latest: WEB,
      versions: {
        [WEB]: {
          version: WEB,
          dependencies: { '@mushi-mushi/core': '^1.33.1' },
          dist: { tarball: `https://registry.npmjs.org/@mushi-mushi/web/-/web-${WEB}.tgz`, integrity: 'sha512-web' },
        },
      },
    },
    '@mushi-mushi/core': {
      latest: '1.33.2',
      versions: {
        '1.33.2': {
          version: '1.33.2',
          dependencies: coreDeps,
          dist: { tarball: 'https://registry.npmjs.org/@mushi-mushi/core/-/core-1.33.2.tgz', integrity: 'sha512-core' },
        },
      },
    },
  }
  return (async (url: string | URL | Request) => {
    const name = decodeURIComponent(String(url).split('/').pop() ?? '')
    const pack = packs[name]
    return { ok: Boolean(pack), json: async () => (pack ? { 'dist-tags': { latest: pack.latest }, versions: pack.versions } : {}) }
  }) as typeof fetch
}

describe('collectLockfileChanges', () => {
  it('rewrites an npm lock, including the legacy tree, from the packument', async () => {
    const text = npmLock()
    const edited = await collectLockfileChanges({
      blobs: [{ path: 'package.json' }, { path: 'package-lock.json', sha: 'lock' }],
      treeComplete: true,
      manifests: [{ path: 'package.json', contents: manifest }],
      bumps: [{ package: '@mushi-mushi/web', to: WEB }],
      readBlob: async () => text,
      readContents: async () => null,
      fetchImpl: fetchImpl(),
    })
    expect(edited.outcome).toBe('manual')
    expect(edited.commands).toEqual(['npm install --package-lock-only'])
    expect(edited.reasons[0]).toContain('^0.24.0')
  })

  it('updates v2 entries when every nested range accepts the version', async () => {
    const body = JSON.parse(npmLock()) as { dependencies: Record<string, unknown> }
    delete body.dependencies['old-plugin']
    const text = JSON.stringify(body, null, 2) + '\n'
    const edited = await collectLockfileChanges({
      blobs: [{ path: 'package.json' }, { path: 'package-lock.json' }],
      treeComplete: true,
      manifests: [{ path: 'package.json', contents: manifest }],
      bumps: [{ package: '@mushi-mushi/web', to: WEB }],
      readBlob: async () => null,
      readContents: async (path) => (path === 'package-lock.json' ? text : null),
      fetchImpl: fetchImpl(),
    })
    expect(edited.outcome).toBe('npm_updated')
    expect(edited.commands).toEqual([])
    const out = JSON.parse(edited.files[0]!.contents)
    expect(out.packages['node_modules/@mushi-mushi/web'].version).toBe(WEB)
    expect(out.packages['node_modules/@mushi-mushi/core'].version).toBe('1.33.2')
    expect(out.dependencies['@mushi-mushi/web'].requires).toEqual({ '@mushi-mushi/core': '^1.33.1' })
    expect(out.dependencies['@mushi-mushi/web'].dependencies['@mushi-mushi/core'].version).toBe('1.33.2')
  })

  it('names pnpm and does not read the lockfile', async () => {
    const edited = await collectLockfileChanges({
      blobs: [{ path: 'package.json' }, { path: 'pnpm-lock.yaml' }, { path: 'yarn.lock' }],
      treeComplete: true,
      manifests: [{ path: 'package.json', contents: manifest + '\n' }],
      bumps: [{ package: '@mushi-mushi/web', to: WEB }],
      readBlob: async () => { throw new Error('should not read') },
      readContents: async () => { throw new Error('should not read') },
      fetchImpl: fetchImpl(),
    })
    expect(edited.outcome).toBe('manual')
    expect(edited.files).toEqual([])
    expect(lockfileNeedsSentence(edited.commands)).toBe('This PR needs `pnpm install --lockfile-only`.')
    expect(planWithLockfileNote([{ package: '@mushi-mushi/web', to: WEB }], lockfileNeedsSentence(edited.commands))[0])
      .toMatchObject({ lockfileNote: 'This PR needs `pnpm install --lockfile-only`.' })
  })

  it('prefers pnpm at the root and an app\'s own package-lock', () => {
    const files = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'apps/web/package.json', 'apps/web/package-lock.json'])
    expect(governedLocks(['package.json'], files, new Map())).toEqual([
      { kind: 'pnpm', path: 'pnpm-lock.yaml', manifests: ['package.json'] },
    ])
    expect(governedLocks(['apps/web/package.json'], files, new Map())).toEqual([
      { kind: 'npm', path: 'apps/web/package-lock.json', manifests: ['apps/web/package.json'] },
    ])
    expect(lockKeyFor('apps/web/package.json', 'package-lock.json')).toBe('apps/web')
  })

  it('refuses a lockfileVersion it cannot edit', () => {
    const result = patchNpmLockfile('{"lockfileVersion":1,"packages":{}}', {
      direct: { '@mushi-mushi/web': WEB },
      packuments: {},
      manifests: [],
    })
    expect(result.ok).toBe(false)
  })
})
