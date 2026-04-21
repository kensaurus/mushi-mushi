import { afterEach, describe, expect, it } from 'vitest'
import { detectWorkspaceHint } from './monorepo.js'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workdirs: string[] = []

afterEach(() => {
  while (workdirs.length) {
    const dir = workdirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failures on Windows
    }
  }
})

function makeTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mushi-monorepo-'))
  workdirs.push(dir)
  return dir
}

describe('detectWorkspaceHint', () => {
  it('returns null for a plain package', () => {
    const root = makeTempWorkspace()
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'plain', dependencies: { next: '15.0.0' } }),
    )
    expect(detectWorkspaceHint(root)).toBeNull()
  })

  it('finds Next.js app in a pnpm workspace when root has no framework', () => {
    const root = makeTempWorkspace()
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'monorepo' }))
    mkdirSync(join(root, 'apps', 'web'), { recursive: true })
    writeFileSync(
      join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: 'web', dependencies: { next: '15.0.0' } }),
    )

    const hint = detectWorkspaceHint(root)
    expect(hint).not.toBeNull()
    expect(hint!.source).toBe('pnpm-workspace')
    expect(hint!.apps).toHaveLength(1)
    expect(hint!.apps[0].name).toBe('web')
    expect(hint!.apps[0].framework).toBe('Next.js')
  })

  it('returns null when root already has a framework dep', () => {
    const root = makeTempWorkspace()
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'root', dependencies: { next: '15.0.0' } }),
    )
    mkdirSync(join(root, 'apps', 'web'), { recursive: true })
    writeFileSync(
      join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: 'web', dependencies: { next: '15.0.0' } }),
    )

    expect(detectWorkspaceHint(root)).toBeNull()
  })

  it('honours the "workspaces" field in package.json', () => {
    const root = makeTempWorkspace()
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    )
    mkdirSync(join(root, 'packages', 'lib'), { recursive: true })
    writeFileSync(
      join(root, 'packages', 'lib', 'package.json'),
      JSON.stringify({ name: 'lib', dependencies: { react: '19.0.0' } }),
    )

    const hint = detectWorkspaceHint(root)
    expect(hint).not.toBeNull()
    expect(hint!.source).toBe('package-json')
    expect(hint!.apps[0].framework).toBe('React')
  })
})
