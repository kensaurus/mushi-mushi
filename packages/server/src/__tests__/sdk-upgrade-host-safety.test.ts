/**
 * Regressions from the 2026-10-03 SDK upgrade PRs: a stale override broke
 * solo-boss-cloud-documentation#677 (EOVERRIDE), an archived app dir got bump
 * commits (glot.it#142), and package.json text was decoded as Latin-1, so an
 * em dash came back as mojibake (glot.it, the-wanting-mind, tsumagoi).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  archivedDirsFrom,
  computeBumpPlan,
  isUnderArchivedDir,
} from '../../supabase/functions/_shared/sdk-upgrade-plan.ts'

const LATEST = { '@mushi-mushi/web': '1.31.0', '@mushi-mushi/core': '1.31.0' }

describe('computeBumpPlan pins', () => {
  it('moves an npm override pin with the dependency it pins', () => {
    const { updatedPkg } = computeBumpPlan(
      {
        dependencies: { '@mushi-mushi/web': '^1.29.0' },
        overrides: { '@mushi-mushi/web': '1.29.0', 'left-pad': '1.0.0' },
      },
      LATEST,
    )
    expect(updatedPkg.overrides).toEqual({ '@mushi-mushi/web': '1.31.0', 'left-pad': '1.0.0' })
  })

  it('moves yarn resolutions and pnpm overrides the same way', () => {
    const { updatedPkg } = computeBumpPlan(
      {
        dependencies: { '@mushi-mushi/core': '1.28.0' },
        resolutions: { '@mushi-mushi/core': '1.28.0' },
        pnpm: { overrides: { '@mushi-mushi/core': '~1.28.0' }, onlyBuiltDependencies: ['x'] },
      },
      LATEST,
    )
    expect(updatedPkg.resolutions).toEqual({ '@mushi-mushi/core': '1.31.0' })
    expect(updatedPkg.pnpm).toEqual({ overrides: { '@mushi-mushi/core': '~1.31.0' }, onlyBuiltDependencies: ['x'] })
  })

  it('leaves a pin alone when its package is not bumped', () => {
    const { updatedPkg } = computeBumpPlan(
      {
        dependencies: { '@mushi-mushi/web': '1.31.0' },
        overrides: { '@mushi-mushi/core': '1.20.0' },
      },
      LATEST,
    )
    expect(updatedPkg.overrides).toEqual({ '@mushi-mushi/core': '1.20.0' })
  })
})

describe('archived directories', () => {
  it('skips package.json files under a dir with ARCHIVED.md', () => {
    const archived = archivedDirsFrom(['apps/mobile/ARCHIVED.md', 'apps/mobile/package.json', 'package.json'])
    expect(isUnderArchivedDir('apps/mobile/package.json', archived)).toBe(true)
    expect(isUnderArchivedDir('apps/mobile-v2/package.json', archived)).toBe(false)
    expect(isUnderArchivedDir('package.json', archived)).toBe(false)
  })
})

describe('package.json is read as UTF-8', () => {
  const FUNCTIONS = resolve(__dirname, '../../supabase/functions/_shared')
  it.each(['sdk-upgrade-runner.ts', 'sdk-repo-scan.ts'])('%s decodes base64 through TextDecoder', (file) => {
    const src = readFileSync(resolve(FUNCTIONS, file), 'utf8')
    expect(src).not.toMatch(/pkgText = atob\(/)
    expect(src).toContain('new TextDecoder().decode(')
  })

  it('the decode it uses round-trips an em dash', () => {
    const b64 = Buffer.from('{"description":"Mushi — bugs"}', 'utf8').toString('base64')
    const bin = atob(b64)
    const text = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))
    expect(JSON.parse(text).description).toBe('Mushi — bugs')
  })
})
