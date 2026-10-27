/**
 * FILE: lockfiles.test.ts
 * PURPOSE: The pure lockfile parsers of ADR 0038 (decision 3, exact versions
 *          only; decision 9, package coordinates only). Each fixture is a
 *          small hand-made excerpt in the real file format: exact versions,
 *          dev vs production, direct vs transitive, aliases, non-registry
 *          sources skipped, malformed input warns instead of throwing, and
 *          no URL, hash or token survives into the output.
 */

import { describe, expect, it } from 'vitest'
import {
  LOCKFILE_NAMES,
  lockfileKindFor,
  manifestPathsFor,
  parseComposerLock,
  parseGoModules,
  parseLockfile,
  parseNpmLock,
  parsePnpmLock,
  parsePoetryLock,
  parseRequirements,
  parseUvLock,
  parseYarnLock,
  type LockfileParse,
} from '../../supabase/functions/_shared/lockfiles/index.ts'
import { parseTomlLite } from '../../supabase/functions/_shared/lockfiles/toml-lite.ts'
import { parseYamlLite } from '../../supabase/functions/_shared/lockfiles/yaml-lite.ts'

/** `name@version [dev] [direct]`, sorted by code unit so the assertion does not depend on the locale. */
function rows(r: LockfileParse | null): string[] {
  expect(r).not.toBeNull()
  return r!.packages.map((p) => `${p.name}@${p.version}${p.dev ? ' dev' : ''}${p.direct ? ' direct' : ''}`).sort()
}

/** Only coordinates leave a parser: no URL, hash, integrity or registry text (ADR 0038 decision 9). */
function expectCoordinatesOnly(r: LockfileParse | null): void {
  const text = JSON.stringify(r)
  expect(text).not.toMatch(/:\/\//)
  expect(text).not.toMatch(/sha(1|256|512)[-:]/i)
  expect(text).not.toMatch(/sha512-|10c0\/|codeload\.github|registry\.(npmjs|yarnpkg)|pythonhosted|secret-token/i)
  for (const p of r!.packages) expect(Object.keys(p).sort()).toEqual(['dev', 'direct', 'ecosystem', 'name', 'version'])
}

// ---------------------------------------------------------------- npm

const NPM_MANIFEST_V1 = JSON.stringify({
  name: 'app',
  dependencies: { lodash: '^4.17.21', 'my-pad': 'npm:left-pad@^1.3.0', 'local-lib': 'file:../local-lib', gitdep: 'github:acme/gitdep' },
  devDependencies: { jest: '^29.7.0' },
})

const NPM_V1 = JSON.stringify({
  name: 'app',
  version: '1.0.0',
  lockfileVersion: 1,
  requires: true,
  dependencies: {
    lodash: { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', integrity: 'sha512-v2kDE' },
    jest: {
      version: '29.7.0',
      resolved: 'https://registry.npmjs.org/jest/-/jest-29.7.0.tgz',
      integrity: 'sha512-NIy3o',
      dev: true,
      requires: { chalk: '^4.0.0' },
      dependencies: { chalk: { version: '4.1.2', resolved: 'https://registry.npmjs.org/chalk/-/chalk-4.1.2.tgz', integrity: 'sha512-oKnb', dev: true } },
    },
    chalk: { version: '2.4.2', resolved: 'https://registry.npmjs.org/chalk/-/chalk-2.4.2.tgz', integrity: 'sha512-Mti+f' },
    'my-pad': { version: 'npm:left-pad@1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: 'sha512-XI5M' },
    'local-lib': { version: 'file:../local-lib' },
    gitdep: { version: 'git+ssh://git@github.com/acme/gitdep.git#0123abc', from: 'gitdep@github:acme/gitdep' },
  },
})

const NPM_V3 = JSON.stringify({
  name: 'app',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: 'app',
      version: '1.0.0',
      workspaces: ['packages/*'],
      dependencies: { express: '^4.18.0', 'string-width-cjs': 'npm:string-width@^4.2.0' },
      devDependencies: { vitest: '^1.6.0' },
      optionalDependencies: { fsevents: '^2.3.0' },
    },
    'node_modules/express': { version: '4.18.2', resolved: 'https://registry.npmjs.org/express/-/express-4.18.2.tgz', integrity: 'sha512-5/PsL' },
    'node_modules/debug': { version: '2.6.9', resolved: 'https://registry.npmjs.org/debug/-/debug-2.6.9.tgz', integrity: 'sha512-bC7E' },
    'node_modules/express/node_modules/debug': { version: '4.3.4', resolved: 'https://registry.npmjs.org/debug/-/debug-4.3.4.tgz' },
    'node_modules/vitest': { version: '1.6.0', resolved: 'https://registry.npmjs.org/vitest/-/vitest-1.6.0.tgz', dev: true },
    'node_modules/fsevents': { version: '2.3.3', resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz', optional: true, os: ['darwin'] },
    'node_modules/@esbuild/darwin-arm64': { version: '0.21.5', dev: true, optional: true, cpu: ['arm64'] },
    'node_modules/nanoid': { version: '3.3.7', resolved: 'https://npm.acme.internal/secret-token/nanoid-3.3.7.tgz', devOptional: true },
    'node_modules/string-width-cjs': { name: 'string-width', version: '4.2.3', resolved: 'https://registry.npmjs.org/string-width/-/string-width-4.2.3.tgz' },
    'node_modules/@app/shared': { resolved: 'packages/shared', link: true },
    'packages/shared': { name: '@app/shared', version: '1.0.0', dependencies: { zod: '^3.22.0' } },
    'node_modules/zod': { version: '3.22.4', resolved: 'https://registry.npmjs.org/zod/-/zod-3.22.4.tgz' },
    'node_modules/gitdep': { version: '1.0.0', resolved: 'git+ssh://git@github.com/acme/gitdep.git#0123abc' },
    'node_modules/localtar': { version: '2.0.0', resolved: 'file:vendor/localtar-2.0.0.tgz' },
  },
})

describe('parseNpmLock', () => {
  it('lockfileVersion 1: walks the nested tree, reads aliases, skips git and file entries', () => {
    const r = parseNpmLock(NPM_V1, { 'package.json': NPM_MANIFEST_V1 })
    expect(rows(r)).toEqual(['chalk@2.4.2', 'chalk@4.1.2 dev', 'jest@29.7.0 dev direct', 'left-pad@1.3.0 direct', 'lodash@4.17.21 direct'])
    expect(r.warnings.join(' ')).toMatch(/2 entries without a registry version/)
    expectCoordinatesOnly(r)
  })

  it('lockfileVersion 3: dev flag, devOptional is production, aliases, workspaces, nested copies', () => {
    const r = parseNpmLock(NPM_V3)
    expect(rows(r)).toEqual([
      '@esbuild/darwin-arm64@0.21.5 dev',
      'debug@2.6.9',
      'debug@4.3.4',
      'express@4.18.2 direct',
      'fsevents@2.3.3 direct',
      'nanoid@3.3.7',
      'string-width@4.2.3 direct',
      'vitest@1.6.0 dev direct',
      'zod@3.22.4 direct',
    ])
    expect(r.packages.every((p) => p.ecosystem === 'npm')).toBe(true)
    expectCoordinatesOnly(r)
  })

  it('lockfileVersion 2: reads the packages map, not the legacy dependencies copy', () => {
    const v2 = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        '': { dependencies: { minimist: '^1.2.8' } },
        'node_modules/minimist': { version: '1.2.8', resolved: 'https://registry.npmjs.org/minimist/-/minimist-1.2.8.tgz' },
      },
      dependencies: { minimist: { version: '0.0.8' } },
    })
    expect(rows(parseNpmLock(v2))).toEqual(['minimist@1.2.8 direct'])
  })

  it('warns on malformed input instead of throwing', () => {
    expect(parseNpmLock('{"lockfileVersion": 3,').warnings).toEqual(['package-lock.json is not valid JSON.'])
    expect(parseNpmLock('{"lockfileVersion": 3}').warnings[0]).toMatch(/neither/)
  })
})

