import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
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

// Arg parsing now lives in the shared @mushi-mushi/cli/wizard-args module that
// both this shim and the mushi-mushi launcher import. Exercise it directly here.
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
    expect(stdout).toContain('add Mushi Mushi to your existing project')
    expect(stdout).toContain('does NOT scaffold a new app')
    expect(stdout).toContain('npm create')
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
})
