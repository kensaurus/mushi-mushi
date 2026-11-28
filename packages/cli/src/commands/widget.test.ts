import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerWidgetCommands } from './widget.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const PATH = `/v1/admin/projects/${PID}/sdk-config`

describe('mushi widget show', () => {
  it('fills the defaults so unset reads as what the widget shows', async () => {
    const run = await runCli(registerWidgetCommands, ['widget', 'show'], () => okReply({ enabled: true, canEdit: true, widget: {} }))
    expect(run.calls[0]!.path).toBe(PATH)
    expect(run.stdout).toContain('Position:     bottom-right')
    expect(run.stdout).toContain('Accent:       auto (matches your site)')
    expect(run.stdout).toContain('(default bug icon)')
    expect(run.stdout).toContain("your code's value wins")
  })

  it('shows a console accent with its text colour, and a read-only note', async () => {
    const run = await runCli(registerWidgetCommands, ['widget', 'show'], () =>
      okReply({ enabled: true, canEdit: false, widget: { accent: '#3b5bdb', accentText: '#ffffff', theme: 'dark' } }),
    )
    expect(run.stdout).toContain('#3b5bdb, text white')
    expect(run.stdout).toContain('Theme:        dark')
    expect(run.stdout).toContain('Read-only')
  })
})

describe('mushi widget set', () => {
  it('PUTs only the flags given, under widget', async () => {
    const run = await runCli(
      registerWidgetCommands,
      ['widget', 'set', '--accent', '#3b5bdb', '--position', 'bottom-left', '--theme', 'dark', '--trigger-text', 'Report a bug'],
      () => okReply({ enabled: true, canEdit: true, widget: { accent: '#3b5bdb', accentText: '#ffffff', position: 'bottom-left', theme: 'dark', triggerText: 'Report a bug' } }),
    )
    expect(run.calls[0]).toMatchObject({
      method: 'PUT',
      path: PATH,
      body: { widget: { accent: '#3b5bdb', position: 'bottom-left', theme: 'dark', triggerText: 'Report a bug' } },
    })
    expect(run.stdout).toContain('Saved.')
    expect(run.stdout).toContain('Position:     bottom-left')
  })

  it('auto clears the accent and "" restores the default label', async () => {
    const run = await runCli(registerWidgetCommands, ['widget', 'set', '--accent', 'auto', '--trigger-text', ''], () => okReply({ widget: {} }))
    expect(run.calls[0]!.body).toEqual({ widget: { accent: null, triggerText: null } })
  })

  it('refuses bad values or no change before calling the API', async () => {
    for (const argv of [
      ['widget', 'set'],
      ['widget', 'set', '--accent', 'blue'],
      ['widget', 'set', '--position', 'middle'],
      ['widget', 'set', '--theme', 'neon'],
      ['widget', 'set', '--launcher', 'fab'],
      ['widget', 'set', '--trigger-text', 'x'.repeat(25)],
    ]) {
      const run = await runCli(registerWidgetCommands, argv)
      expect(run.calls, argv.join(' ')).toHaveLength(0)
      expect(run.error?.code, argv.join(' ')).toBe('E_INVALID_INPUT')
    }
  })

  it('shows the api refusal for a member key', async () => {
    const run = await runCli(registerWidgetCommands, ['widget', 'set', '--theme', 'light'], () =>
      errorReply(403, 'FORBIDDEN', 'Only project owners and admins can change the widget settings.'),
    )
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('owners and admins')
  })
})