// ---------------------------------------------------------------- pnpm

const PNPM_V5 = `lockfileVersion: 5.4

specifiers:
  react: ^18.2.0
  react-dom: ^18.2.0
  repo: github:user/repo
  typescript: ^5.0.0

dependencies:
  react: 18.2.0
  react-dom: 18.2.0_react@18.2.0
  repo: github.com/user/repo/abc123

devDependencies:
  typescript: 5.0.4

packages:

  /js-tokens/4.0.0:
    resolution: {integrity: sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==}
    dev: false

  /loose-envify/1.4.0:
    resolution: {integrity: sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko6+fRLevlw1HgMySw7f611UIY408EtxRSoK3Q==}
    hasBin: true
    dependencies:
      js-tokens: 4.0.0
    dev: false

  /react-dom/18.2.0_react@18.2.0:
    resolution: {integrity: sha512-6IMTriUmvsjHUjNtEDudZfuDQUoWXVxKHhlEGSk81n4YFS+r/Kl99wXiwlVXtPBtJenozv2P+hxDsw9eA7Xo6g==}
    peerDependencies:
      react: ^18.2.0
    dependencies:
      loose-envify: 1.4.0
      react: 18.2.0
    dev: false

  /react/18.2.0:
    resolution: {integrity: sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ==}
    engines: {node: '>=0.10.0'}
    dependencies:
      loose-envify: 1.4.0
    dev: false

  /typescript/5.0.4:
    resolution: {integrity: sha512-cW9T5W9xY37cc+jfEnaUvX91foxtHkza3Nw3wkoF4sSlKn0MONdkdEndig/qPBWXNkmplh3NzayQzCiHM4/hqw==}
    engines: {node: '>=12.20'}
    hasBin: true
    dev: true

  github.com/user/repo/abc123:
    resolution: {tarball: https://codeload.github.com/user/repo/tar.gz/abc123}
    name: repo
    version: 1.0.0
    dev: false
`

const PNPM_V6 = `lockfileVersion: '6.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

dependencies:
  my-lodash:
    specifier: npm:lodash@^4.17.21
    version: /lodash@4.17.21
  react-dom:
    specifier: ^18.2.0
    version: 18.2.0(react@18.2.0)

devDependencies:
  '@types/node':
    specifier: ^20.0.0
    version: 20.11.0

packages:

  /@types/node@20.11.0:
    resolution: {integrity: sha512-o9bjXmDNcF7GbM4CNQpmi+TutCgap/K3w1JyKgxAjqx41zp9qlIAVFi0IhCNsJcXolEqLWhbFbEeL0PvYm4pcQ==}
    dependencies:
      undici-types: 5.26.5
    dev: true

  /lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==}
    dev: false

  /react-dom@18.2.0(react@18.2.0):
    resolution: {integrity: sha512-6IMTriUmvsjHUjNtEDudZfuDQUoWXVxKHhlEGSk81n4YFS+r/Kl99wXiwlVXtPBtJenozv2P+hxDsw9eA7Xo6g==}
    peerDependencies:
      react: ^18.2.0
    dependencies:
      react: 18.2.0
    dev: false

  /react@18.2.0:
    resolution: {integrity: sha512-/3IjMdb2L9QbBdWiW5e3P2/npwMBaU9mHCSCUzNln0ZCYbcfTsGbTJrU/kGemdH2IWmB2ioZ+zkxtmq6g09fGQ==}
    dev: false

  /undici-types@5.26.5:
    resolution: {integrity: sha512-JlCMO+ehdEIKqlFxk6IfVoAUVmgz7cU7zD/h9XZ0qzeosSHmUJVOzSQvvYSYWXkFXC+IfLKSIffhv0sVZup6pA==}
    dev: true
`

const PNPM_V9 = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^1.6.0
        version: 1.6.0

  packages/app:
    dependencies:
      '@app/shared':
        specifier: workspace:*
        version: link:../shared
      '@connectrpc/connect-web':
        specifier: ^1.7.0
        version: 1.7.0(@bufbuild/protobuf@1.10.0)(@connectrpc/connect@1.7.0(@bufbuild/protobuf@1.10.0))
      gitpkg:
        specifier: github:user/gitpkg
        version: https://codeload.github.com/user/gitpkg/tar.gz/abc123
      react-dom:
        specifier: ^18.2.0
        version: 18.2.0(react@18.2.0)
      string-width-cjs:
        specifier: npm:string-width@^4.2.0
        version: string-width@4.2.3
    devDependencies:
      react:
        specifier: ^18.2.0
        version: 18.2.0

  packages/shared: {}

packages:

  '@bufbuild/protobuf@1.10.0':
    resolution: {integrity: sha512-QDdVFLoN93Zjg36NoQPZfsVH9tZew7wKDKyV5qRdj8ntT4wQCOradQjRaTdwMhWUYsgKsvCINKKm87FdEk96Ag==}

  '@connectrpc/connect-web@1.7.0':
    resolution: {integrity: sha512-x}
    peerDependencies:
      '@bufbuild/protobuf': ^1.10.0
      '@connectrpc/connect': 1.7.0

  '@connectrpc/connect@1.7.0':
    resolution: {integrity: sha512-x}

  gitpkg@https://codeload.github.com/user/gitpkg/tar.gz/abc123:
    resolution: {tarball: https://codeload.github.com/user/gitpkg/tar.gz/abc123}
    version: 1.0.0

  js-tokens@4.0.0:
    resolution: {integrity: sha512-x}

  loose-envify@1.4.0:
    resolution: {integrity: sha512-x}
    hasBin: true

  react-dom@18.2.0:
    resolution: {integrity: sha512-x}
    peerDependencies:
      react: ^18.2.0

  react@18.2.0:
    resolution: {integrity: sha512-x}
    engines: {node: '>=0.10.0'}

  string-width@4.2.3:
    resolution: {integrity: sha512-x}
    engines: {node: '>=8'}

  tinypool@0.8.4:
    resolution: {integrity: sha512-x}

  vitest@1.6.0:
    resolution: {integrity: sha512-x}

snapshots:

  '@bufbuild/protobuf@1.10.0': {}

  '@connectrpc/connect-web@1.7.0(@bufbuild/protobuf@1.10.0)(@connectrpc/connect@1.7.0(@bufbuild/protobuf@1.10.0))':
    dependencies:
      '@bufbuild/protobuf': 1.10.0
      '@connectrpc/connect': 1.7.0(@bufbuild/protobuf@1.10.0)

  '@connectrpc/connect@1.7.0(@bufbuild/protobuf@1.10.0)':
    dependencies:
      '@bufbuild/protobuf': 1.10.0

  gitpkg@https://codeload.github.com/user/gitpkg/tar.gz/abc123: {}

  js-tokens@4.0.0: {}

  loose-envify@1.4.0:
    dependencies:
      js-tokens: 4.0.0

  react-dom@18.2.0(react@18.2.0):
    dependencies:
      loose-envify: 1.4.0
      react: 18.2.0

  react@18.2.0:
    dependencies:
      loose-envify: 1.4.0

  string-width@4.2.3: {}

  tinypool@0.8.4: {}

  vitest@1.6.0:
    dependencies:
      tinypool: 0.8.4
`

describe('parsePnpmLock', () => {
  it('v5: slash keys, `_peer` suffixes, the dev flag, git packages skipped', () => {
    const r = parsePnpmLock(PNPM_V5)
    expect(rows(r)).toEqual(['js-tokens@4.0.0', 'loose-envify@1.4.0', 'react-dom@18.2.0 direct', 'react@18.2.0 direct', 'typescript@5.0.4 dev direct'])
    expect(r.warnings.join(' ')).toMatch(/1 entry without a registry version/)
    expectCoordinatesOnly(r)
  })

  it('v6: `/name@version(peer)` keys, aliases resolve to the real package', () => {
    const r = parsePnpmLock(PNPM_V6)
    expect(rows(r)).toEqual(['@types/node@20.11.0 dev direct', 'lodash@4.17.21 direct', 'react-dom@18.2.0 direct', 'react@18.2.0', 'undici-types@5.26.5 dev'])
    expectCoordinatesOnly(r)
  })

  it('v9: dev comes from the importer graph, nested peer suffixes strip, links and tarballs skip', () => {
    const r = parsePnpmLock(PNPM_V9)
    expect(rows(r)).toEqual([
      '@bufbuild/protobuf@1.10.0',
      '@connectrpc/connect-web@1.7.0 direct',
      '@connectrpc/connect@1.7.0',
      'js-tokens@4.0.0',
      'loose-envify@1.4.0',
      // A devDependency of one workspace that a production package also needs is production.
      'react-dom@18.2.0 direct',
      'react@18.2.0 direct',
      'string-width@4.2.3 direct',
      'tinypool@0.8.4 dev',
      'vitest@1.6.0 dev direct',
    ])
    expect(r.packages.some((p) => p.name === 'gitpkg')).toBe(false)
    expectCoordinatesOnly(r)
  })

  it('reads this repo-shaped patch_hash suffix as a plain version', () => {
    const text = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      nextra:
        specifier: ^4.6.1
        version: 4.6.1(patch_hash=824343e4873d3865f2ec517e39a2098fca99ed46d47657d051b55d8d5b846258)(react@19.2.7)

packages:

  nextra@4.6.1:
    resolution: {integrity: sha512-x}

  react@19.2.7:
    resolution: {integrity: sha512-x}

snapshots:

  nextra@4.6.1(patch_hash=824343e4873d3865f2ec517e39a2098fca99ed46d47657d051b55d8d5b846258)(react@19.2.7):
    dependencies:
      react: 19.2.7

  react@19.2.7: {}
`
    expect(rows(parsePnpmLock(text))).toEqual(['nextra@4.6.1 direct', 'react@19.2.7'])
  })

  it('warns on malformed input instead of throwing', () => {
    expect(parsePnpmLock('{{{ not yaml').warnings).toEqual(['pnpm-lock.yaml has no lockfileVersion.'])
    expect(parsePnpmLock('').packages).toEqual([])
  })
})

