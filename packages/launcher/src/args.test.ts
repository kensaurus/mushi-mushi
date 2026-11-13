import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { parseArgs, FLAGS_HELP, MIN_NODE_MAJOR } from '@mushi-mushi/cli/wizard-args'

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url))

function run(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf-8',
    // force non-TTY so the wizard won't actually hang
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
  })
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  }
}

// Arg parsing now lives in the shared @mushi-mushi/cli/wizard-args module that
// both this launcher and create-mushi-mushi import. Exercise it directly here.
describe('parseArgs (shared wizard-args)', () => {
  it('parses forwarded flags', () => {
    const parsed = parseArgs(['--project-id', 'p1', '--api-key', 'k1', '--yes', '--skip-install'])
    expect(parsed.projectId).toBe('p1')
    expect(parsed.apiKey).toBe('k1')
    expect(parsed.yes).toBe(true)
    expect(parsed.skipInstall).toBe(true)
  })

  it('tolerates a leading `init` token', () => {
    const parsed = parseArgs(['init', '--yes'])
    expect(parsed.yes).toBe(true)
  })

  it('parses --audit and advertises it in the shared help', () => {
    expect(parseArgs(['--audit']).audit).toBe(true)
    expect(FLAGS_HELP).toContain('--audit')
  })

  it('throws on an unknown framework', () => {
    expect(() => parseArgs(['--framework', 'rails'])).toThrow(/Unknown framework: rails/)
  })

  it('throws on an unknown flag', () => {
    expect(() => parseArgs(['--garbage'])).toThrow(/Unknown flag/)
  })

  it('advertises the minimum Node version in the shared flags help', () => {
    expect(MIN_NODE_MAJOR).toBe(20)
    expect(FLAGS_HELP).toContain('Requires Node.js 20 or newer.')
  })
})

describe('mushi-mushi launcher', () => {
  it('prints a version with --version', () => {
    const { stdout, status } = run(['--version'])
    expect(status).toBe(0)
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('prints help with --help', () => {
    const { stdout, status } = run(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('bug-reporting SDK launcher')
    expect(stdout).toContain('--framework')
    expect(stdout).toContain('--skip-test-report')
    expect(stdout).toContain('npx mushi-mushi --template vue my-app')
  })

  it('scaffolds a starter with --template, the same as npm create mushi-mushi', () => {
    const target = mkdtempSync(join(tmpdir(), 'mushi-tpl-')) + '-app'
    try {
      const { stdout, status } = run(['--template', 'node', target])
      expect(status).toBe(0)
      expect(stdout).toContain('Scaffolded the node starter')
      expect(existsSync(join(target, 'src', 'server.mjs'))).toBe(true)
      expect(existsSync(join(target, '.gitignore'))).toBe(true)
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
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
  })

  it('advertises Node >= 20 in help', () => {
    const { stdout, status } = run(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Node.js 20 or newer')
  })

  it('prints the Docs/Console footer exactly once, pointing Docs at the docs site', () => {
    const { stdout, status } = run(['--help'])
    expect(status).toBe(0)
    expect(stdout.match(/^Docs:/gm)).toHaveLength(1)
    expect(stdout.match(/^Console:/gm)).toHaveLength(1)
    expect(stdout).toContain('Docs:    https://kensaur.us/mushi-mushi/docs/')
  })

  it('rejects an unknown framework with a useful message', () => {
    const { stderr, status } = run(['--framework', 'rails'])
    expect(status).toBe(1)
    expect(stderr).toContain('Unknown framework: rails')
  })

  it('rejects an unknown flag', () => {
    const { stderr, status } = run(['--garbage'])
    expect(status).toBe(1)
    expect(stderr).toContain('Unknown flag')
  })

  it('bails out in a non-interactive terminal without --yes, naming --yes as the way through', () => {
    const { stderr, status } = run([])
    expect(status).toBe(1)
    expect(stderr).toContain('non-interactive terminal detected')
    expect(stderr).toContain('npx mushi-mushi --yes')
  })

  // Uses `--help` rather than `--dry-run` so this never reaches the real
  // setup action (network calls, device-auth) — it only needs to prove the
  // launcher forwards to @mushi-mushi/cli's `setup` command instead of
  // crashing on `--ide` or falling through to `init`.
  it('forwards `setup --ide cursor` to @mushi-mushi/cli instead of crashing on --ide', () => {
    const { stdout, stderr } = run(['setup', '--ide', 'cursor', '--help'])
    expect(stderr).not.toContain('Unknown flag')
    expect(stdout + stderr).not.toContain('non-interactive terminal detected')
    expect(stdout).toContain('Wire the Mushi MCP server')
  })

  it('forwards a bare `setup` instead of silently running the init wizard', () => {
    const { stdout, stderr } = run(['setup', '--help'])
    expect(stdout + stderr).not.toContain('non-interactive terminal detected')
    expect(stdout).toContain('Wire the Mushi MCP server')
  })
})
