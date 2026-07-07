import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseArgs, FLAGS_HELP, MIN_NODE_MAJOR } from '@mushi-mushi/cli/wizard-args'

const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url))

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
  })

  it('advertises Node >= 20 in help', () => {
    const { stdout, status } = run(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Node.js 20 or newer')
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

  it('bails out in a non-interactive terminal without all required flags', () => {
    const { stderr, status } = run([])
    expect(status).toBe(1)
    expect(stderr).toContain('non-interactive terminal detected')
  })
})