// ---------------------------------------------------------------- yarn

const YARN_MANIFEST = JSON.stringify({
  name: 'app',
  dependencies: {
    react: '^18.2.0',
    lodash: '^4.17.21',
    'string-width-cjs': 'npm:string-width@^4.2.0',
    'my-fork': 'github:acme/my-fork#v1.0.0',
    'old-lib': '^1.0.0',
  },
  devDependencies: { jest: '^29.7.0' },
})

const YARN_CLASSIC = `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.22.5":
  version "7.22.5"
  resolved "https://registry.yarnpkg.com/@babel/code-frame/-/code-frame-7.22.5.tgz#234d98e1551960604f1246e6475891a570ad5658"
  integrity sha512-Xmwn266vad+6DAqEB2A6V/CcZVp62BbwVmcOJc2RPuwih1kw02TjQvWVWlcKGbBPd+8/0V5DEkOcizRGYsspYQ==
  dependencies:
    "@babel/highlight" "^7.22.5"

"@babel/highlight@^7.22.5":
  version "7.22.5"
  resolved "https://registry.yarnpkg.com/@babel/highlight/-/highlight-7.22.5.tgz#aa6c05c5407a67ebce408162b7ede789b4d22031"
  integrity sha512-BSKlD1hgnedS5XRnGOljZawtag7H1yPfQp0tdNJCHoH6AZ+Pcm9VvkrK59/Yy593Ypg0zMxH2BxD1VPYUQ7UIw==

jest@^29.7.0:
  version "29.7.0"
  resolved "https://registry.yarnpkg.com/jest/-/jest-29.7.0.tgz#994676fc24177f088f1c5e3737f5697204ff2613"
  integrity sha512-NIy3oAFp9shda19hy4HK0HRTWKtPJmGdnvywu01nOqNC2vZg+Z+fvJDxpMQA88eb2I9EcafcdjYgsDthnYTvGw==
  dependencies:
    "@babel/code-frame" "^7.0.0"

js-tokens@^4.0.0:
  version "4.0.0"
  resolved "https://registry.yarnpkg.com/js-tokens/-/js-tokens-4.0.0.tgz#19203fb59991df98e3a287050d4647cdeaf32499"

lodash@^3.10.0:
  version "3.10.1"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-3.10.1.tgz#5bf45e8e49ba4189e17d482789dfd15bd140b7b6"

lodash@^4.17.15, lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#679591c564c3bffaae8454cf0b3df370c3d6911c"
  integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==

loose-envify@^1.1.0:
  version "1.4.0"
  resolved "https://registry.yarnpkg.com/loose-envify/-/loose-envify-1.4.0.tgz#71ee51fa7be4caec1a63839f7e682d8132d30caf"
  dependencies:
    js-tokens "^3.0.0 || ^4.0.0"

"js-tokens@^3.0.0 || ^4.0.0":
  version "4.0.0"
  resolved "https://registry.yarnpkg.com/js-tokens/-/js-tokens-4.0.0.tgz#19203fb59991df98e3a287050d4647cdeaf32499"

"my-fork@github:acme/my-fork#v1.0.0":
  version "1.0.0"
  resolved "https://codeload.github.com/acme/my-fork/tar.gz/0123abc"

"gitdep@git+https://github.com/acme/gitdep.git#v2":
  version "2.0.0"
  resolved "git+https://github.com/acme/gitdep.git#abcdef"

old-lib@^1.0.0:
  version "1.0.0"
  resolved "https://npm.acme.internal/secret-token/old-lib-1.0.0.tgz"
  dependencies:
    lodash "^3.10.0"
  optionalDependencies:
    fsevents "^2.3.2"

fsevents@^2.3.2:
  version "2.3.3"
  resolved "https://registry.yarnpkg.com/fsevents/-/fsevents-2.3.3.tgz#cac6407785d03675a2a5e1a5305c697b347d90d6"

react@^18.2.0:
  version "18.2.0"
  resolved "https://registry.yarnpkg.com/react/-/react-18.2.0.tgz#555bd98592883255fa00de14f1151a917b5d77d5"
  dependencies:
    loose-envify "^1.1.0"

"string-width-cjs@npm:string-width@^4.2.0", string-width@^4.1.0:
  version "4.2.3"
  resolved "https://registry.yarnpkg.com/string-width/-/string-width-4.2.3.tgz#269c7117d27b05ad2e536830a8ec895ef9c6d010"
`

