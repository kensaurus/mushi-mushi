// First-run frictions measured on 2026-11-18: the false "newer version"
// warning, no snippet under --yes, the MCP editor key, --dry-run, and the
// sample-bug step.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { peekConfig } from './config.js'
import { FRAMEWORK_IDS, FRAMEWORKS } from './detect.js'
import type { checkFreshness } from './freshness.js'
import {
  applySnippetPlan,
  CLI_FRESHNESS_SOURCE,
  freshnessHint,
  needsEditorKey,
  planInitDryRun,
  planSnippetInjection,
  sampleBugSnippet,
  snippetTarget,
  type DryRunInput,
} from './init.js'
import { editorKeyCommand } from './key-scopes.js'
import { FLAGS_HELP, parseArgs } from './wizard-args.js'
import { wizardUpgradeCommand } from './wizard-bin.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mushi-first-run-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function snapshotDir(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(join(d, e.name), r)
      else out[r] = readFileSync(join(d, e.name), 'utf8')
    }
  }
  walk(root, '')
  return out
}

describe('freshness hint compares like with like (finding 1)', () => {
  const fake = (latest: string): typeof checkFreshness =>
    vi.fn(async (_pkg: string, current: string) => ({
      current,
      latest,
      isOutdated: latest !== current && latest > current,
    }))

  it('the launcher on its own latest version prints nothing', async () => {
    const check = fake('1.37.0')
    const hint = await freshnessHint(
      { packageName: 'mushi-mushi', version: '1.37.0', upgradeCommand: 'npx mushi-mushi@latest' },
      check,
    )
    expect(hint).toBeNull()
    expect(check).toHaveBeenCalledWith('mushi-mushi', '1.37.0')
  })

  it('an old launcher names its own package and the upgrade command', async () => {
    const hint = await freshnessHint(
      { packageName: 'mushi-mushi', version: '1.36.0', upgradeCommand: 'npx mushi-mushi@latest' },
      fake('1.37.0'),
    )
    expect(hint).toContain('mushi-mushi is available: 1.36.0 → 1.37.0')
    expect(hint).toContain('npx mushi-mushi@latest')
  })

  it('mushi init checks the CLI against the CLI, not the launcher', () => {
    expect(CLI_FRESHNESS_SOURCE.packageName).toBe('@mushi-mushi/cli')
  })

  it('a dev build never asks the registry', async () => {
    const check = fake('9.9.9')
    expect(await freshnessHint({ packageName: 'mushi-mushi', version: '0.0.0-dev', upgradeCommand: 'x' }, check)).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('queries the registry for the package it was given (real checkFreshness)', async () => {
    vi.stubEnv('MUSHI_NO_UPDATE_CHECK', '')
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ version: '1.37.0' }), { status: 200 })
    }))
    const hint = await freshnessHint({ packageName: 'mushi-mushi', version: '1.37.0', upgradeCommand: 'npx mushi-mushi@latest' })
    expect(hint).toBeNull()
    expect(urls).toEqual(['https://registry.npmjs.org/mushi-mushi/latest'])
  })

  it('each bin gets its own upgrade command', () => {
    expect(wizardUpgradeCommand('mushi-mushi')).toBe('npx mushi-mushi@latest')
    expect(wizardUpgradeCommand('create-mushi-mushi')).toBe('npm create mushi-mushi@latest')
  })
})

describe('snippet injection under --yes (finding 2)', () => {
  const vanilla = FRAMEWORKS.vanilla
  const never = async () => {
    throw new Error('--yes must not ask')
  }

  it('--yes adds the block to the entry file without asking, and a re-run changes nothing', async () => {
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/main.ts'), "console.log('app')\n")

    const first = await planSnippetInjection(dir, vanilla)
    expect(first).toMatchObject({ kind: 'inject', file: 'src/main.ts', alreadyInjected: false, unchanged: false })
    expect(await applySnippetPlan(first, { yes: true, confirm: never })).toEqual({ kind: 'written', file: 'src/main.ts' })
    const afterFirst = readFileSync(join(dir, 'src/main.ts'), 'utf8')
    expect(afterFirst).toContain('// <mushi-mushi:init>')
    expect(afterFirst).toContain("console.log('app')")

    const second = await planSnippetInjection(dir, vanilla)
    expect(second).toMatchObject({ kind: 'inject', alreadyInjected: true, unchanged: true })
    await applySnippetPlan(second, { yes: true, confirm: never })
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toBe(afterFirst)
  })

  it('interactive runs still ask, and a "no" writes nothing', async () => {
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/main.ts'), 'x\n')
    const plan = await planSnippetInjection(dir, vanilla)
    const confirm = vi.fn(async () => false)
    expect(await applySnippetPlan(plan, { yes: false, confirm })).toEqual({ kind: 'manual', target: 'src/main.ts' })
    expect(confirm).toHaveBeenCalledOnce()
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toBe('x\n')
  })

  it('JSX-provider frameworks are never edited; the plan names the file to paste into', async () => {
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/main.tsx'), 'render()\n')
    const plan = await planSnippetInjection(dir, FRAMEWORKS.react)
    expect(plan).toEqual({ kind: 'manual', target: 'src/main.tsx' })
    expect(await applySnippetPlan(plan, { yes: true, confirm: never })).toEqual(plan)
    expect(readFileSync(join(dir, 'src/main.tsx'), 'utf8')).toBe('render()\n')
  })

  it('no entry file found: manual, with the target from the snippet', async () => {
    expect(await planSnippetInjection(dir, vanilla)).toEqual({ kind: 'manual', target: snippetTarget(vanilla) })
    expect(snippetTarget(FRAMEWORKS.next)).toMatch(/^app\/providers\.tsx/)
    for (const id of FRAMEWORK_IDS) expect(snippetTarget(FRAMEWORKS[id]).length).toBeGreaterThan(0)
  })
})

