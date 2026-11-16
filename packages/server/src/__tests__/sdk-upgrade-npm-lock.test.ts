/**
 * FILE: sdk-upgrade-npm-lock.test.ts
 * PURPOSE: npm lock entries in an SDK upgrade match the registry document and
 *          satisfy `npm ci` when every new range already resolves.
 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyNpmLockUpdates,
  interpretGithubContent,
  planNpmLockfileUpdates,
  satisfiesRange,
  toPackument,
  type NpmPackument,
} from '../../supabase/functions/_shared/sdk-upgrade-npm-lock.ts'

const INTEGRITY = `sha512-${'a'.repeat(86)}==`

function pack(name: string, version: string, extra: Record<string, unknown> = {}): NpmPackument {
  const unscoped = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const doc = toPackument({
    name,
    version,
    dist: {
      integrity: INTEGRITY,
      tarball: `https://registry.npmjs.org/${name}/-/${unscoped}-${version}.tgz`,
    },
    ...extra,
  }, name, version)
  if (!doc) throw new Error(`invalid packument ${name}@${version}`)
  return doc
}

function tarball(name: string, version: string): string {
  const unscoped = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  return `https://registry.npmjs.org/${name}/-/${unscoped}-${version}.tgz`
}

describe('satisfiesRange', () => {
  it('applies caret, tilde, hyphen and prerelease rules', () => {
    expect(satisfiesRange('1.35.0', '^1.35.0')).toBe(true)
    expect(satisfiesRange('1.31.0', '^1.35.0')).toBe(false)
    expect(satisfiesRange('2.0.0', '^1.35.0')).toBe(false)
    expect(satisfiesRange('0.2.3', '^0.2.3')).toBe(true)
    expect(satisfiesRange('0.2.4', '^0.2.3')).toBe(true)
    expect(satisfiesRange('0.3.0', '^0.2.3')).toBe(false)
    expect(satisfiesRange('0.0.3', '^0.0.3')).toBe(true)
    expect(satisfiesRange('0.0.4', '^0.0.3')).toBe(false)
    expect(satisfiesRange('1.2.4', '~1.2.3')).toBe(true)
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false)
    expect(satisfiesRange('1.5.0', '1.2.3 - 2.0.0')).toBe(true)
    expect(satisfiesRange('2.0.0', '1.2.3 - 2.0.0')).toBe(true)
    expect(satisfiesRange('2.0.1', '1.2.3 - 2.0.0')).toBe(false)
    expect(satisfiesRange('1.2.3-beta.1', '^1.2.3')).toBe(false)
    expect(satisfiesRange('1.2.3-beta.2', '>=1.2.3-beta.1')).toBe(true)
    expect(satisfiesRange('1.2.4-beta.0', '^1.2.3-beta.0')).toBe(false)
    expect(satisfiesRange('1.2.3', '^1.2.3-beta.0')).toBe(true)
  })
})

describe('applyNpmLockUpdates', () => {
  const web = '@mushi-mushi/web'
  const core = '@mushi-mushi/core'

  function v3Lock(): Record<string, unknown> {
    return {
      name: 'host',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'host',
          dependencies: { [web]: '^1.31.0' },
        },
        [`node_modules/${web}`]: {
          version: '1.31.0',
          resolved: tarball(web, '1.31.0'),
          integrity: 'sha512-old',
          dev: true,
          dependencies: { [core]: '^1.31.0' },
          bin: { mushi: 'old.js' },
          engines: { node: '>=18' },
          hasInstallScript: true,
          license: 'MIT',
        },
        [`node_modules/${web}/node_modules/${core}`]: {
          version: '1.31.0',
          resolved: tarball(core, '1.31.0'),
          integrity: 'sha512-oldcore',
          dependencies: { '@noble/hashes': '^1.0.0' },
          engines: { node: '>=18' },
        },
        'node_modules/@noble/hashes': {
          version: '1.4.0',
          resolved: 'https://registry.npmjs.org/@noble/hashes/-/hashes-1.4.0.tgz',
          integrity: 'sha512-hashes',
        },
      },
    }
  }

  const packs = new Map<string, NpmPackument>([
    [`${web}@1.35.0`, pack(web, '1.35.0', {
      dependencies: { [core]: '^1.35.0' },
      peerDependencies: { rrweb: '^2.0.1' },
      peerDependenciesMeta: { rrweb: { optional: true } },
      bin: { mushi: 'new.js' },
      engines: { node: '>=20' },
      license: 'Apache-2.0',
    })],
    [`${core}@1.35.0`, pack(core, '1.35.0', {
      dependencies: { '@noble/hashes': '^1.0.0' },
      bin: { 'mushi-core': 'cli.js' },
      engines: { node: '>=20' },
    })],
  ])

  const edit = {
    path: 'package.json',
    sections: { dependencies: { [web]: '^1.35.0' } },
    versions: { [web]: '1.35.0' },
  }

  it('updates a nested core entry and replaces install metadata', () => {
    const result = applyNpmLockUpdates(
      JSON.stringify(v3Lock()),
      [edit],
      packs,
      { [core]: '1.35.0', [web]: '1.35.0' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lock = JSON.parse(result.text) as { packages: Record<string, Record<string, unknown>> }
    expect(lock.packages[''].dependencies).toEqual({ [web]: '^1.35.0' })
    const webEntry = lock.packages[`node_modules/${web}`]
    expect(webEntry.version).toBe('1.35.0')
    expect(webEntry.resolved).toBe(tarball(web, '1.35.0'))
    expect(webEntry.integrity).toBe(INTEGRITY)
    expect(webEntry.bin).toEqual({ mushi: 'new.js' })
    expect(webEntry.engines).toEqual({ node: '>=20' })
    expect(webEntry.hasInstallScript).toBeUndefined()
    expect(webEntry.license).toBe('Apache-2.0')
    expect(webEntry.dev).toBe(true)
    expect(webEntry.dependencies).toEqual({ [core]: '^1.35.0' })
    expect(webEntry.peerDependencies).toEqual({ rrweb: '^2.0.1' })
    expect(webEntry.peerDependenciesMeta).toEqual({ rrweb: { optional: true } })
    expect(lock.packages[`node_modules/${web}/node_modules/${core}`]).toMatchObject({
      version: '1.35.0',
      resolved: tarball(core, '1.35.0'),
      integrity: INTEGRITY,
      bin: { 'mushi-core': 'cli.js' },
      engines: { node: '>=20' },
      dependencies: { '@noble/hashes': '^1.0.0' },
    })
    expect(lock.packages['node_modules/@noble/hashes'].version).toBe('1.4.0')
    expect(lock.packages['node_modules/rrweb']).toBeUndefined()
  })

  it('refuses a required peer that is not in the lock', () => {
    const required = new Map(packs)
    required.set(`${web}@1.35.0`, pack(web, '1.35.0', {
      dependencies: { [core]: '^1.35.0' },
      peerDependencies: { rrweb: '^2.0.1' },
    }))
    const result = applyNpmLockUpdates(JSON.stringify(v3Lock()), [edit], required, { [core]: '1.35.0' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('rrweb')
  })

  it('accepts a required peer when a satisfying entry is already installed', () => {
    const lock = v3Lock()
    const packages = lock.packages as Record<string, unknown>
    packages['node_modules/rrweb'] = {
      version: '2.1.0',
      resolved: 'https://registry.npmjs.org/rrweb/-/rrweb-2.1.0.tgz',
      integrity: 'sha512-rrweb',
    }
    const required = new Map(packs)
    required.set(`${web}@1.35.0`, pack(web, '1.35.0', {
      dependencies: { [core]: '^1.35.0' },
      peerDependencies: { rrweb: '^2.0.1' },
    }))
    const result = applyNpmLockUpdates(JSON.stringify(lock), [edit], required, { [core]: '1.35.0' })
    expect(result.ok).toBe(true)
  })

  it('refuses a hoisted entry another parent still pins to the old version', () => {
    const lock = {
      name: 'host',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'host', dependencies: { [core]: '^1.31.0' } },
        [`node_modules/${core}`]: {
          version: '1.31.0',
          resolved: tarball(core, '1.31.0'),
          integrity: 'sha512-old',
        },
        'node_modules/other': {
          version: '1.0.0',
          dependencies: { [core]: '1.31.0' },
        },
      },
    }
    const result = applyNpmLockUpdates(
      JSON.stringify(lock),
      [{
        path: 'package.json',
        sections: { dependencies: { [core]: '^1.35.0' } },
        versions: { [core]: '1.35.0' },
      }],
      new Map([[`${core}@1.35.0`, pack(core, '1.35.0')]]),
      {},
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('1.31.0')
  })

  it('only rewrites the root spec when the locked version already satisfies it', () => {
    const lock = v3Lock()
    const packages = lock.packages as Record<string, Record<string, unknown>>
    packages[`node_modules/${web}`].version = '1.35.0'
    packages[`node_modules/${web}`].dependencies = { [core]: '^1.35.0' }
    packages[`node_modules/${web}/node_modules/${core}`].version = '1.35.0'
    const result = applyNpmLockUpdates(JSON.stringify(lock), [edit], new Map(), {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const next = JSON.parse(result.text) as { packages: Record<string, Record<string, unknown>> }
    expect(next.packages[''].dependencies).toEqual({ [web]: '^1.35.0' })
    expect(next.packages[`node_modules/${web}`].bin).toEqual({ mushi: 'old.js' })
    expect(next.packages[`node_modules/${web}`].hasInstallScript).toBe(true)
  })

  it('refuses a transitive major jump of more than one', () => {
    const far = new Map<string, NpmPackument>([
      [`${web}@1.35.0`, pack(web, '1.35.0', { dependencies: { [core]: '^3.0.0' } })],
      [`${core}@3.0.0`, pack(core, '3.0.0')],
    ])
    const result = applyNpmLockUpdates(JSON.stringify(v3Lock()), [edit], far, { [core]: '3.0.0' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain(core)
  })

  it('updates the workspace entry and the hoisted package it resolves', () => {
    const lock = {
      name: 'host',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'host' },
        'apps/web': { name: 'web', dependencies: { [web]: '^1.31.0' } },
        [`node_modules/${web}`]: {
          version: '1.31.0',
          resolved: tarball(web, '1.31.0'),
          integrity: 'sha512-old',
        },
      },
    }
    const result = applyNpmLockUpdates(
      JSON.stringify(lock),
      [{
        path: 'apps/web/package.json',
        sections: { dependencies: { [web]: '^1.35.0' } },
        versions: { [web]: '1.35.0' },
      }],
      new Map([[`${web}@1.35.0`, pack(web, '1.35.0')]]),
      {},
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const next = JSON.parse(result.text) as { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> }
    expect(next.packages['apps/web'].dependencies).toEqual({ [web]: '^1.35.0' })
    expect(next.packages[`node_modules/${web}`].version).toBe('1.35.0')
  })

  it('does not update lockfileVersion 1', () => {
    const result = applyNpmLockUpdates('{"lockfileVersion":1,"dependencies":{}}', [edit], packs, {})
    expect(result.ok).toBe(false)
  })

  it('rebuilds the v2 legacy tree, including third-party ranges and removed dependencies', () => {
    const lock = {
      name: 'host',
      lockfileVersion: 2,
      requires: true,
      packages: {
        '': { name: 'host', dependencies: { [web]: '^1.31.0' } },
        [`node_modules/${web}`]: {
          version: '1.31.0',
          resolved: tarball(web, '1.31.0'),
          integrity: 'sha512-old',
          dependencies: { [core]: '^1.31.0', 'left-pad': '^1.0.0', 'gone-dep': '^1.0.0' },
        },
        [`node_modules/${web}/node_modules/${core}`]: {
          version: '1.31.0',
          resolved: tarball(core, '1.31.0'),
          integrity: 'sha512-oldcore',
          dependencies: { '@noble/hashes': '^1.0.0' },
        },
        [`node_modules/${web}/node_modules/left-pad`]: { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: 'sha512-pad' },
        [`node_modules/${web}/node_modules/gone-dep`]: { version: '1.0.0', resolved: 'https://registry.npmjs.org/gone-dep/-/gone-dep-1.0.0.tgz', integrity: 'sha512-gone' },
        'node_modules/once': { version: '1.4.1', resolved: 'https://registry.npmjs.org/once/-/once-1.4.1.tgz', integrity: 'sha512-once' },
        'node_modules/@noble/hashes': { version: '1.4.0', resolved: 'https://registry.npmjs.org/@noble/hashes/-/hashes-1.4.0.tgz', integrity: 'sha512-hashes' },
      },
      dependencies: {
        [web]: {
          version: '1.31.0',
          resolved: tarball(web, '1.31.0'),
          integrity: 'sha512-old',
          dependencies: {
            [core]: { version: '1.31.0', requires: { '@noble/hashes': '^1.0.0' } },
            'left-pad': { version: '1.3.0' },
            'gone-dep': { version: '1.0.0' },
          },
        },
        once: { version: '1.4.1' },
        '@noble/hashes': { version: '1.4.0' },
      },
    }
    const v2Packs = new Map(packs)
    v2Packs.set(`${web}@1.35.0`, pack(web, '1.35.0', {
      dependencies: { [core]: '^1.35.0', 'left-pad': '^1.3.0', once: '^1.4.0' },
      peerDependencies: { rrweb: '^2.0.1' },
      peerDependenciesMeta: { rrweb: { optional: true } },
      bin: { mushi: 'new.js' },
    }))
    const result = applyNpmLockUpdates(JSON.stringify(lock), [edit], v2Packs, { [core]: '1.35.0' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const next = JSON.parse(result.text) as {
      packages: Record<string, { dependencies?: Record<string, string> }>
      dependencies: Record<string, {
        version?: string
        requires?: Record<string, string>
        bin?: Record<string, string>
        dependencies?: Record<string, { version?: string; requires?: Record<string, string> }>
      }>
    }
    expect(next.packages[`node_modules/${web}`].dependencies).toEqual({
      [core]: '^1.35.0',
      'left-pad': '^1.3.0',
      once: '^1.4.0',
    })
    const legacyWeb = next.dependencies[web]
    expect(legacyWeb.version).toBe('1.35.0')
    expect(legacyWeb.bin).toEqual({ mushi: 'new.js' })
    expect(legacyWeb.requires).toEqual({
      [core]: '^1.35.0',
      'left-pad': '^1.3.0',
      once: '^1.4.0',
    })
    expect(legacyWeb.dependencies?.['gone-dep']).toBeUndefined()
    expect(legacyWeb.dependencies?.['left-pad']?.version).toBe('1.3.0')
    expect(legacyWeb.dependencies?.[core]).toMatchObject({
      version: '1.35.0',
      requires: { '@noble/hashes': '^1.0.0' },
    })
  })

  it('refuses a v2 nested third-party copy outside the new range', () => {
    const lock = {
      name: 'host',
      lockfileVersion: 2,
      requires: true,
      packages: {
        '': { dependencies: { [web]: '^1.31.0' } },
        [`node_modules/${web}`]: {
          version: '1.31.0',
          resolved: tarball(web, '1.31.0'),
          integrity: 'sha512-old',
          dependencies: { 'left-pad': '^1.0.0' },
        },
        [`node_modules/${web}/node_modules/left-pad`]: { version: '1.0.0' },
      },
      dependencies: {
        [web]: {
          version: '1.31.0',
          requires: { 'left-pad': '^1.0.0' },
          dependencies: { 'left-pad': { version: '1.0.0' } },
        },
      },
    }
    const result = applyNpmLockUpdates(
      JSON.stringify(lock),
      [edit],
      new Map([[`${web}@1.35.0`, pack(web, '1.35.0', { dependencies: { 'left-pad': '^1.3.0' } })]]),
      {},
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('left-pad')
  })
})

describe('planNpmLockfileUpdates', () => {
  it('fetches the bumped package and the transitive package it needs', async () => {
    const web = '@mushi-mushi/web'
    const core = '@mushi-mushi/core'
    const lock = {
      name: 'host',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { dependencies: { [web]: '^1.31.0' } },
        [`node_modules/${web}`]: {
          version: '1.31.0',
          resolved: tarball(web, '1.31.0'),
          integrity: 'sha512-old',
          dependencies: { [core]: '^1.31.0' },
        },
        [`node_modules/${core}`]: {
          version: '1.31.0',
          resolved: tarball(core, '1.31.0'),
          integrity: 'sha512-old',
          dependencies: { '@noble/hashes': '^1.0.0' },
        },
        'node_modules/@noble/hashes': { version: '1.4.0' },
      },
    }
    const docs = new Map<string, NpmPackument>([
      [`${web}@1.35.0`, pack(web, '1.35.0', { dependencies: { [core]: '^1.35.0' } })],
      [`${core}@1.35.0`, pack(core, '1.35.0', { dependencies: { '@noble/hashes': '^1.0.0' } })],
    ])
    const fetched: string[] = []
    const plan = await planNpmLockfileUpdates({
      manifests: [{
        path: 'package.json',
        contents: JSON.stringify({ dependencies: { [web]: '^1.35.0' } }),
      }],
      bumps: [{ path: 'package.json', package: web, to: '1.35.0' }],
      availableVersions: { [core]: '1.35.0' },
      readText: async (path) => (path === 'package-lock.json' ? JSON.stringify(lock) : null),
      fetchPackument: async (name, version) => {
        fetched.push(`${name}@${version}`)
        return docs.get(`${name}@${version}`) ?? null
      },
    })
    expect(plan.complete).toBe(true)
    expect(fetched).toEqual([`${web}@1.35.0`, `${core}@1.35.0`])
    const written = JSON.parse(plan.files[0].contents) as { packages: Record<string, { version: string }> }
    expect(written.packages[`node_modules/${web}`].version).toBe('1.35.0')
    expect(written.packages[`node_modules/${core}`].version).toBe('1.35.0')
  })

  it('returns no file when the registry document is missing', async () => {
    const plan = await planNpmLockfileUpdates({
      manifests: [{
        path: 'package.json',
        contents: JSON.stringify({ dependencies: { '@mushi-mushi/web': '^1.35.0' } }),
      }],
      bumps: [{ path: 'package.json', package: '@mushi-mushi/web', to: '1.35.0' }],
      availableVersions: {},
      readText: async () => JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { '@mushi-mushi/web': '^1.31.0' } },
          'node_modules/@mushi-mushi/web': { version: '1.31.0' },
        },
      }),
      fetchPackument: async () => null,
    })
    expect(plan.complete).toBe(false)
    expect(plan.files).toEqual([])
    expect(plan.reasons[0]).toContain('registry')
  })
})

describe('interpretGithubContent', () => {
  it('decodes a contents payload and defers a large file to its blob', () => {
    const text = interpretGithubContent({
      encoding: 'base64',
      content: Buffer.from('{"lockfileVersion":3}\n', 'utf8').toString('base64'),
      size: 22,
      sha: 'a'.repeat(40),
    })
    expect(text).toEqual({ kind: 'text', text: '{"lockfileVersion":3}\n' })
    expect(interpretGithubContent({
      encoding: 'none',
      content: '',
      size: 2_000_000,
      sha: 'b'.repeat(40),
    })).toEqual({ kind: 'blob', sha: 'b'.repeat(40) })
    expect(interpretGithubContent({ encoding: 'base64', content: 'e30=', size: 9_000_000 })).toEqual({ kind: 'missing' })
  })
})

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(' ')}: ${stderr || stdout || err.message}`))
      else resolve(stdout)
    })
  })
}

describe('npm ci accepts the rewritten lock', () => {
  it('fails on the stale lock and passes after the registry entries are replaced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mushi-npm-lock-'))
    try {
      const tarballs = join(root, 'tarballs')
      await mkdir(tarballs)
      const specs = [
        ['lockfix-leaf', '1.0.0', { name: 'lockfix-leaf', version: '1.0.0' }],
        ['lockfix-core', '1.0.0', {
          name: 'lockfix-core',
          version: '1.0.0',
          dependencies: { 'lockfix-leaf': '^1.0.0' },
          bin: { 'lockfix-core': 'old.js' },
          scripts: { install: 'node -e "process.exit(0)"' },
          engines: { node: '>=18' },
        }],
        ['lockfix-core', '1.1.0', {
          name: 'lockfix-core',
          version: '1.1.0',
          dependencies: { 'lockfix-leaf': '^1.0.0' },
          bin: { 'lockfix-core': 'new.js' },
          engines: { node: '>=20' },
        }],
        ['lockfix-web', '1.0.0', {
          name: 'lockfix-web',
          version: '1.0.0',
          dependencies: { 'lockfix-core': '^1.0.0' },
          bin: { 'lockfix-web': 'old.js' },
          scripts: { install: 'node -e "process.exit(0)"' },
        }],
        ['lockfix-web', '1.1.0', {
          name: 'lockfix-web',
          version: '1.1.0',
          dependencies: { 'lockfix-core': '^1.1.0' },
          bin: { 'lockfix-web': 'new.js' },
          engines: { node: '>=20' },
          peerDependencies: { 'lockfix-peer': '^1.0.0' },
          peerDependenciesMeta: { 'lockfix-peer': { optional: true } },
        }],
      ] as const
      const files = new Map<string, { integrity: string; tarball: string; manifest: Record<string, unknown> }>()
      for (const [name, version, manifest] of specs) {
        const dir = join(root, `${name}-${version}`)
        await mkdir(dir)
        await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
        await writeFile(join(dir, version === '1.0.0' ? 'old.js' : 'new.js'), '')
        if (version === '1.0.0' && name !== 'lockfix-leaf') await writeFile(join(dir, 'old.js'), '')
        const packed = (await run('npm', ['pack', '--pack-destination', tarballs, '--ignore-scripts'], dir)).trim()
        const fileName = packed.split('\n').at(-1) ?? ''
        const tarballPath = join(tarballs, fileName)
        const integrity = `sha512-${createHash('sha512').update(await readFile(tarballPath)).digest('base64')}`
        files.set(`${name}@${version}`, { integrity, tarball: `file://${tarballPath}`, manifest: manifest as Record<string, unknown> })
      }

      const entry = (name: string, version: string, extra: Record<string, unknown> = {}) => {
        const file = files.get(`${name}@${version}`)
        if (!file) throw new Error(`missing ${name}@${version}`)
        return {
          version,
          resolved: file.tarball,
          integrity: file.integrity,
          ...extra,
        }
      }
      const stale = {
        name: 'host',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name: 'host', version: '1.0.0', dependencies: { 'lockfix-web': '^1.0.0' } },
          'node_modules/lockfix-web': entry('lockfix-web', '1.0.0', {
            dependencies: { 'lockfix-core': '^1.0.0' },
            bin: { 'lockfix-web': 'old.js' },
            hasInstallScript: true,
          }),
          'node_modules/lockfix-core': entry('lockfix-core', '1.0.0', {
            dependencies: { 'lockfix-leaf': '^1.0.0' },
            bin: { 'lockfix-core': 'old.js' },
            engines: { node: '>=18' },
            hasInstallScript: true,
          }),
          'node_modules/lockfix-leaf': entry('lockfix-leaf', '1.0.0'),
        },
      }
      const host = join(root, 'host')
      await mkdir(host)
      const bumped = { name: 'host', version: '1.0.0', dependencies: { 'lockfix-web': '^1.1.0' } }
      await writeFile(join(host, 'package.json'), `${JSON.stringify(bumped, null, 2)}\n`)
      await writeFile(join(host, 'package-lock.json'), `${JSON.stringify(stale, null, 2)}\n`)
      await expect(run('npm', ['ci', '--ignore-scripts'], host)).rejects.toThrow()

      const webDoc = toPackument({
        ...files.get('lockfix-web@1.1.0')?.manifest,
        dist: {
          integrity: files.get('lockfix-web@1.1.0')?.integrity,
          tarball: files.get('lockfix-web@1.1.0')?.tarball,
        },
      })
      const coreDoc = toPackument({
        ...files.get('lockfix-core@1.1.0')?.manifest,
        dist: {
          integrity: files.get('lockfix-core@1.1.0')?.integrity,
          tarball: files.get('lockfix-core@1.1.0')?.tarball,
        },
      })
      expect(webDoc && coreDoc).toBeTruthy()
      const result = applyNpmLockUpdates(
        JSON.stringify(stale),
        [{
          path: 'package.json',
          sections: { dependencies: { 'lockfix-web': '^1.1.0' } },
          versions: { 'lockfix-web': '1.1.0' },
        }],
        new Map([['lockfix-web@1.1.0', webDoc!], ['lockfix-core@1.1.0', coreDoc!]]),
        { 'lockfix-core': '1.1.0', 'lockfix-web': '1.1.0' },
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const rewritten = JSON.parse(result.text) as { packages: Record<string, { hasInstallScript?: boolean; bin?: Record<string, string> }> }
      expect(rewritten.packages['node_modules/lockfix-web'].hasInstallScript).toBeUndefined()
      expect(rewritten.packages['node_modules/lockfix-web'].bin).toEqual({ 'lockfix-web': 'new.js' })
      expect(rewritten.packages['node_modules/lockfix-core'].bin).toEqual({ 'lockfix-core': 'new.js' })
      await writeFile(join(host, 'package-lock.json'), result.text)
      await run('npm', ['ci', '--ignore-scripts'], host)
      const installed = JSON.parse(await readFile(join(host, 'node_modules/lockfix-web/package.json'), 'utf8')) as { version: string }
      const installedCore = JSON.parse(await readFile(join(host, 'node_modules/lockfix-core/package.json'), 'utf8')) as { version: string; bin: Record<string, string> }
      expect(installed.version).toBe('1.1.0')
      expect(installedCore.version).toBe('1.1.0')
      expect(installedCore.bin).toEqual({ 'lockfix-core': 'new.js' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})