const YARN_BERRY = `# This file is generated by running "yarn install" inside your project.
# Manual changes might be lost - proceed with caution!

__metadata:
  version: 8
  cacheKey: 10c0

"@app/shared@workspace:^, @app/shared@workspace:packages/shared":
  version: 0.0.0-use.local
  resolution: "@app/shared@workspace:packages/shared"
  dependencies:
    zod: "npm:^3.22.0"
  languageName: unknown
  linkType: soft

"@babel/code-frame@npm:^7.0.0":
  version: 7.22.5
  resolution: "@babel/code-frame@npm:7.22.5"
  dependencies:
    "@babel/highlight": "npm:^7.22.5"
  checksum: 10c0/0b22d4f1a4d1a6a2dd6b04f7b3c0cd1e1e4e5c8b
  languageName: node
  linkType: hard

"@babel/highlight@npm:^7.22.5":
  version: 7.22.5
  resolution: "@babel/highlight@npm:7.22.5"
  checksum: 10c0/1aecc2b2b8e5a1c9
  languageName: node
  linkType: hard

"app@workspace:.":
  version: 0.0.0-use.local
  resolution: "app@workspace:."
  dependencies:
    "@app/shared": "workspace:^"
    jest: "npm:^29.7.0"
    lodash: "npm:^4.17.21"
    my-fork: "github:acme/my-fork#v1.0.0"
    resolve: "npm:^1.22.0"
    string-width-cjs: "npm:string-width@^4.2.0"
  languageName: unknown
  linkType: soft

"jest@npm:^29.7.0":
  version: 29.7.0
  resolution: "jest@npm:29.7.0"
  dependencies:
    "@babel/code-frame": "npm:^7.0.0"
  bin:
    jest: bin/jest.js
  checksum: 10c0/f40eb8171cf147c617cc6ada49d062fbb03b4da666cb8d39cdbfb739a7d75eea4c3ca150fb072d0d273dce0c753db4d0467d54906ad0293f59c54f9db4a09d8b
  languageName: node
  linkType: hard

"lodash@npm:^4.17.15, lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
  checksum: 10c0/d8cbea072bb08655bb4c989da418994b073a608dffa608b09ac04b43a791b12aeae7cd7ad919aa4c925f33b48490b5cfe6c1f71d827956071dae2e7bb3a6b74c
  languageName: node
  linkType: hard

"my-fork@github:acme/my-fork#v1.0.0":
  version: 1.0.0
  resolution: "my-fork@https://github.com/acme/my-fork.git#commit=0123abc"
  languageName: node
  linkType: hard

"resolve@npm:^1.22.0":
  version: 1.22.8
  resolution: "resolve@npm:1.22.8"
  bin:
    resolve: bin/resolve
  checksum: 10c0/07e179f4375e1fd072cfb72ad66d78547f86e6196c4014b31cb0b8bb1db5f7ca871f922d08da0fbc05b94e9fd42206f819648fa3b5b873ebbc8e1dc68fec433a
  languageName: node
  linkType: hard

"resolve@patch:resolve@npm%3A^1.22.0#optional!builtin<compat/resolve>":
  version: 1.22.8
  resolution: "resolve@patch:resolve@npm%3A1.22.8#optional!builtin<compat/resolve>::version=1.22.8&hash=c3c19d"
  bin:
    resolve: bin/resolve
  checksum: 10c0/0446f024439cd2e50c6c8fa8ba77eaa8370b4180f401a96abf3d1ebc770ac51c1955e12764cde449fde3fff480a61f84388e3505ecdbab778f4bef5f8212c729
  languageName: node
  linkType: hard

"string-width-cjs@npm:string-width@^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
  checksum: 10c0/1e525e92e5eae0afd7454086eed9c818ee84374bb80328fc41217ae72ff5f065ef1c9d7f72da41de40c75fa8bb3dee63d92373fd492c84260a552c636392a47b
  languageName: node
  linkType: hard

"weird@patch:weird@https%3A//example.com/weird.tgz#./weird.patch::locator=app%40workspace%3A.":
  version: 1.0.0
  resolution: "weird@patch:weird@https%3A//example.com/weird.tgz#./weird.patch::version=1.0.0&hash=abc&locator=app%40workspace%3A."
  languageName: node
  linkType: hard

"zod@npm:^3.22.0":
  version: 3.23.8
  resolution: "zod@npm:3.23.8"
  checksum: 10c0/8f14c87d6b1b53c944c25ce7a28616896319d95bc46a9660fe441adc0ed0a81253b02b5abdaeffedbeb23bdd25a0bf1c29d2c12dd919aef6447652dd295e3e69
  languageName: node
  linkType: hard
`

const BERRY_MANIFEST = JSON.stringify({
  name: 'app',
  dependencies: {
    '@app/shared': 'workspace:^',
    lodash: '^4.17.21',
    'my-fork': 'github:acme/my-fork#v1.0.0',
    resolve: '^1.22.0',
    'string-width-cjs': 'npm:string-width@^4.2.0',
  },
  devDependencies: { jest: '^29.7.0' },
})

describe('parseYarnLock', () => {
  it('classic v1: descriptors, aliases, prod closure from package.json, git and codeload skipped', () => {
    const r = parseYarnLock(YARN_CLASSIC, { 'package.json': YARN_MANIFEST })
    expect(rows(r)).toEqual([
      '@babel/code-frame@7.22.5 dev',
      '@babel/highlight@7.22.5 dev',
      'fsevents@2.3.3',
      'jest@29.7.0 dev direct',
      'js-tokens@4.0.0',
      'lodash@3.10.1',
      'lodash@4.17.21 direct',
      'loose-envify@1.4.0',
      'old-lib@1.0.0 direct',
      'react@18.2.0 direct',
      'string-width@4.2.3 direct',
    ])
    expect(r.warnings.join(' ')).toMatch(/2 entries without a registry version/)
    expectCoordinatesOnly(r)
  })

  it('berry: resolution names the real package, npm patches map through, workspaces and git skip', () => {
    const r = parseYarnLock(YARN_BERRY, { 'package.json': BERRY_MANIFEST })
    expect(rows(r)).toEqual([
      '@babel/code-frame@7.22.5 dev',
      '@babel/highlight@7.22.5 dev',
      'jest@29.7.0 dev direct',
      'lodash@4.17.21 direct',
      'resolve@1.22.8 direct',
      'string-width@4.2.3 direct',
      // Reached through the @app/shared workspace, a production dependency.
      'zod@3.23.8 direct',
    ])
    expect(r.warnings.join(' ')).toMatch(/1 patched entry whose underlying npm version is not clear/)
    expectCoordinatesOnly(r)
  })

  it('without a package.json, every package is production and a warning says so', () => {
    const r = parseYarnLock(YARN_BERRY)
    expect(r.packages.every((p) => !p.dev)).toBe(true)
    // Berry's workspace entries still say what is direct.
    expect(r.packages.filter((p) => p.direct).map((p) => p.name)).toEqual(['jest', 'lodash', 'resolve', 'string-width', 'zod'])
    expect(r.warnings.join(' ')).toMatch(/dev dependencies could not be told apart/)
    const classic = parseYarnLock(YARN_CLASSIC)
    expect(classic.packages.every((p) => !p.dev && !p.direct)).toBe(true)
  })

  it('warns on malformed input instead of throwing', () => {
    expect(parseYarnLock('{{{').warnings[0]).toMatch(/not a yarn classic or yarn berry lockfile/)
    expect(parseYarnLock('__metadata:\n  version: 8\n').packages).toEqual([])
  })
})

// ---------------------------------------------------------------- composer