describe('editor (MCP) key (finding 3)', () => {
  it('a run that only got the ingest key needs the editor key', () => {
    expect(needsEditorKey({ apiKey: 'sdk' }, { projectId: 'p', sdkKey: 'sdk' })).toBe(true)
    expect(needsEditorKey({}, { projectId: 'p', sdkKey: 'sdk' })).toBe(true)
  })

  it('browser sign-in (cliKey minted) or a kept login key does not', () => {
    expect(needsEditorKey({ apiKey: 'cli' }, { projectId: 'p', sdkKey: 'sdk', cliKey: 'cli' })).toBe(false)
    expect(needsEditorKey({ apiKey: 'older-login-key' }, { projectId: 'p', sdkKey: 'sdk' })).toBe(false)
  })

  it('the fix is one copy-paste command for the project', () => {
    expect(editorKeyCommand('proj-1')).toBe('npx mushi-mushi login --project-id proj-1')
    expect(editorKeyCommand()).toBe('npx mushi-mushi login')
  })
})

describe('--dry-run (finding 4)', () => {
  it('parses and is in the help', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true)
    expect(parseArgs(['init', '--dry-run', '--yes'])).toMatchObject({ dryRun: true, yes: true })
    expect(FLAGS_HELP).toContain('--dry-run')
  })

  function input(over: Partial<DryRunInput> = {}): DryRunInput {
    return {
      cwd: dir,
      framework: FRAMEWORKS.react,
      frameworkSource: 'detected',
      pm: 'pnpm',
      hasPackageJson: true,
      endpoint: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
      options: {},
      saved: { hasKey: false },
      snippet: { kind: 'manual', target: 'src/main.tsx' },
      ...over,
    }
  }

  it('lists the install, env var names, snippet target and sign-in, and writes nothing', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '19' } }))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/main.ts'), 'x\n')
    const before = snapshotDir(dir)

    const snippet = await planSnippetInjection(dir, FRAMEWORKS.vanilla)
    const lines = planInitDryRun(input({ snippet, framework: FRAMEWORKS.vanilla }))
    const text = lines.join('\n')
    expect(text).toContain('Install: pnpm add mushi-mushi')
    expect(text).toContain('VITE_MUSHI_PROJECT_ID')
    expect(text).toContain('.env.local')
    expect(text).toContain('add the init block in src/main.ts')
    expect(text).toContain('browser sign-in')
    expect(text).not.toMatch(/<key>|<id>/)

    expect(snapshotDir(dir)).toEqual(before)
  })

  it('reads the saved config without touching it (peekConfig)', () => {
    vi.stubEnv('MUSHI_API_KEY', '')
    vi.stubEnv('MUSHI_PROJECT_ID', '')
    vi.stubEnv('MUSHI_PROFILE', undefined)
    vi.stubEnv('MUSHI_API_ENDPOINT', '')
    vi.stubEnv('MUSHI_ENDPOINT', '')
    const path = join(dir, 'config.json')
    const raw = JSON.stringify({ projectId: 'p-1', apiKey: 'k' })
    writeFileSync(path, raw)
    expect(peekConfig(path)).toMatchObject({ projectId: 'p-1', apiKey: 'k' })
    expect(readFileSync(path, 'utf8')).toBe(raw)
    expect(peekConfig(join(dir, 'missing.json'))).toEqual({})
    expect(readdirSync(dir)).toEqual(['config.json'])
  })

  it('says it would reuse a saved sign-in, update existing vars, and honours the skip flags', () => {
    writeFileSync(join(dir, '.env.local'), 'VITE_MUSHI_PROJECT_ID=old\n')
    const text = planInitDryRun(
      input({
        saved: { projectId: 'abcdef12-0000-0000-0000-000000000000', hasKey: true },
        options: { skipInstall: true, sendTestReport: false },
      }),
    ).join('\n')
    expect(text).toContain('reuse your saved sign-in (project abcdef12…)')
    expect(text).toContain('update the MUSHI_* lines in .env.local')
    expect(text).toContain('skipped (--skip-install)')
    expect(text).not.toContain('Test report')
  })
})

describe('sample bug from the app (finding 6)', () => {
  it('every framework has a snippet that sends a real report', () => {
    for (const id of FRAMEWORK_IDS) {
      const s = sampleBugSnippet(id)
      expect(s, id).toMatch(/captureException|submitReport|Mushi\.report/)
      expect(s, id).not.toContain('window.Mushi')
    }
  })

  it('uses the API each framework snippet sets up', () => {
    expect(sampleBugSnippet('react')).toContain("import { Mushi } from 'mushi-mushi'")
    expect(sampleBugSnippet('express')).toContain('mushi.captureException')
    expect(sampleBugSnippet('expo')).toContain('@mushi-mushi/react-native')
    expect(sampleBugSnippet('capacitor')).toContain('@mushi-mushi/capacitor')
  })
})
