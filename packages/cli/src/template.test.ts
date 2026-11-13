import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEMPLATE_IDS, scaffoldTemplate } from './template'
import { FLAGS_HELP, isUnknownTopLevelCommand, newAppHint, parseArgs } from './wizard-args'

// `--template` moved here from create-mushi-mushi (ADR 0060 Phase 1b), so
// `npx mushi-mushi --template vue my-app` and `npm create mushi-mushi` share it.

describe('parseArgs --template', () => {
  it('reads the template id and an optional directory', () => {
    expect(parseArgs(['--template', 'vue', 'my-app'])).toMatchObject({ template: 'vue', templateDir: 'my-app' })
    expect(parseArgs(['--template', 'node']).templateDir).toBeUndefined()
  })

  it('does not take a following flag as the directory', () => {
    const parsed = parseArgs(['--template', 'svelte', '--yes'])
    expect(parsed).toMatchObject({ template: 'svelte', yes: true })
    expect(parsed.templateDir).toBeUndefined()
  })

  it('rejects an unknown or missing template, naming the valid ones', () => {
    expect(() => parseArgs(['--template', 'django'])).toThrow('Unknown template: django. Valid: vue, svelte, node')
    expect(() => parseArgs(['--template'])).toThrow('Unknown template: (missing)')
  })

  it('is in the shared flags help', () => {
    expect(FLAGS_HELP).toContain('--template <id> [dir]')
  })
})

describe('bare word that is not a command', () => {
  const commands = [
    { name: () => 'setup', aliases: () => [] as string[] },
    { name: () => 'reports', aliases: () => ['r'] },
  ]

  it('is unknown unless it names a command or an alias', () => {
    expect(isUnknownTopLevelCommand('my-app', commands)).toBe(true)
    expect(isUnknownTopLevelCommand('setup', commands)).toBe(false)
    expect(isUnknownTopLevelCommand('r', commands)).toBe(false)
  })

  it('never treats flags, help or nothing as unknown', () => {
    expect(isUnknownTopLevelCommand(undefined, commands)).toBe(false)
    expect(isUnknownTopLevelCommand('--yes', commands)).toBe(false)
    expect(isUnknownTopLevelCommand('help', commands)).toBe(false)
  })

  it('words the hint around the starter flag and the typed name', () => {
    expect(newAppHint('my-app')).toBe(
      'To start a new app instead: npx mushi-mushi --template <vue|svelte|node> my-app',
    )
  })
})

describe('scaffoldTemplate', () => {
  it('ships a folder with a gitignore for every template id', () => {
    for (const id of TEMPLATE_IDS) {
      const dir = fileURLToPath(new URL(`../templates/${id}`, import.meta.url))
      expect(readdirSync(dir)).toEqual(expect.arrayContaining(['package.json', 'gitignore', '.env.example']))
    }
  })

  it('installs the one package and imports its subpaths, never the scoped SDKs', () => {
    const subpath = { vue: 'mushi-mushi/vue', svelte: 'mushi-mushi/svelte', node: 'mushi-mushi/node' } as const
    const entry = { vue: 'src/main.ts', svelte: 'src/main.ts', node: 'src/server.mjs' } as const
    for (const id of TEMPLATE_IDS) {
      const dir = fileURLToPath(new URL(`../templates/${id}`, import.meta.url))
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { dependencies: Record<string, string> }
      expect(pkg.dependencies['mushi-mushi']).toMatch(/^\^1\.\d+\.\d+$/)
      expect(Object.keys(pkg.dependencies).filter((d) => d.startsWith('@mushi-mushi/'))).toEqual([])
      const source = readFileSync(join(dir, entry[id]), 'utf-8')
      expect(source).toContain(`from '${subpath[id]}'`)
      expect(source).not.toContain('@mushi-mushi/')
    }
  })

  it('copies the starter and restores .gitignore', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mushi-tpl-'))
    try {
      const message = scaffoldTemplate('node', 'app', cwd)
      const target = join(cwd, 'app')
      expect(message).toContain('Scaffolded the node starter')
      expect(message).toContain('npm start')
      expect(existsSync(join(target, 'package.json'))).toBe(true)
      expect(existsSync(join(target, 'src', 'server.mjs'))).toBe(true)
      expect(existsSync(join(target, '.env.example'))).toBe(true)
      expect(existsSync(join(target, 'gitignore'))).toBe(false)
      expect(readFileSync(join(target, '.gitignore'), 'utf-8')).toMatch(/^\.env$/m)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('defaults the directory to mushi-<id>-app', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mushi-tpl-'))
    try {
      expect(scaffoldTemplate('vue', undefined, cwd)).toContain('npm run dev')
      expect(existsSync(join(cwd, 'mushi-vue-app', 'src', 'main.ts'))).toBe(true)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('refuses to scaffold over an existing directory', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mushi-tpl-'))
    try {
      expect(() => scaffoldTemplate('svelte', '.', cwd)).toThrow('target directory already exists')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