const COMPOSER_LOCK = JSON.stringify({
  _readme: ['This file locks the dependencies of your project to a known state', 'This file is @generated automatically'],
  'content-hash': '9f2c3b1e',
  packages: [
    {
      name: 'symfony/http-foundation',
      version: 'v7.4.0',
      source: { type: 'git', url: 'https://github.com/symfony/http-foundation.git', reference: 'e88a66c3997859532bc2ddd6dd8f35aba2711744' },
      dist: { type: 'zip', url: 'https://api.github.com/repos/symfony/http-foundation/zipball/e88a66c3', reference: 'e88a66c3', shasum: '' },
      require: { php: '>=8.2', 'symfony/polyfill-mbstring': '~1.1' },
      type: 'library',
    },
    { name: 'symfony/polyfill-mbstring', version: 'v1.31.0', dist: { type: 'zip', url: 'https://api.github.com/repos/symfony/polyfill-mbstring/zipball/85181ba9' } },
    { name: 'guzzlehttp/guzzle', version: '7.9.2', dist: { type: 'zip', url: 'https://repo.acme.internal/secret-token/guzzle.zip' } },
    { name: 'Monolog/Monolog', version: '3.8.0' },
    { name: 'acme/internal', version: 'dev-main', source: { type: 'git', url: 'git@github.com:acme/internal.git', reference: 'abc' } },
    { name: 'acme/legacy', version: '2.x-dev' },
    { name: 'acme/local', version: '1.0.0', dist: { type: 'path', url: '../local', reference: 'x' } },
    { name: 'acme/beta', version: '2.0.0-beta1' },
  ],
  'packages-dev': [
    { name: 'phpunit/phpunit', version: '11.5.0' },
    { name: 'sebastian/diff', version: '6.0.2' },
  ],
  aliases: [],
  'minimum-stability': 'stable',
  platform: { php: '^8.2', 'ext-mbstring': '*' },
  'plugin-api-version': '2.6.0',
})

const COMPOSER_JSON = JSON.stringify({
  require: { php: '^8.2', 'ext-mbstring': '*', 'symfony/http-foundation': '^7.4', 'guzzlehttp/guzzle': '^7.9', 'Monolog/Monolog': '^3.8' },
  'require-dev': { 'phpunit/phpunit': '^11' },
})

describe('parseComposerLock', () => {
  it('packages are prod, packages-dev are dev, `v` stripped, branches and paths skipped', () => {
    const r = parseComposerLock(COMPOSER_LOCK, { 'composer.json': COMPOSER_JSON })
    expect(rows(r)).toEqual([
      'acme/beta@2.0.0-beta1',
      'guzzlehttp/guzzle@7.9.2 direct',
      'monolog/monolog@3.8.0 direct',
      'phpunit/phpunit@11.5.0 dev direct',
      'sebastian/diff@6.0.2 dev',
      'symfony/http-foundation@7.4.0 direct',
      'symfony/polyfill-mbstring@1.31.0',
    ])
    expect(r.packages.every((p) => p.ecosystem === 'Packagist')).toBe(true)
    expect(r.packages.some((p) => p.name === 'php' || p.name.startsWith('ext-'))).toBe(false)
    expect(r.warnings).toEqual([
      '2 packages on a branch or without an exact version (dev-main, 2.x-dev) skipped.',
      '1 local path package skipped.',
    ])
    expectCoordinatesOnly(r)
  })

  it('warns on malformed input instead of throwing', () => {
    expect(parseComposerLock('not json').warnings).toEqual(['composer.lock is not valid JSON.'])
    expect(parseComposerLock('null').warnings[0]).toMatch(/neither/)
    expect(parseComposerLock('{"packages": [null, 3, {"name": 1}]}').packages).toEqual([])
  })
})

// ---------------------------------------------------------------- poetry

const POETRY_LOCK_V11 = `[[package]]
name = "requests"
version = "2.31.0"
description = "Python HTTP for Humans."
category = "main"
optional = false
python-versions = ">=3.7"

[package.dependencies]
certifi = ">=2017.4.17"
urllib3 = ">=1.21.1,<3"

[package.extras]
socks = ["PySocks (>=1.5.6,!=1.5.7)"]

[[package]]
name = "pytest"
version = "7.4.0"
description = "pytest: simple powerful testing with Python"
category = "dev"
optional = false
python-versions = ">=3.7"

[metadata]
lock-version = "1.1"
python-versions = "^3.11"
content-hash = "a1b2c3"

[metadata.files]
requests = [
    {file = "requests-2.31.0-py3-none-any.whl", hash = "sha256:58cd2187c01e70e6e26505bca751777aa9f2ee0b7f4300988b709f44e013003f"},
]
pytest = []
`

const POETRY_LOCK_V20 = `# This file is automatically @generated by Poetry 1.8.3 and should not be changed by hand.

[[package]]
name = "asgiref"
version = "3.8.1"
description = "ASGI specs, helper code, and adapters"
optional = false
python-versions = ">=3.8"
files = [
    {file = "asgiref-3.8.1-py3-none-any.whl", hash = "sha256:3e1e3ecc849832fe52ccf2cb6686b7a55f82bb1d6aee72a58826471390335e47"},
]

[[package]]
name = "Django"
version = "5.0.6"
description = "A high-level Python web framework that encourages rapid development and clean, pragmatic design."
optional = false
python-versions = ">=3.10"
files = [
    {file = "Django-5.0.6-py3-none-any.whl", hash = "sha256:8363ac062bb4ef7c3f12d078f6fa5d154031d129a15170a1066412af49d30905"},
    {file = "Django-5.0.6.tar.gz", hash = "sha256:ff1b61005004e476e0aeea47c7f79b85864c70124030e95146315396f1e7951f"},
]

[package.dependencies]
asgiref = ">=3.7.0,<4"
sqlparse = ">=0.3.1"
tzdata = {version = "*", markers = "sys_platform == \\"win32\\""}

[package.extras]
argon2 = ["argon2-cffi (>=19.1.0)"]

[[package]]
name = "iniconfig"
version = "2.0.0"
description = "brain-dead simple config-ini parsing"
optional = false
python-versions = ">=3.7"
files = []

[[package]]
name = "internal-sdk"
version = "1.2.0"
description = ""
optional = false
python-versions = "*"
files = []

[package.source]
type = "legacy"
url = "https://user:secret-token@pypi.acme.internal/simple"
reference = "acme"

[[package]]
name = "my-lib"
version = "0.1.0"
description = ""
optional = false
python-versions = "^3.11"
files = []
develop = false

[package.source]
type = "git"
url = "https://github.com/acme/my-lib.git"
reference = "main"
resolved_reference = "0123abcd"

[[package]]
name = "pytest"
version = "8.2.0"
description = "pytest: simple powerful testing with Python"
optional = false
python-versions = ">=3.8"
files = []

[package.dependencies]
iniconfig = "*"
pluggy = ">=1.5,<2.0"

[[package]]
name = "pluggy"
version = "1.5.0"
description = "plugin and hook calling mechanisms for python"
optional = false
python-versions = ">=3.8"
files = []

[[package]]
name = "sqlparse"
version = "0.5.0"
description = "A non-validating SQL parser."
optional = false
python-versions = ">=3.8"
files = []

[[package]]
name = "tzdata"
version = "2024.1"
description = "Provider of IANA time zone data"
optional = false
python-versions = ">=2"
files = []

[metadata]
lock-version = "2.0"
python-versions = "^3.11"
content-hash = "f00dfeed"
`

const POETRY_PYPROJECT = `[tool.poetry]
name = "app"
version = "0.1.0"
description = ""

[tool.poetry.dependencies]
python = "^3.11"
Django = "^5.0"
my-lib = { git = "https://github.com/acme/my-lib.git" }
internal_sdk = { version = "^1.2", source = "acme" }

[tool.poetry.group.dev.dependencies]
pytest = "^8.2"

[[tool.poetry.source]]
name = "acme"
url = "https://pypi.acme.internal/simple"
priority = "explicit"
`

