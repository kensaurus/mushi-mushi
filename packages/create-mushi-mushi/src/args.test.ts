import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { parseArgs, FLAGS_HELP, MIN_NODE_MAJOR } from '@mushi-mushi/cli/wizard-args'

const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url))

function run(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
  })
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  }
}

// create-mushi-mushi is an alias of npx mushi-mushi: everything runs in
// @mushi-mushi/cli/wizard-bin (ADR 0060 Phase 1b). These tests run the built
// bin to prove the alias forwards; the scaffold itself is unit-tested in
// packages/cli/src/template.test.ts.
describe('parseArgs (shared wizard-args)', () => {
  it('parses forwarded flags', () => {
    const parsed = parseArgs(['--project-id', 'p1', '--framework', 'react'])
    expect(parsed.projectId).toBe('p1')
    expect(parsed.framework).toBe('react')
  })

  it('throws on an unknown framework', () => {
    expect(() => parseArgs(['--framework', 'django'])).toThrow(/Unknown framework: django/)
  })

  it('advertises the minimum Node version in the shared flags help', () => {
    expect(MIN_NODE_MAJOR).toBe(20)
    expect(FLAGS_HELP).toContain('Requires Node.js 20 or newer.')
  })
})

describe('create-mushi-mushi', () => {
  it('prints a version with --version', () => {
    const { stdout, status } = run(['--version'])
    expect(status).toBe(0)
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('prints help with --help', () => {
    const { stdout, status } = run(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('same as npx mushi-mushi')
    expect(stdout).toContain('npm create mushi-mushi -- --template vue my-app')
    expect(stdout).toContain('--template <id> [dir]')
  })

  it('advertises Node >= 20 in help', () => {
    const { stdout, status } = run(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Node.js 20 or newer')
  })

  it('rejects an unknown framework', () => {
    const { stderr, status } = run(['--framework', 'django'])
    expect(status).toBe(1)
    expect(stderr).toContain('Unknown framework: django')
  })

  it('bails out in a non-interactive terminal', () => {
    const { stderr, status } = run([])
    expect(status).toBe(1)
    expect(stderr).toContain('non-interactive terminal detected')
  })

  it('forwards a `mushi` subcommand like npx mushi-mushi does', () => {
    const { stdout, stderr } = run(['setup', '--help'])
    expect(stdout + stderr).not.toContain('non-interactive terminal detected')
    expect(stdout).toContain('Wire the Mushi MCP server')
  })

  it('runs the wizard for a bare word that is not a command, after a --template hint', () => {
    // `npm create mushi-mushi my-app` ran the wizard before the alias change.
    // Non-interactive, the wizard bails out with its own message, which proves
    // it ran instead of Commander's "unknown command".
    const { stderr, status } = run(['my-app'])
    expect(status).toBe(1)
    expect(stderr).toContain('To start a new app instead: npx mushi-mushi --template <vue|svelte|node> my-app')
    expect(stderr).toContain('non-interactive terminal detected')
    expect(stderr).not.toContain('unknown command')
  })

  // One bin run per test: each run starts a probe and then the wizard, and two
  // runs in one test passed vitest's 5 s default on a loaded CI runner.
  it('prints the hint exactly once for a bare word', () => {
    expect(run(['my-app']).stderr.match(/To start a new app instead/g)).toHaveLength(1)
  })

  it('prints no hint for a real subcommand', () => {
    const sub = run(['setup', '--help'])
    expect(sub.stdout + sub.stderr).not.toContain('To start a new app instead')
    expect(sub.stdout).toContain('Wire the Mushi MCP server')
  })

  it('rejects an unknown template', () => {
    const { stderr, status } = run(['--template', 'django'])
    expect(status).toBe(1)
    expect(stderr).toContain('Unknown template: django')
    expect(stderr).toContain('vue, svelte, node')
  })

  it('scaffolds a starter with --template', () => {
    const target = mkdtempSync(join(tmpdir(), 'mushi-tpl-')) + '-app'
    try {
      const { stdout, status } = run(['--template', 'node', target])
      expect(status).toBe(0)
      expect(stdout).toContain('Scaffolded the node starter')
      expect(existsSync(join(target, 'package.json'))).toBe(true)
      expect(existsSync(join(target, 'src', 'server.mjs'))).toBe(true)
      expect(existsSync(join(target, '.env.example'))).toBe(true)
      expect(existsSync(join(target, 'gitignore'))).toBe(false)
      expect(readFileSync(join(target, '.gitignore'), 'utf-8')).toMatch(/^\.env$/m)
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })

  it('refuses to scaffold over an existing directory', () => {
    const target = mkdtempSync(join(tmpdir(), 'mushi-tpl-'))
    try {
      const { stderr, status } = run(['--template', 'vue', target])
      expect(status).toBe(1)
      expect(stderr).toContain('already exists')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  })
})
