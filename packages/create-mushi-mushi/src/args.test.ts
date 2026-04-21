import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

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
    expect(stdout).toContain('npm create')
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