const POETRY_LOCK_V21 = `# This file is automatically @generated by Poetry 2.0.1 and should not be changed by hand.

[[package]]
name = "certifi"
version = "2024.12.14"
description = "Python package for providing Mozilla's CA Bundle."
optional = false
python-versions = ">=3.6"
groups = ["main", "dev"]
files = [
    {file = "certifi-2024.12.14-py3-none-any.whl", hash = "sha256:1275f7a45be9464efc1173084eaa30f866fe2e47d389406136d332ed4967ec56"},
]

[[package]]
name = "coverage"
version = "7.6.9"
description = "Code coverage measurement for Python"
optional = false
python-versions = ">=3.9"
groups = ["dev"]
markers = "python_version < \\"3.13\\""
files = []

[package.extras]
toml = ["tomli ; python_full_version <= \\"3.11.0a6\\""]

[metadata]
lock-version = "2.1"
python-versions = ">=3.11"
content-hash = "beef"
`

describe('parsePoetryLock', () => {
  it('poetry < 1.2: category decides dev', () => {
    const r = parsePoetryLock(POETRY_LOCK_V11)
    expect(rows(r)).toEqual(['pytest@7.4.0 dev', 'requests@2.31.0'])
    expect(r.warnings.join(' ')).toMatch(/direct dependencies could not be told apart/)
    expectCoordinatesOnly(r)
  })

  it('lock 2.0: dev from the pyproject closure, names normalised, git sources skipped, private index kept', () => {
    const r = parsePoetryLock(POETRY_LOCK_V20, { 'pyproject.toml': POETRY_PYPROJECT })
    expect(rows(r)).toEqual([
      'asgiref@3.8.1',
      'django@5.0.6 direct',
      'iniconfig@2.0.0 dev',
      'internal-sdk@1.2.0 direct',
      'pluggy@1.5.0 dev',
      'pytest@8.2.0 dev direct',
      'sqlparse@0.5.0',
      'tzdata@2024.1',
    ])
    expect(r.packages.every((p) => p.ecosystem === 'PyPI')).toBe(true)
    expect(r.warnings).toEqual(['1 package from git, a local path or a URL skipped.'])
    expectCoordinatesOnly(r)
  })

  it('lock 2.0 without a pyproject: production by default, with a warning', () => {
    const r = parsePoetryLock(POETRY_LOCK_V20)
    expect(r.packages.every((p) => !p.dev && !p.direct)).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/dev dependencies could not be told apart/)
  })

  it('poetry 2: groups decide dev', () => {
    expect(rows(parsePoetryLock(POETRY_LOCK_V21))).toEqual(['certifi@2024.12.14', 'coverage@7.6.9 dev'])
  })

  it('warns on malformed input instead of throwing', () => {
    expect(parsePoetryLock('[[package\nname = ').warnings).toEqual(['poetry.lock could not be read.'])
    expect(parsePoetryLock('').warnings).toEqual(['poetry.lock lists no packages.'])
  })
})

// ---------------------------------------------------------------- uv

const UV_LOCK = `version = 1
revision = 2
requires-python = ">=3.12"
resolution-markers = [
    "python_full_version >= '3.13'",
    "python_full_version < '3.13'",
]

[[package]]
name = "anyio"
version = "4.6.2"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "idna" },
    { name = "sniffio" },
]
sdist = { url = "https://files.pythonhosted.org/packages/9f/09/anyio-4.6.2.tar.gz", hash = "sha256:f72a7bb3dd0752b3bd8b17a844a019d77", size = 173422, upload-time = "2024-10-14T14:31:44.021Z" }
wheels = [
    { url = "https://files.pythonhosted.org/packages/e4/f5/anyio-4.6.2-py3-none-any.whl", hash = "sha256:6d2cbf6ea7fcc3d1d8f7da2d1b1d4b5f", size = 89766, upload-time = "2024-10-14T14:31:42.623Z" },
]

[[package]]
name = "app"
version = "0.1.0"
source = { virtual = "." }
dependencies = [
    { name = "fastapi" },
    { name = "mylib" },
    { name = "numpy", version = "2.1.0", source = { registry = "https://pypi.org/simple" }, marker = "python_full_version >= '3.13'" },
    { name = "shared" },
    { name = "uvicorn", extra = ["standard"] },
]

[package.optional-dependencies]
dev = [
    { name = "ruff" },
]
pdf = [
    { name = "pypdf" },
]

[package.dev-dependencies]
test = [
    { name = "pytest" },
]

[package.metadata]
requires-dist = [
    { name = "fastapi", specifier = ">=0.115" },
    { name = "uvicorn", extras = ["standard"], specifier = ">=0.30" },
]

[package.metadata.requires-dev]
test = [{ name = "pytest", specifier = ">=8" }]

[[package]]
name = "click"
version = "8.1.7"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "fastapi"
version = "0.115.4"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "starlette" },
]

[[package]]
name = "h11"
version = "0.14.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "httptools"
version = "0.6.4"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "idna"
version = "3.10"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "iniconfig"
version = "2.0.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "mylib"
version = "0.2.0"
source = { git = "https://github.com/acme/mylib?rev=main#0123abcd" }

[[package]]
name = "numpy"
version = "1.26.4"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "numpy"
version = "2.1.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "pypdf"
version = "5.1.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "pytest"
version = "8.3.3"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "iniconfig" },
    { name = "numpy", version = "1.26.4", source = { registry = "https://pypi.org/simple" } },
]

[[package]]
name = "ruff"
version = "0.7.1"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "shared"
version = "0.1.0"
source = { editable = "packages/shared" }
dependencies = [
    { name = "Attrs" },
]

[[package]]
name = "attrs"
version = "24.2.0"
source = { registry = "https://user:secret-token@pypi.acme.internal/simple" }

[[package]]
name = "sniffio"
version = "1.3.1"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "starlette"
version = "0.41.2"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "anyio" },
]

[[package]]
name = "uvicorn"
version = "0.32.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "click" },
    { name = "h11" },
]

[package.optional-dependencies]
standard = [
    { name = "httptools" },
    { name = "uvloop", marker = "platform_python_implementation != 'PyPy' and sys_platform != 'win32'" },
]

[[package]]
name = "uvloop"
version = "0.21.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "websockets"
version = "13.1"
source = { url = "https://example.com/websockets-13.1.tar.gz" }
`

describe('parseUvLock', () => {
  it('registry sources only, production from the virtual root, extras followed, dev groups dev', () => {
    const r = parseUvLock(UV_LOCK)
    expect(rows(r)).toEqual([
      'anyio@4.6.2',
      // A dependency of the editable workspace member `shared`.
      'attrs@24.2.0 direct',
      'click@8.1.7',
      'fastapi@0.115.4 direct',
      'h11@0.14.0',
      // uvicorn[standard] pulls in its extra.
      'httptools@0.6.4',
      'idna@3.10',
      'iniconfig@2.0.0 dev',
      // A version-pinned reference points at that version only.
      'numpy@1.26.4 dev',
      'numpy@2.1.0 direct',
      'pypdf@5.1.0 direct',
      'pytest@8.3.3 dev direct',
      // An extra named `dev` is a dev group.
      'ruff@0.7.1 dev direct',
      'sniffio@1.3.1',
      'starlette@0.41.2',
      'uvicorn@0.32.0 direct',
      'uvloop@0.21.0',
    ])
    expect(r.warnings).toEqual(['2 packages from git, a local path or a URL skipped.'])
    expectCoordinatesOnly(r)
  })

  it('without a root package, falls back to pyproject.toml, else warns', () => {
    const lock = `version = 1

[[package]]
name = "flask"
version = "3.0.3"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "pytest"
version = "8.3.3"
source = { registry = "https://pypi.org/simple" }
`
    const pyproject = `[project]
name = "app"
dependencies = ["Flask[async]>=3.0; python_version >= '3.9'"]

[dependency-groups]
dev = ["pytest>=8", { include-group = "lint" }]
`
    expect(rows(parseUvLock(lock, { 'pyproject.toml': pyproject }))).toEqual(['flask@3.0.3 direct', 'pytest@8.3.3 dev direct'])
    const bare = parseUvLock(lock)
    expect(rows(bare)).toEqual(['flask@3.0.3', 'pytest@8.3.3'])
    expect(bare.warnings.join(' ')).toMatch(/dev dependencies could not be told apart/)
  })

  it('warns on malformed input instead of throwing', () => {
    expect(parseUvLock('[[package]\nname = "x"').warnings).toEqual(['uv.lock could not be read.'])
    expect(parseUvLock('[[package]]\nname = 3\n').packages).toEqual([])
  })
})

