import { describe, it, expect } from 'vitest'
import {
  detectFromPackageJson,
  monorepoInstallGuidance,
} from './frameworkDetect'

// ─── detectFromPackageJson ─────────────────────────────────────────────────

describe('detectFromPackageJson', () => {
  it('returns react for a Next.js package.json', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { react: '^18.0.0', next: '^14.0.0' } }),
    )
    expect(result.framework).toBe('react')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    expect(result.reason).toContain('Next.js')
  })

  it('returns react-native for a bare RN package.json', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { 'react-native': '0.73.0' } }),
    )
    expect(result.framework).toBe('react-native')
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('returns expo when expo + react-native are present', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { 'react-native': '0.73.0', expo: '^50.0.0' } }),
    )
    expect(result.framework).toBe('expo')
  })

  it('returns vue for a Nuxt package.json', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { nuxt: '^3.0.0' } }),
    )
    expect(result.framework).toBe('vue')
  })

  it('returns svelte for a SvelteKit package.json', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2.0.0' } }),
    )
    expect(result.framework).toBe('svelte')
  })

  it('returns capacitor when @capacitor/core is present', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { '@capacitor/core': '^5.0.0' } }),
    )
    expect(result.framework).toBe('capacitor')
  })

  it('returns vanilla and warns for Angular — recommends @mushi-mushi/angular', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { '@angular/core': '^17.0.0' } }),
    )
    expect(result.framework).toBe('vanilla')
    expect(result.warnings.some((w) => w.includes('@mushi-mushi/angular'))).toBe(true)
  })

  it('returns vanilla for an unknown framework', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { 'some-obscure-lib': '^1.0.0' } }),
    )
    expect(result.framework).toBe('vanilla')
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('recovers from invalid JSON without throwing', () => {
    const result = detectFromPackageJson('{ not valid json }}}')
    expect(result.framework).toBeDefined()
    expect(result.needsHermesTriggerFix).toBe(false)
  })

  // ── Hermes version gating ────────────────────────────────────────────────

  it('flags Hermes fix needed for @mushi-mushi/react-native < 0.11.0', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        dependencies: {
          'react-native': '0.73.0',
          '@mushi-mushi/react-native': '^0.8.2',
        },
      }),
    )
    expect(result.needsHermesTriggerFix).toBe(true)
    expect(result.warnings.some((w) => w.includes('0.11.0'))).toBe(true)
  })

  it('does NOT flag Hermes fix for @mushi-mushi/react-native 0.11.0', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        dependencies: {
          'react-native': '0.73.0',
          '@mushi-mushi/react-native': '^0.11.0',
        },
      }),
    )
    expect(result.needsHermesTriggerFix).toBe(false)
  })

  it('does NOT flag Hermes fix for workspace:^ range >= 0.11.0', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        dependencies: {
          'react-native': '0.73.0',
          '@mushi-mushi/react-native': 'workspace:^0.11.0',
        },
      }),
    )
    expect(result.needsHermesTriggerFix).toBe(false)
  })

  it('flags Hermes fix for workspace:^ range < 0.11.0', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        dependencies: {
          'react-native': '0.73.0',
          '@mushi-mushi/react-native': 'workspace:^0.10.0',
        },
      }),
    )
    expect(result.needsHermesTriggerFix).toBe(true)
  })

  // ── Monorepo detection ───────────────────────────────────────────────────

  it('detects npm-workspaces', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ workspaces: ['apps/*', 'packages/*'], dependencies: { react: '*' } }),
    )
    expect(result.monorepo).toBe('npm-workspaces')
  })

  it('detects pnpm-workspaces via packageManager field', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        workspaces: ['packages/*'],
        packageManager: 'pnpm@9.1.0',
        dependencies: { react: '*' },
      }),
    )
    expect(result.monorepo).toBe('pnpm-workspaces')
  })

  it('detects yarn-workspaces via packageManager field', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        workspaces: ['packages/*'],
        packageManager: 'yarn@4.1.0',
        dependencies: { react: '*' },
      }),
    )
    expect(result.monorepo).toBe('yarn-workspaces')
  })

  it('detects turborepo', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ devDependencies: { turbo: '^1.0.0' }, dependencies: { react: '*' } }),
    )
    expect(result.monorepo).toBe('turborepo')
  })

  it('detects nx', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        devDependencies: { '@nx/workspace': '^17.0.0' },
        dependencies: { react: '*' },
      }),
    )
    expect(result.monorepo).toBe('nx')
  })

  // ── Workspace path resolution (glob stripping) ────────────────────────────

  it('strips glob suffix from workspace path', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        workspaces: ['apps/*'],
        packageManager: 'npm',
        dependencies: { react: '*' },
      }),
    )
    // Should NOT be the raw glob "apps/*"
    expect(result.workspacePath).not.toBe('apps/*')
    expect(result.workspacePath).toContain('apps')
  })

  it('returns null workspace path for non-monorepo', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { react: '*' } }),
    )
    expect(result.workspacePath).toBeNull()
  })

  it('guides to app-level package.json when monorepo root has no framework deps', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ workspaces: ['apps/*'], private: true }),
    )
    expect(result.confidence).toBeLessThan(0.5)
    expect(result.reason).toContain('monorepo root')
  })
})

// ─── monorepoInstallGuidance ───────────────────────────────────────────────

describe('monorepoInstallGuidance', () => {
  it('returns null for flat (non-monorepo) repos', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ dependencies: { react: '*' } }),
    )
    expect(monorepoInstallGuidance(result, 'npm install @mushi-mushi/react')).toBeNull()
  })

  it('generates --workspace= command for npm-workspaces', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ workspaces: ['apps/web'], dependencies: { react: '*' } }),
    )
    const guidance = monorepoInstallGuidance(result, 'npm install @mushi-mushi/react')
    expect(guidance).toContain('--workspace=')
    expect(guidance).toContain('@mushi-mushi/react')
  })

  it('generates --filter command for pnpm-workspaces', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        workspaces: ['apps/web'],
        packageManager: 'pnpm@9.0.0',
        dependencies: { react: '*' },
      }),
    )
    const guidance = monorepoInstallGuidance(result, 'npm install @mushi-mushi/react')
    expect(guidance).toContain('--filter')
    expect(guidance).toContain('@mushi-mushi/react')
  })

  it('generates workspace <name> add for yarn-workspaces', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        workspaces: ['apps/web'],
        packageManager: 'yarn@4.0.0',
        dependencies: { react: '*' },
      }),
    )
    const guidance = monorepoInstallGuidance(result, 'npm install @mushi-mushi/react')
    expect(guidance).toContain('yarn workspace')
    expect(guidance).toContain('add')
  })

  it('strips -g flag from global CLI commands', () => {
    const result = detectFromPackageJson(
      JSON.stringify({ workspaces: ['apps/web'], dependencies: { react: '*' } }),
    )
    const guidance = monorepoInstallGuidance(result, 'npm install -g mushi-mcp')
    // Should not produce a malformed command with -g mushi-mcp still in the pkg slot
    expect(guidance).not.toContain('--workspace=-g')
    expect(guidance).not.toContain('--filter -g')
  })

  it('uses cd <path> for non-workspace monorepos (Turborepo)', () => {
    const result = detectFromPackageJson(
      JSON.stringify({
        devDependencies: { turbo: '^1.0.0' },
        dependencies: { react: '*' },
      }),
    )
    result.monorepo = 'turborepo'
    result.workspaceHint = 'apps/web'
    const guidance = monorepoInstallGuidance(result, 'npm install @mushi-mushi/react')
    expect(guidance).toContain('cd apps/web')
  })
})
