import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => [] as Array<{ cmd: string; argv: string[]; shell: unknown; env?: NodeJS.ProcessEnv }>)
const login = vi.hoisted(() => ({ config: {} as Record<string, string> }))
vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadConfig: () => login.config,
}))
vi.mock('node:child_process', () => ({
  spawn: (cmd: string, argv: string[], opts: { shell?: unknown; env?: NodeJS.ProcessEnv }) => {
    spawned.push({ cmd, argv, shell: opts.shell, env: opts.env })
    return { on: () => undefined }
  },
}))

import { registerUxCommands } from './ux.js'

async function run(args: string[]) {
  const program = new Command().exitOverride()
  registerUxCommands(program)
  await program.parseAsync(['node', 'mushi', 'ux', ...args])
  return spawned.at(-1)
}

afterEach(() => {
  spawned.length = 0
  delete process.env.MUSHI_UX_BIN
  login.config = {}
})

describe('mushi ux', () => {
  it('runs npm\'s npx-cli.js with the current Node and no shell, so arguments arrive intact', async () => {
    const call = await run(['run', '--dev', 'pnpm dev --port {port}', '--agent', 'cursor', '--model', 'grok-4.7?a=b&c=d'])
    // A shell (cmd.exe for the npx.cmd shim) would split "pnpm dev --port {port}"
    // and treat ^ & as operators; spawning node directly avoids it.
    expect(call?.shell).toBe(false)
    expect(call?.cmd).toBe(process.execPath)
    expect(call?.argv[0]).toMatch(/npx-cli\.js$/)
    expect(call?.argv.slice(1)).toEqual([
      '--yes',
      '--package',
      '@mushi-mushi/ux@^0.1.0',
      'mushi-ux',
      'run',
      '--dev',
      'pnpm dev --port {port}',
      '--agent',
      'cursor',
      '--model',
      'grok-4.7?a=b&c=d',
    ])
  })

  it('uses a local build when MUSHI_UX_BIN is set', async () => {
    process.env.MUSHI_UX_BIN = '/repo/packages/ux/dist/cli.js'
    const call = await run(['discover', '--url', 'http://localhost:5173'])
    expect(call).toMatchObject({
      cmd: process.execPath,
      argv: ['/repo/packages/ux/dist/cli.js', 'discover', '--url', 'http://localhost:5173'],
      shell: false,
    })
  })

  it('hands the studio the CLI login when there is one, and still opens it without', async () => {
    login.config = { apiKey: 'mushi_k', projectId: '542b34e0-019e-41fe-b900-7b637717bb86', endpoint: 'https://api.test' }
    const withLogin = await run(['ui'])
    expect(withLogin?.env).toMatchObject({ MUSHI_API_KEY: 'mushi_k', MUSHI_PROJECT_ID: '542b34e0-019e-41fe-b900-7b637717bb86', MUSHI_API_ENDPOINT: 'https://api.test' })
    login.config = {}
    const without = await run(['ui'])
    expect(without?.argv.slice(-1)).toEqual(['ui'])
    expect(without?.env?.MUSHI_PROJECT_ID).toBe(process.env.MUSHI_PROJECT_ID)
  })
})