// ---------------------------------------------------------------- requirements

const REQUIREMENTS = `#
# This file is autogenerated by pip-compile with Python 3.12
#
--index-url https://user:secret-token@pypi.acme.internal/simple
-r base.txt
-e ./libs/shared
Django==5.0.6 \\
    --hash=sha256:8363ac062bb4ef7c3f12d078f6fa5d154031d129a15170a1066412af49d30905 \\
    --hash=sha256:ff1b61005004e476e0aeea47c7f79b85864c70124030e95146315396f1e7951f
    # via -r requirements.in
requests[socks,security]==2.31.0 ; python_version >= "3.8"  # pinned for the proxy
urllib3===2.2.1
celery>=5.3
numpy
flask==3.*
pkg @ https://example.com/pkg-1.0.tar.gz
git+https://github.com/acme/thing.git@v1.0#egg=thing
Pillow == 10.3.0
zope.interface==6.4.post2
`

describe('parseRequirements', () => {
  it('keeps exact pins only and says how many ranges cannot match', () => {
    const r = parseRequirements(REQUIREMENTS, 'services/api/requirements.txt')
    expect(rows(r)).toEqual(['django@5.0.6 direct', 'pillow@10.3.0 direct', 'requests@2.31.0 direct', 'urllib3@2.2.1 direct', 'zope-interface@6.4.post2 direct'])
    expect(r.warnings).toEqual([
      '3 requirements are a range or unpinned and cannot be matched to an advisory; pin exact versions (pip-compile, uv pip compile or pip freeze).',
      '3 editable, VCS, URL or local requirements skipped.',
      '1 included file (-r / -c) not followed; each requirements file is read on its own.',
    ])
    expectCoordinatesOnly(r)
  })

  it('a dev or test file marks every package dev; requirements-latest is not one', () => {
    expect(parseRequirements('pytest==8.3.3\n', 'requirements-dev.txt').packages[0].dev).toBe(true)
    expect(parseRequirements('pytest==8.3.3\n', 'requirements_test.txt').packages[0].dev).toBe(true)
    expect(parseRequirements('flask==3.0.3\n', 'requirements-latest.txt').packages[0].dev).toBe(false)
  })

  it('warns on malformed input instead of throwing', () => {
    const r = parseRequirements('%%% \u0000 !!!\n', 'requirements.txt')
    expect(r.packages).toEqual([])
    expect(r.warnings).toEqual(['1 line is not a requirement and was skipped.'])
  })
})

// ---------------------------------------------------------------- go

const GO_MOD = `module example.com/app

go 1.22

toolchain go1.22.3

require (
\tgithub.com/acme/forked v1.0.0
\tgithub.com/acme/local v0.1.0
\tgithub.com/docker/docker v24.0.7+incompatible
\tgithub.com/gin-gonic/gin v1.9.1
\tgithub.com/not/in-sum v1.2.3
\tgolang.org/x/crypto v0.0.0-20231201120000-abcdef123456 // indirect
\tgolang.org/x/net v0.20.0 // indirect
)

require github.com/pkg/errors v0.9.1

replace github.com/acme/forked => github.com/acme/forked-fix v1.0.1

replace github.com/acme/local => ../local
`

const GO_SUM = `github.com/acme/forked-fix v1.0.1 h1:Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5
github.com/acme/forked-fix v1.0.1/go.mod h1:Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5
github.com/docker/docker v24.0.7+incompatible h1:Wo6l37AuwP3JaMnZa226lzVXGA3F9Ig1seQen0cKYlM=
github.com/docker/docker v24.0.7+incompatible/go.mod h1:eEKB0N0r5NX/I1kEveEz05bcu8tLC/8azJZsviup8Sk=
github.com/gin-gonic/gin v1.9.1 h1:4idEAncQnU5cB7BeOkPtxjfCSye0AAm1R0RVIqJ+Jmg=
github.com/gin-gonic/gin v1.9.1/go.mod h1:hPrL7YrpYKXt5YId3A/Tnip5kqbEAP+KLuI3SUcPTeU=
github.com/pkg/errors v0.9.1 h1:FEBLx1zS214owpjy7qsBeixbURkuhQAwrK5UwLGTwt4=
github.com/pkg/errors v0.9.1/go.mod h1:bwawxfHBFNV+L2hUp1rHADufV3IMtnDRdf1r5NINEl0=
golang.org/x/crypto v0.0.0-20231201120000-abcdef123456 h1:Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5
golang.org/x/net v0.20.0/go.mod h1:z8BVo6PvndSri0LbOE3hAn0apkU+1YvI6E70E9jsnvY=
`

describe('parseGoModules', () => {
  it('go.mod requires filtered by go.sum, replace applied, `v` and +incompatible stripped', () => {
    const r = parseGoModules(GO_SUM, GO_MOD)
    expect(rows(r)).toEqual([
      'github.com/acme/forked-fix@1.0.1 direct',
      'github.com/docker/docker@24.0.7 direct',
      'github.com/gin-gonic/gin@1.9.1 direct',
      'github.com/pkg/errors@0.9.1 direct',
      'golang.org/x/crypto@0.0.0-20231201120000-abcdef123456',
      'golang.org/x/net@0.20.0',
    ])
    expect(r.packages.every((p) => p.ecosystem === 'Go' && !p.dev)).toBe(true)
    expect(r.warnings).toEqual([
      '1 module replaced by a local directory skipped.',
      '1 module in go.mod missing from go.sum skipped; run `go mod tidy`.',
    ])
    expectCoordinatesOnly(r)
  })

  it('a version-specific replace wins over a module-wide one', () => {
    const mod = `module example.com/app

go 1.21

require example.com/lib v1.2.0

replace example.com/lib => ./vendor/lib

replace example.com/lib v1.2.0 => example.com/lib v1.2.1
`
    expect(rows(parseGoModules(null, mod))).toEqual(['example.com/lib@1.2.1 direct'])
  })

  it('without go.sum uses go.mod alone and warns; old go directives warn about missing indirect modules', () => {
    const r = parseGoModules(null, GO_MOD.replace('go 1.22', 'go 1.16'))
    expect(r.packages.map((p) => p.name)).toContain('github.com/not/in-sum')
    expect(r.warnings).toContain('No go.sum was read, so versions come from go.mod alone.')
    expect(r.warnings.join(' ')).toMatch(/before Go 1\.17/)
  })

  it('warns on malformed input instead of throwing', () => {
    expect(parseGoModules(GO_SUM, null).warnings[0]).toMatch(/go\.mod was not read/)
    expect(parseGoModules(GO_SUM, '<<<garbage>>>').warnings).toEqual(['go.mod could not be read: it has no module line.'])
  })
})

// ---------------------------------------------------------------- index

