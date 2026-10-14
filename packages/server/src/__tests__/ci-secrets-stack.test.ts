/**
 * FILE: packages/server/src/__tests__/ci-secrets-stack.test.ts
 * PURPOSE: The CI-secret diagnostic and sync name the env vars the app's
 *          bundler really inlines. They used to guess from the project slug,
 *          so an Expo or Vite app was told to add, and sync WROTE,
 *          NEXT_PUBLIC_MUSHI_* names its build never reads (console IA pass,
 *          2026-10-14).
 *   - detectRepoStack reads the repo's package.json files, skips unreadable
 *     ones, and throws only when nothing at all could be read.
 *   - Source contract: both routes call it with the resolved token, keep the
 *     slug only as the fallback, build the vars to WRITE after detection, and
 *     print every var (endpoint included) in the guided fallback.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gh = vi.hoisted(() => ({
  files: new Map<string, string | Error>(),
  head: vi.fn(async () => ({ branch: 'main', sha: 'abc' })),
}))

vi.mock('../../supabase/functions/_shared/recipe-github.ts', () => ({
  getDefaultHead: gh.head,
  readRepoFile: async (_repo: unknown, _ref: string, path: string) => {
    const f = gh.files.get(path)
    if (f instanceof Error) throw f
    return f === undefined ? { kind: 'absent', path } : { kind: 'file', path, text: f, sha: 's', size: f.length }
  },
}))

import { detectRepoStack } from '../../supabase/functions/_shared/repo-stack.ts'

const REPO = { ref: { owner: 'o', repo: 'r' }, token: 't', repoUrl: 'https://github.com/o/r', defaultBranchHint: 'main' } as never

describe('detectRepoStack', () => {
  beforeEach(() => gh.files.clear())

  it('reads an Expo app from its package.json', async () => {
    gh.files.set('apps/mobile/package.json', JSON.stringify({ dependencies: { expo: '54', '@mushi-mushi/react-native': '0.24' } }))
    await expect(detectRepoStack(REPO)).resolves.toBe('expo')
  })

  it('reads a Vite app and skips a file that could not be read', async () => {
    gh.files.set('package.json', new Error('GitHub answered 500'))
    gh.files.set('apps/web/package.json', JSON.stringify({ devDependencies: { vite: '7' } }))
    await expect(detectRepoStack(REPO)).resolves.toBe('vite')
  })

  it('is null when no package.json names a bundler (the slug then decides)', async () => {
    gh.files.set('package.json', JSON.stringify({ dependencies: { lodash: '4' } }))
    await expect(detectRepoStack(REPO)).resolves.toBeNull()
  })

  it('throws when nothing could be read, so a caller never treats it as an answer', async () => {
    for (const p of ['package.json', 'apps/mobile/package.json', 'apps/web/package.json', 'apps/app/package.json', 'apps/admin/package.json', 'src/package.json']) {
      gh.files.set(p, new Error('403'))
    }
    await expect(detectRepoStack(REPO)).rejects.toThrow(/No package.json could be read/)
  })
})

describe('project-ci-secrets routes (source contract)', () => {
  const SRC = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/project-ci-secrets.ts'), 'utf8')
  const route = (sig: string) => {
    const start = SRC.indexOf(sig)
    expect(start, sig).toBeGreaterThan(0)
    const next = SRC.indexOf('app.', start + sig.length)
    return SRC.slice(start, next > start ? next : undefined)
  }

  it('the diagnostic replaces the slug guess with the repo stack once a token can read it', () => {
    const r = route("app.get('/v1/admin/projects/:id/sdk-diagnostics'")
    expect(r).toContain('let stack: SdkStack = inferStack(slug)')
    expect(r).toMatch(/detectRepoStack\(\{ ref: repoRef, token,[^)]*\)\.catch\(\(\) => null\)/)
    expect(r).toContain("stackSource = 'repo'")
    expect(r).toContain('required = requiredCiVarNames(stack)')
  })

  it('sync builds the vars it WRITES only after reading the repo stack', () => {
    const r = route("app.post('/v1/admin/projects/:id/sync-ci-secrets'")
    const detect = r.indexOf('detectRepoStack(')
    const build = r.indexOf('buildCiVars(')
    const write = r.indexOf('putRepoSecret(')
    expect(detect).toBeGreaterThan(0)
    expect(build).toBeGreaterThan(detect)
    expect(write).toBeGreaterThan(build)
    // The guided fallback prints every var, the optional endpoint included.
    expect(r).not.toContain('ciVarTemplates: requiredCiVarNames(')
    expect(r.match(/ciVarTemplates: ciVarTemplateNames\(stack\)/g)?.length).toBe(3)
  })
})
