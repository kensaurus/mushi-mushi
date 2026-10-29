// SPDX-License-Identifier: MIT
/**
 * The terminal runner (ADR 0053): only the supplied values reach the shell,
 * every phase is timed, and a failing phase stops the run and says why,
 * without the key.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETUP_COMMAND, parseSetupEnv, runTerminalSetup, sampleHtml, setupArgv, setupEnv } from './fresh-eyes-terminal.js'
import type { RunResult } from './proc.js'

const values = { projectId: '9f0c2a1e-1111-2222-3333-444455556666', apiKey: 'mushi_sdk_abcdefghijklmnop12' }
const ok = (over: Partial<RunResult> = {}): RunResult => ({ exitCode: 0, timedOut: false, durationMs: 5, tail: '', stdout: '', ...over })

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'fresh-eyes-terminal-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('setupArgv', () => {
  it('fills the template as whole words', () => {
    expect(setupArgv(DEFAULT_SETUP_COMMAND, values)).toEqual({
      cmd: 'npx',
      args: ['--yes', 'mushi-mushi@latest', '--yes', '--project-id', values.projectId, '--api-key', values.apiKey],
    })
  })

  it('refuses values that could carry shell syntax', () => {
    expect(() => setupArgv(DEFAULT_SETUP_COMMAND, { ...values, projectId: 'x; rm -rf ~' })).toThrow(/UUID/)
    expect(() => setupArgv(DEFAULT_SETUP_COMMAND, { ...values, apiKey: 'abc & calc.exe & aaaaaaaaaa' })).toThrow(/characters/)
    expect(() => setupArgv('   ', values)).toThrow(/Empty/)
  })
})

describe('parseSetupEnv', () => {
  it('reads the values with any public prefix and ignores malformed ones', () => {
    expect(parseSetupEnv(`NEXT_PUBLIC_MUSHI_PROJECT_ID=${values.projectId}\nNEXT_PUBLIC_MUSHI_API_KEY="${values.apiKey}"`)).toEqual(values)
    expect(parseSetupEnv(`VITE_MUSHI_PROJECT_ID=${values.projectId}`)).toEqual({ projectId: values.projectId, apiKey: null })
    expect(parseSetupEnv('MUSHI_PROJECT_ID=not-a-uuid\nMUSHI_API_KEY=short')).toEqual({ projectId: null, apiKey: null })
  })
})

describe('sampleHtml', () => {
  it('carries the script tag with escaped attributes', () => {
    const html = sampleHtml({ ...values, endpoint: 'https://self.example/x"onload="alert(1)' })
    expect(html).toContain('mushi.loader.global.js')
    expect(html).toContain(`data-project="${values.projectId}"`)
    expect(html).not.toContain('"onload="')
  })
})

describe('setupEnv', () => {
  it('gives the setup its own home, so a wizard cannot replace the operator CLI login', () => {
    const env = setupEnv('/tmp/run/home', { HOME: '/home/op', XDG_CONFIG_HOME: '/home/op/.config', MUSHI_API_KEY: 'k', MUSHI_PROFILE: 'fresh-eyes', CURSOR_API_KEY: 'c', DBUS_SESSION_BUS_ADDRESS: 'unix:x', PATH: '/usr/bin' })
    expect(env.HOME).toBe('/tmp/run/home')
    expect(env.XDG_CONFIG_HOME).toBe(join('/tmp/run/home', '.config'))
    expect(env.MUSHI_API_KEY).toBeUndefined()
    expect(env.MUSHI_PROFILE).toBeUndefined()
    expect(env.CURSOR_API_KEY).toBeUndefined()
    // No session bus: the wizard cannot reach the operator's keychain either.
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.npm_config_cache).toBe(join('/home/op', '.npm'))
    expect(env.CI).toBe('1')
  })
})

describe('runTerminalSetup', () => {
  it('times every phase and sends the report', async () => {
    const dir = tmp()
    const calls: string[][] = []
    const res = await runTerminalSetup({
      ...values,
      dir,
      runCommand: async (cmd, args, cwd) => {
        calls.push([cmd, ...args])
        writeFileSync(join(cwd, '.env.local'), `NEXT_PUBLIC_MUSHI_PROJECT_ID=${values.projectId}\nNEXT_PUBLIC_MUSHI_API_KEY=${values.apiKey}\n`)
        return ok()
      },
      sendReport: async (url) => {
        const page = await (await fetch(url)).text()
        return page.includes(values.projectId) ? { ok: true, detail: 'sent' } : { ok: false, detail: 'no widget' }
      },
    })
    expect(res.ok).toBe(true)
    expect(res.failedAt).toBeNull()
    expect(res.phases.map((p) => p.name)).toEqual(['scaffold', 'setup', 'env', 'start', 'report'])
    expect(res.phases.every((p) => p.ok && p.ms >= 0)).toBe(true)
    expect(calls[0]![0]).toBe('npx')
    // The key never appears in a phase's text.
    expect(JSON.stringify(res.phases)).not.toContain(values.apiKey)
  })

  it('stops at setup when the command fails, and hides the key in its output', async () => {
    const res = await runTerminalSetup({ ...values, dir: tmp(), runCommand: async () => ok({ exitCode: 1, tail: `bad key ${values.apiKey}` }) })
    expect(res.ok).toBe(false)
    expect(res.failedAt).toBe('setup')
    expect(res.phases.at(-1)!.detail).toContain('exited 1')
    expect(res.phases.at(-1)!.detail).not.toContain(values.apiKey)
  })

  it('stops at env when the setup wrote nothing', async () => {
    const res = await runTerminalSetup({ ...values, dir: tmp(), runCommand: async () => ok() })
    expect(res.failedAt).toBe('env')
  })

  it('stops at report when the widget sends nothing, and closes the sample server', async () => {
    const res = await runTerminalSetup({
      ...values,
      dir: tmp(),
      runCommand: async (_c, _a, cwd) => {
        writeFileSync(join(cwd, '.env'), `MUSHI_PROJECT_ID=${values.projectId}\nMUSHI_API_KEY=${values.apiKey}\n`)
        return ok()
      },
      sendReport: async () => ({ ok: false, detail: 'The widget did not show a button to report a bug within 30 s.' }),
    })
    expect(res.failedAt).toBe('report')
    await expect(fetch(res.sampleUrl!)).rejects.toThrow()
  })

  it('refuses bad values before running anything', async () => {
    let ran = false
    const res = await runTerminalSetup({ ...values, projectId: '$(whoami)', dir: tmp(), runCommand: async () => ((ran = true), ok()) })
    expect(res.failedAt).toBe('setup')
    expect(ran).toBe(false)
  })
})