describe('lockfile index', () => {
  it('names every lockfile kind and requirements variants', () => {
    expect(LOCKFILE_NAMES['package-lock.json']).toBe('npm')
    expect(lockfileKindFor('apps/web/npm-shrinkwrap.json')).toBe('npm')
    expect(lockfileKindFor('pnpm-lock.yaml')).toBe('pnpm')
    expect(lockfileKindFor('yarn.lock')).toBe('yarn')
    expect(lockfileKindFor('api/composer.lock')).toBe('composer')
    expect(lockfileKindFor('poetry.lock')).toBe('poetry')
    expect(lockfileKindFor('uv.lock')).toBe('uv')
    expect(lockfileKindFor('go.sum')).toBe('gosum')
    expect(lockfileKindFor('requirements.txt')).toBe('requirements')
    expect(lockfileKindFor('backend/requirements-dev.txt')).toBe('requirements')
    expect(lockfileKindFor('requirements.prod.txt')).toBe('requirements')
    expect(lockfileKindFor('dev-requirements.txt')).toBeNull()
    expect(lockfileKindFor('package.json')).toBeNull()
    expect(lockfileKindFor('toString')).toBeNull()
  })

  it('lists the manifest to read beside each lockfile', () => {
    expect(manifestPathsFor('apps/web/pnpm-lock.yaml')).toEqual(['apps/web/package.json'])
    expect(manifestPathsFor('yarn.lock')).toEqual(['package.json'])
    expect(manifestPathsFor('api/composer.lock')).toEqual(['api/composer.json'])
    expect(manifestPathsFor('svc/poetry.lock')).toEqual(['svc/pyproject.toml'])
    expect(manifestPathsFor('uv.lock')).toEqual(['pyproject.toml'])
    expect(manifestPathsFor('cmd/go.sum')).toEqual(['cmd/go.mod'])
    expect(manifestPathsFor('requirements.txt')).toEqual([])
    expect(manifestPathsFor('README.md')).toEqual([])
  })

  it('dispatches by path and passes the manifests', () => {
    expect(rows(parseLockfile('svc/go.sum', GO_SUM, { 'svc/go.mod': GO_MOD }))).toHaveLength(6)
    expect(parseLockfile('composer.lock', COMPOSER_LOCK, { 'composer.json': COMPOSER_JSON })!.kind).toBe('composer')
    expect(parseLockfile('requirements-dev.txt', 'pytest==8.3.3')!.packages[0].dev).toBe(true)
    expect(parseLockfile('README.md', 'hello')).toBeNull()
  })

  it('never throws, whatever the input', () => {
    const junk = [
      '',
      '\u0000\u0001',
      '{{{',
      '[[[',
      'null',
      '3',
      '[]',
      '{"packages": {"node_modules/a": null}}',
      '{"lockfileVersion": 1, "dependencies": {"a": null, "b": {"version": 5}}}',
      '- - -\n  : :',
      '"unterminated',
      'a = """never closed',
      '[[package]]\nname = "a"\nversion = 1\nsource = 3\ndependencies = "x"\n[package.optional-dependencies]\nx = 5',
      'lockfileVersion: 9.0\nimporters: 5\npackages:\n  - a\nsnapshots: x',
      '__metadata:\nfoo@npm:1:\n  dependencies: x\n',
      '"a@^1":\n  version "1.0.0"\n  dependencies:\n    b\n',
    ]
    // Each parser on its own, so a throw is not hidden by parseLockfile's guard.
    const direct = [parseNpmLock, parsePnpmLock, parseYarnLock, parseComposerLock, parsePoetryLock, parseUvLock, parseRequirements]
    for (const parse of direct) for (const text of junk) expect(() => parse(text)).not.toThrow()
    for (const text of junk) {
      expect(() => parseGoModules(text, text)).not.toThrow()
      expect(() => parseGoModules(text, `module m\n${text}`)).not.toThrow()
    }
    for (const path of Object.keys(LOCKFILE_NAMES).concat('requirements.txt')) {
      for (const text of junk) {
        const r = parseLockfile(path, text)
        expect(r).not.toBeNull()
        expect(Array.isArray(r!.packages)).toBe(true)
      }
      expect(() => parseLockfile(path, undefined as unknown as string)).not.toThrow()
    }
  })
})

// ---------------------------------------------------------------- readers

describe('yaml-lite and toml-lite', () => {
  it('yaml-lite keeps quoted keys with colons and commas, and skips block scalars', () => {
    const doc = parseYamlLite(`"a@npm:^1, a@npm:^1.2":
  version: 1.2.0
  note: |
    text: that: looks
    like: keys
  after: yes
`)
    expect(doc).toEqual({ 'a@npm:^1, a@npm:^1.2': { version: '1.2.0', note: '', after: 'yes' } })
  })

  it('toml-lite reads arrays of tables, sub-tables of the last element, inline tables and multi-line arrays', () => {
    const doc = parseTomlLite(`[[package]]
name = "a"
deps = [
    { name = "b", extra = ["x"] },  # trailing comment
]

[package.optional-dependencies]
x = [{ name = "c" }]

[[package]]
name = 'd'
`)
    expect(doc).toEqual({
      package: [
        { name: 'a', deps: [{ name: 'b', extra: ['x'] }], 'optional-dependencies': { x: [{ name: 'c' }] } },
        { name: 'd' },
      ],
    })
  })
})

// pnpm.io/lockfile and pnpm.io/settings/peer-dependencies (read 2026-10-22).
describe('pnpm: env document and auto-installed peers', () => {
  const project = [
    "lockfileVersion: '9.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '',
    'importers:',
    '',
    '  packages/node:',
    '    dependencies:',
    '      hono:',
    "        specifier: '>=4.13.5 <5'",
    '        version: 4.13.7',
    '      zod:',
    '        specifier: ^3.25.0',
    '        version: 3.25.76',
    '',
    '  packages/server:',
    '    devDependencies:',
    '      hono:',
    '        specifier: ^4.13.7',
    '        version: 4.13.7',
    '',
    'packages:',
    '',
    '  hono@4.13.7:',
    "    resolution: {integrity: sha512-x}",
    '',
    '  zod@3.25.76:',
    "    resolution: {integrity: sha512-y}",
    '',
    'snapshots:',
    '',
    '  hono@4.13.7: {}',
    '',
    '  zod@3.25.76: {}',
    '',
  ].join('\n')
  const env = [
    '---',
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    packageManagerDependencies:',
    '      pnpm:',
    '        specifier: 12.3.4',
    '        version: 12.3.4',
    '',
    'packages:',
    '',
    '  pnpm@12.3.4:',
    "    resolution: {integrity: sha512-z}",
    '',
    'snapshots:',
    '',
    '  pnpm@12.3.4: {}',
    '---',
    '',
  ].join('\n')
  const manifests = {
    'packages/node/package.json': JSON.stringify({ name: '@x/node', dependencies: { zod: '^3.25.0' }, peerDependencies: { hono: '>=4.0.0' }, peerDependenciesMeta: { hono: { optional: true } } }),
    'packages/server/package.json': JSON.stringify({ name: '@x/server', devDependencies: { hono: '^4.13.7' } }),
  }

  it('reads only the project lockfile, never the env document (pnpm itself)', () => {
    const out = parseLockfile('pnpm-lock.yaml', env + project, manifests)!
    expect(out.packages.map((p) => p.name).sort()).toEqual(['hono', 'zod'])
  })

  it('does not count a peer the importer only declares in peerDependencies as production or direct', () => {
    const out = parseLockfile('pnpm-lock.yaml', project, manifests)!
    expect(out.packages.find((p) => p.name === 'hono')).toMatchObject({ dev: true, direct: true })
    expect(out.packages.find((p) => p.name === 'zod')).toMatchObject({ dev: false, direct: true })
    expect(out.warnings.join(' ')).toContain('auto-installed peer')
    // Without the importers' manifests, the old reading stands (production).
    expect(parseLockfile('pnpm-lock.yaml', project, {})!.packages.find((p) => p.name === 'hono')?.dev).toBe(false)
  })
})

