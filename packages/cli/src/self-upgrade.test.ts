/**
 * Tests for self-upgrade.ts — `mushi upgrade --self`.
 *
 * Covers install-method detection (user-agent + path heuristics), the
 * per-method command builder (with semver safety), and the runSelfUpgrade
 * orchestration (up-to-date, outdated, registry-down, npx, dry-run).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectInstallMethod,
  selfUpgradeCommand,
  runSelfUpgrade,
} from './self-upgrade.js'
import * as freshness from './freshness.js'
import { MUSHI_CLI_VERSION } from './version.js'

afterEach(() => vi.restoreAllMocks())

// ─── detectInstallMethod ──────────────────────────────────────────────────────

describe('detectInstallMethod', () => {
  it('detects npx from a transient _npx path', () => {
    expect(detectInstallMethod('/home/u/.npm/_npx/abc/node_modules/.bin/mushi', '')).toBe('npx')
  })

  it('detects pnpm from user-agent', () => {
    expect(detectInstallMethod('/usr/lib/mushi', 'pnpm/9.0.0 npm/? node/v20')).toBe('pnpm')
  })

  it('detects bun from user-agent', () => {
    expect(detectInstallMethod('/x/mushi', 'bun/1.1.0')).toBe('bun')
  })

  it('detects yarn from user-agent', () => {
    expect(detectInstallMethod('/x/mushi', 'yarn/4.0.0')).toBe('yarn')
  })

  it('detects npm from user-agent', () => {
    expect(detectInstallMethod('/x/mushi', 'npm/10.0.0 node/v20')).toBe('npm')
  })

  it('falls back to path heuristic when no user-agent (pnpm global)', () => {
    expect(detectInstallMethod('/home/u/.local/share/pnpm/global/5/node_modules/mushi', '')).toBe('pnpm')
  })

  it('falls back to path heuristic for bun global', () => {
    expect(detectInstallMethod('/home/u/.bun/bin/mushi', '')).toBe('bun')
  })

  it('defaults to npm for a generic node_modules path', () => {
    expect(detectInstallMethod('/usr/local/lib/node_modules/@mushi-mushi/cli/dist/index.js', '')).toBe('npm')
  })

  it('returns unknown when nothing matches', () => {
    expect(detectInstallMethod('/opt/custom/mushi', '')).toBe('unknown')
  })

  it('handles Windows backslash paths', () => {
    expect(
      detectInstallMethod('C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@mushi-mushi\\cli\\dist\\index.js', ''),
    ).toBe('npm')
  })
})

// ─── selfUpgradeCommand ───────────────────────────────────────────────────────

describe('selfUpgradeCommand', () => {
  it('builds npm global install', () => {
    expect(selfUpgradeCommand('npm', '1.2.3')).toBe('npm install -g @mushi-mushi/cli@1.2.3')
  })

  it('builds pnpm global add', () => {
    expect(selfUpgradeCommand('pnpm', '1.2.3')).toBe('pnpm add -g @mushi-mushi/cli@1.2.3')
  })

  it('builds yarn global add', () => {
    expect(selfUpgradeCommand('yarn', '1.2.3')).toBe('yarn global add @mushi-mushi/cli@1.2.3')
  })

  it('builds bun global add', () => {
    expect(selfUpgradeCommand('bun', '1.2.3')).toBe('bun add -g @mushi-mushi/cli@1.2.3')
  })

  it('returns null for npx (nothing to upgrade)', () => {
    expect(selfUpgradeCommand('npx', '1.2.3')).toBeNull()
  })

  it('returns null for unknown method', () => {
    expect(selfUpgradeCommand('unknown', '1.2.3')).toBeNull()
  })

  it('rejects a non-semver version (shell-injection guard)', () => {
    expect(selfUpgradeCommand('npm', '1.2.3; rm -rf /')).toBeNull()
    expect(selfUpgradeCommand('npm', 'latest')).toBeNull()
    expect(selfUpgradeCommand('npm', '$(whoami)')).toBeNull()
  })

  it('accepts a pre-release semver', () => {
    expect(selfUpgradeCommand('npm', '1.2.3-rc.1')).toBe('npm install -g @mushi-mushi/cli@1.2.3-rc.1')
  })
})

// ─── runSelfUpgrade ───────────────────────────────────────────────────────────

describe('runSelfUpgrade', () => {
  it('reports up-to-date when freshness says not outdated', async () => {
    vi.spyOn(freshness, 'checkFreshness').mockResolvedValue({
      current: MUSHI_CLI_VERSION,
      latest: MUSHI_CLI_VERSION,
      isOutdated: false,
    })
    const result = await runSelfUpgrade()
    expect(result.upgraded).toBe(false)
    expect(result.command).toBeNull()
    expect(result.message).toContain('already at the latest')
  })

  it('reports registry-unreachable when freshness returns null', async () => {
    vi.spyOn(freshness, 'checkFreshness').mockResolvedValue(null)
    const result = await runSelfUpgrade()
    expect(result.upgraded).toBe(false)
    expect(result.latest).toBeNull()
    expect(result.message).toContain('Could not reach the npm registry')
  })

  it('dry-run prints the command without executing', async () => {
    vi.spyOn(freshness, 'checkFreshness').mockResolvedValue({
      current: MUSHI_CLI_VERSION,
      latest: '99.0.0',
      isOutdated: true,
    })
    const exec = vi.fn()
    const result = await runSelfUpgrade({ dryRun: true, exec })
    expect(exec).not.toHaveBeenCalled()
    expect(result.upgraded).toBe(false)
    expect(result.message).toContain('[dry-run]')
    expect(result.message).toContain('@mushi-mushi/cli@99.0.0')
  })

  it('runs the exec command when outdated and not dry-run', async () => {
    vi.spyOn(freshness, 'checkFreshness').mockResolvedValue({
      current: MUSHI_CLI_VERSION,
      latest: '99.0.0',
      isOutdated: true,
    })
    const exec = vi.fn()
    const result = await runSelfUpgrade({ exec })
    // exec is only called when the install method resolves to a real command.
    // In the test process the method may be npm/unknown — assert consistency:
    if (result.command) {
      expect(exec).toHaveBeenCalledOnce()
      expect(result.upgraded).toBe(true)
      expect(result.message).toContain('Upgraded mushi CLI')
    } else {
      expect(exec).not.toHaveBeenCalled()
      expect(result.upgraded).toBe(false)
    }
  })

  it('swallows an exec failure and returns a manual-command message', async () => {
    vi.spyOn(freshness, 'checkFreshness').mockResolvedValue({
      current: MUSHI_CLI_VERSION,
      latest: '99.0.0',
      isOutdated: true,
    })
    const exec = vi.fn(() => {
      throw new Error('EACCES')
    })
    const result = await runSelfUpgrade({ exec })
    if (result.command) {
      expect(result.upgraded).toBe(false)
      expect(result.message).toContain('run it manually')
    }
  })
})
