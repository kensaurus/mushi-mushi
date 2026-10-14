/**
 * The env check expects the Mushi env names the app's bundler really
 * inlines. It used to expect NEXT_PUBLIC_MUSHI_* for every app whose slug
 * was not on a short list, so Expo apps (EXPO_PUBLIC_MUSHI_*) and Vite apps
 * (VITE_MUSHI_*) read "Missing from GitHub: NEXT_PUBLIC_MUSHI_*". The stack
 * now comes from the repo's package.json files, with the slug as fallback.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import { requiredCiVarNames, resolveStack, stackFromPackageJsons } from '../../supabase/functions/_shared/sdk-diagnostics.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let compose: typeof import('../../supabase/functions/api/routes/recipe-compose.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  compose = await import('../../supabase/functions/api/routes/recipe-compose.ts')
})

const pkg = (deps: Record<string, string>, devDeps: Record<string, string> = {}) => JSON.stringify({ dependencies: deps, devDependencies: devDeps })

describe('stackFromPackageJsons', () => {
  it('reads Expo from an app folder even when the root only has Vite (yen-yen layout)', () => {
    const root = pkg({}, { vite: '^6' })
    const mobile = pkg({ expo: '~53', 'react-native': '0.79', '@mushi-mushi/react-native': '^0.24' })
    const web = pkg({ next: '15' })
    expect(stackFromPackageJsons([root, mobile, web])).toBe('expo')
  })

  it('prefers Next.js over Vite in the same file (a Next app with Vite for tests)', () => {
    expect(stackFromPackageJsons([pkg({ next: '15', '@mushi-mushi/web': '^1' }, { vite: '^6' })])).toBe('nextjs')
  })

  it('reads a Vite app, including a Capacitor shell over Vite', () => {
    expect(stackFromPackageJsons([pkg({ '@mushi-mushi/web': '^1' }, { vite: '^6' })])).toBe('vite')
    expect(stackFromPackageJsons([pkg({ '@capacitor/core': '7', '@mushi-mushi/web': '^1' }, { vite: '^6' })])).toBe('vite')
  })

  it('reads the files that use a Mushi SDK first', () => {
    const sdkApp = pkg({ '@mushi-mushi/web': '^1' }, { vite: '^6' })
    const otherApp = pkg({ expo: '~53' })
    expect(stackFromPackageJsons([otherApp, sdkApp])).toBe('vite')
  })

  it('is null when nothing names a known bundler or a file does not parse', () => {
    expect(stackFromPackageJsons([])).toBeNull()
    expect(stackFromPackageJsons(['{ not json', pkg({ express: '5' })])).toBeNull()
  })

  it('resolveStack falls back to the slug only when nothing was detected', () => {
    expect(resolveStack('glot-it', 'expo')).toBe('expo')
    expect(resolveStack('yen-yen', null)).toBe('expo')
    expect(resolveStack('help-her-take-photo', undefined)).toBe('nextjs')
  })
})

const NOW = new Date('2026-10-14T12:00:00Z')
const repo = { ref: { owner: 'kensaurus', repo: 'app' }, token: 't', repoUrl: 'https://github.com/kensaurus/app', defaultBranchHint: 'main' }
const EXPO_NAMES = requiredCiVarNames('expo').map((v) => v.name)
const VITE_NAMES = requiredCiVarNames('vite').map((v) => v.name)

function deps(names: string[], detectStack: () => Promise<'expo' | 'vite' | 'nextjs' | null>) {
  return {
    resolveRepo: vi.fn(async () => ({ ok: true as const, repo })),
    getDefaultHead: vi.fn(async () => ({ branch: 'main', sha: 'head1' })),
    fetchWorkflowRun: vi.fn(async () => ({ status: 'completed', conclusion: 'success', updatedAt: '2026-10-14T00:00:00Z', name: 'ci', htmlUrl: null })),
    listActionsNames: vi.fn(async () => names),
    requiredEnvNames: (slug: string | null, stack?: 'expo' | 'vite' | 'nextjs' | null) => requiredCiVarNames(resolveStack(slug, stack)).map((v) => v.name),
    detectStack: vi.fn(detectStack),
    now: () => NOW,
  }
}

function seed(pid: string, slug: string) {
  return makeFakeDb({
    projects: [{ id: pid, slug, organization_id: null }],
    project_settings: [{ project_id: pid }],
  })
}

describe('composeRecipe: env names follow the detected stack', () => {
  it('an Expo app with EXPO_PUBLIC_MUSHI_* set is ok, not "Missing NEXT_PUBLIC_MUSHI_*"', async () => {
    const pid = '30000001-0000-4000-8000-000000000001'
    const d = deps(EXPO_NAMES, async () => 'expo')
    const { response } = await compose.composeRecipe(seed(pid, 'help-her-take-photo') as never, d as never, pid)
    expect(d.detectStack).toHaveBeenCalledWith(repo)
    expect(response.elements.env.state).toBe('ok')
    expect(response.elements.env.reason).not.toContain('NEXT_PUBLIC_')
  })

  it('a Vite app missing its key names VITE_MUSHI_API_KEY', async () => {
    const pid = '30000001-0000-4000-8000-000000000002'
    const d = deps(VITE_NAMES.filter((n) => n !== 'VITE_MUSHI_API_KEY'), async () => 'vite')
    const { response } = await compose.composeRecipe(seed(pid, 'tsumagoi') as never, d as never, pid)
    expect(response.elements.env.state).toBe('drift')
    expect(response.elements.env.reason).toBe('Missing from GitHub: VITE_MUSHI_API_KEY. Add them as GitHub Actions secrets or variables.')
  })

  it('a failed package.json read falls back to the slug and does not fail the recipe', async () => {
    const pid = '30000001-0000-4000-8000-000000000003'
    const d = deps(EXPO_NAMES, async () => {
      throw new Error('GitHub answered 502')
    })
    const { response } = await compose.composeRecipe(seed(pid, 'yen-yen') as never, d as never, pid)
    expect(response.elements.env.state).toBe('ok')
  })

  it('reads the stack once, then reuses it; a failed read is tried again', async () => {
    const pid = '30000001-0000-4000-8000-000000000005'
    const first = deps(EXPO_NAMES, async () => 'expo')
    await compose.composeRecipe(seed(pid, 'app') as never, first as never, pid)
    const second = deps(EXPO_NAMES, async () => 'vite')
    const { response } = await compose.composeRecipe(seed(pid, 'app') as never, second as never, pid)
    expect(second.detectStack).not.toHaveBeenCalled()
    expect(response.elements.env.state).toBe('ok')

    const pid2 = '30000001-0000-4000-8000-000000000006'
    const failing = deps(EXPO_NAMES, async () => {
      throw new Error('GitHub answered 502')
    })
    await compose.composeRecipe(seed(pid2, 'app') as never, failing as never, pid2)
    const retry = deps(EXPO_NAMES, async () => 'expo')
    await compose.composeRecipe(seed(pid2, 'app') as never, retry as never, pid2)
    expect(retry.detectStack).toHaveBeenCalledTimes(1)
  })

  it('an unknown stack keeps the old Next.js default', async () => {
    const pid = '30000001-0000-4000-8000-000000000004'
    const d = deps([], async () => null)
    const { response } = await compose.composeRecipe(seed(pid, 'some-app') as never, d as never, pid)
    expect(response.elements.env.reason).toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID')
  })
})
