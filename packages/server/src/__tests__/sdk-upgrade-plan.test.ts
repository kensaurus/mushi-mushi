/**
 * FILE: sdk-upgrade-plan.test.ts
 * PURPOSE: Parity tests for `_shared/sdk-upgrade-plan.ts` — verifies that the
 *          edge-function bump logic applies the same safety guards as the CLI's
 *          `planUpgrade()` in `packages/cli/src/upgrade.ts`.
 *
 * Cases:
 *   1. isNewerSemver — basic ordering and edge cases
 *   2. computeBumpPlan — bumps semver deps, skips non-registry specifiers,
 *      skips workspace: / file: / git URLs, skips already-current packages,
 *      preserves ^ prefix, flags @mushi-mushi/react migration
 */

import { describe, it, expect } from 'vitest'
import {
  isNewerSemver,
  computeBumpPlan,
  UPGRADEABLE_PACKAGES,
} from '../../supabase/functions/_shared/sdk-upgrade-plan.ts'

// ---------------------------------------------------------------------------
// isNewerSemver
// ---------------------------------------------------------------------------
describe('isNewerSemver', () => {
  it('returns true when candidate is a higher patch', () => {
    expect(isNewerSemver('1.7.2', '1.7.1')).toBe(true)
  })

  it('returns true when candidate is a higher minor', () => {
    expect(isNewerSemver('1.8.0', '1.7.9')).toBe(true)
  })

  it('returns true when candidate is a higher major', () => {
    expect(isNewerSemver('2.0.0', '1.99.99')).toBe(true)
  })

  it('returns false when candidate equals current', () => {
    expect(isNewerSemver('1.7.1', '1.7.1')).toBe(false)
  })

  it('returns false when candidate is older', () => {
    expect(isNewerSemver('1.6.0', '1.7.0')).toBe(false)
  })

  it('returns false on malformed input (never triggers a bump)', () => {
    expect(isNewerSemver('not-a-version', '1.7.0')).toBe(false)
    expect(isNewerSemver('1.7.0', 'not-a-version')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// computeBumpPlan — happy path
// ---------------------------------------------------------------------------
describe('computeBumpPlan — basic bumps', () => {
  const latestVersions: Record<string, string> = {
    '@mushi-mushi/web': '1.8.0',
    '@mushi-mushi/core': '1.7.5',
    '@mushi-mushi/cli': '1.2.0',
  }

  it('bumps a plain semver dependency', () => {
    const pkg = {
      dependencies: { '@mushi-mushi/web': '1.7.0' },
    }
    const { bumps, updatedPkg } = computeBumpPlan(pkg, latestVersions)
    expect(bumps).toHaveLength(1)
    expect(bumps[0]).toMatchObject({ package: '@mushi-mushi/web', from: '1.7.0', to: '1.8.0' })
    const deps = updatedPkg.dependencies as Record<string, string>
    expect(deps['@mushi-mushi/web']).toBe('1.8.0')
  })

  it('preserves the ^ specifier prefix', () => {
    const pkg = {
      dependencies: { '@mushi-mushi/web': '^1.7.0' },
    }
    const { bumps, updatedPkg } = computeBumpPlan(pkg, latestVersions)
    expect(bumps[0].from).toBe('1.7.0')
    const deps = updatedPkg.dependencies as Record<string, string>
    expect(deps['@mushi-mushi/web']).toBe('^1.8.0')
  })

  it('bumps packages in devDependencies', () => {
    const pkg = {
      devDependencies: { '@mushi-mushi/cli': '1.0.0' },
    }
    const { bumps, updatedPkg } = computeBumpPlan(pkg, latestVersions)
    expect(bumps).toHaveLength(1)
    const devDeps = updatedPkg.devDependencies as Record<string, string>
    expect(devDeps['@mushi-mushi/cli']).toBe('1.2.0')
  })

  it('returns zero bumps when all packages are already at latest', () => {
    const pkg = {
      dependencies: {
        '@mushi-mushi/web': '1.8.0',
        '@mushi-mushi/core': '1.7.5',
      },
    }
    const { bumps } = computeBumpPlan(pkg, latestVersions)
    expect(bumps).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Guard: non-registry specifiers are never replaced (parity with CLI)
// ---------------------------------------------------------------------------
describe('computeBumpPlan — non-registry specifiers are skipped', () => {
  const latestVersions = { '@mushi-mushi/web': '1.8.0' }

  it('skips workspace: specifier', () => {
    const pkg = {
      dependencies: { '@mushi-mushi/web': 'workspace:*' },
    }
    const { bumps } = computeBumpPlan(pkg, latestVersions)
    expect(bumps).toHaveLength(0)
  })

  it('skips file: specifier', () => {
    const pkg = {
      dependencies: { '@mushi-mushi/web': 'file:../packages/web' },
    }
    const { bumps } = computeBumpPlan(pkg, latestVersions)
    expect(bumps).toHaveLength(0)
  })

  it('skips link: specifier', () => {
    const pkg = {
      dependencies: { '@mushi-mushi/web': 'link:../packages/web' },
    }
    const { bumps } = computeBumpPlan(pkg, latestVersions)
    expect(bumps).toHaveLength(0)
  })

  it('skips git URL specifier', () => {
    const pkg = {
      dependencies: {
        '@mushi-mushi/web': 'github:kensaurus/mushi-mushi#main',
      },
    }
    const { bumps } = computeBumpPlan(pkg, latestVersions)
    expect(bumps).toHaveLength(0)
  })

  it('skips dist-tag specifier (latest, next, etc.)', () => {
    const pkg = {
      dependencies: { '@mushi-mushi/web': 'next' },
    }
    const { bumps } = computeBumpPlan(pkg, latestVersions)
    expect(bumps).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Guard: malformed/missing catalog entries are skipped
// ---------------------------------------------------------------------------
describe('computeBumpPlan — catalog guards', () => {
  it('skips a package whose catalog entry fails SAFE_SEMVER', () => {
    const pkg = { dependencies: { '@mushi-mushi/web': '1.7.0' } }
    const { bumps } = computeBumpPlan(pkg, { '@mushi-mushi/web': 'not-a-semver' })
    expect(bumps).toHaveLength(0)
  })

  it('skips a package with no catalog entry', () => {
    const pkg = { dependencies: { '@mushi-mushi/web': '1.7.0' } }
    const { bumps } = computeBumpPlan(pkg, {})
    expect(bumps).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Guard: packages not in UPGRADEABLE_PACKAGES are ignored
// ---------------------------------------------------------------------------
describe('computeBumpPlan — allow-list', () => {
  it('does not touch non-mushi packages', () => {
    const pkg = {
      dependencies: {
        'react': '18.0.0',
        'lodash': '4.17.20',
        '@mushi-mushi/web': '1.7.0',
      },
    }
    const { bumps, updatedPkg } = computeBumpPlan(pkg, {
      '@mushi-mushi/web': '1.8.0',
    })
    expect(bumps).toHaveLength(1)
    const deps = updatedPkg.dependencies as Record<string, string>
    expect(deps['react']).toBe('18.0.0')
    expect(deps['lodash']).toBe('4.17.20')
  })
})

// ---------------------------------------------------------------------------
// Migration note: @mushi-mushi/react → @mushi-mushi/web
// ---------------------------------------------------------------------------
describe('computeBumpPlan — @mushi-mushi/react migration flag', () => {
  it('sets migrateToWeb=true for @mushi-mushi/react entries', () => {
    const pkg = { dependencies: { '@mushi-mushi/react': '1.0.0' } }
    const { bumps } = computeBumpPlan(pkg, { '@mushi-mushi/react': '1.2.0' })
    expect(bumps).toHaveLength(1)
    expect(bumps[0].migrateToWeb).toBe(true)
  })

  it('does NOT set migrateToWeb for @mushi-mushi/web', () => {
    const pkg = { dependencies: { '@mushi-mushi/web': '1.7.0' } }
    const { bumps } = computeBumpPlan(pkg, { '@mushi-mushi/web': '1.8.0' })
    expect(bumps).toHaveLength(1)
    expect(bumps[0].migrateToWeb).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Structural: UPGRADEABLE_PACKAGES catalog is consistent
// ---------------------------------------------------------------------------
describe('UPGRADEABLE_PACKAGES', () => {
  it('every entry is under the @mushi-mushi scope', () => {
    for (const pkg of UPGRADEABLE_PACKAGES) {
      expect(pkg.startsWith('@mushi-mushi/')).toBe(true)
    }
  })

  it('has no duplicates', () => {
    const set = new Set(UPGRADEABLE_PACKAGES)
    expect(set.size).toBe(UPGRADEABLE_PACKAGES.length)
  })
})
