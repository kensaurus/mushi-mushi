/**
 * FILE: packages/cli/src/commands/widget.ts
 * PURPOSE: `mushi widget show|set`: the console's widget editor
 *          (GET|PUT /v1/admin/projects/:id/sdk-config) from the terminal.
 *          Installed SDKs read these settings at startup, so a change shows
 *          up without a redeploy. A value the app's own code sets in
 *          Mushi.init (or a data-* attribute) wins over the console
 *          (ADR 0068). Writes need a project owner or admin.
 */

import type { Command } from 'commander'
import { apiCall, die, outputIsJson, requireConfig } from '../cli-shared.js'
import { resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
const THEMES = ['auto', 'light', 'dark', 'inherit'] as const
const LAUNCHERS = ['auto', 'banner', 'edge-tab', 'attach', 'manual', 'hidden'] as const

interface SdkConfigReply {
  enabled?: boolean
  canEdit?: boolean
  widget?: Record<string, unknown>
}

interface WidgetView {
  position: string
  theme: string
  triggerText: string | null
  accent: string
  accentText: string | null
  launcher: string
}

function view(data: SdkConfigReply): WidgetView {
  const w = data.widget ?? {}
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  return {
    position: str(w.position) ?? 'bottom-right',
    theme: str(w.theme) ?? 'auto',
    triggerText: str(w.triggerText),
    accent: str(w.accent) ?? 'auto',
    accentText: str(w.accentText),
    launcher: str(w.launcher) ?? 'auto',
  }
}

function oneOf<T extends readonly string[]>(raw: string, allowed: T, flag: string): T[number] {
  const v = raw.trim().toLowerCase()
  if (!(allowed as readonly string[]).includes(v)) {
    throw new MushiCliError('E_INVALID_INPUT', `${flag} must be one of ${allowed.join(', ')}`)
  }
  return v as T[number]
}

/** `#3b5bdb`, `3b5bdb`, `#fa0` or `auto`; anything else is refused before the API call. */
function parseAccent(raw: string): string | null {
  const v = raw.trim()
  if (v === '' || v.toLowerCase() === 'auto') return null
  if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v.startsWith('#') ? v : `#${v}`
  throw new MushiCliError('E_INVALID_INPUT', '--accent must be a hex colour like #3b5bdb, or auto to match your site')
}

function renderWidget(data: SdkConfigReply): string[] {
  const w = view(data)
  const lines = [
    `Launcher:     ${w.launcher}`,
    `Position:     ${w.position}`,
    `Theme:        ${w.theme}`,
    `Trigger text: ${w.triggerText ?? '(default bug icon)'}`,
    `Accent:       ${w.accent === 'auto' ? 'auto (matches your site)' : `${w.accent}, text ${w.accentText === '#000000' ? 'black' : 'white'}`}`,
  ]
  if (data.enabled === false) lines.push('Runtime config is off: installed SDKs ignore these settings (turn it on in the console).')
  if (data.canEdit === false) lines.push('Read-only: only project owners and admins change these.')
  lines.push("If your app's code sets one of these in Mushi.init, your code's value wins.")
  return lines
}

export function registerWidgetCommands(program: Command): void {
  const widget = program
    .command('widget')
    .description('How the in-app bug widget looks: colour, corner, theme, label (applies without a redeploy)')

  widget
    .command('show')
    .description('Show the widget settings served to installed SDKs')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const pid = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<SdkConfigReply>(`/v1/admin/projects/${pid}/sdk-config`, config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ enabled: result.data.enabled !== false, canEdit: result.data.canEdit ?? null, widget: view(result.data) }, null, 2))
        return
      }
      for (const line of renderWidget(result.data)) console.log(line)
    })

  widget
    .command('set')
    .description('Change the widget look (project owners and admins)')
    .option('--accent <colour>', 'Brand colour as hex (#3b5bdb), or auto to match your site')
    .option('--position <corner>', POSITIONS.join(' | '))
    .option('--theme <theme>', THEMES.join(' | '))
    .option('--trigger-text <text>', 'Launcher label, up to 24 characters ("" restores the bug icon)')
    .option('--launcher <mode>', LAUNCHERS.join(' | '))
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { accent?: string; position?: string; theme?: string; triggerText?: string; launcher?: string; projectId?: string; json?: boolean }) => {
      const body: Record<string, unknown> = {}
      if (opts.accent !== undefined) body.accent = parseAccent(opts.accent)
      if (opts.position !== undefined) body.position = oneOf(opts.position, POSITIONS, '--position')
      if (opts.theme !== undefined) body.theme = oneOf(opts.theme, THEMES, '--theme')
      if (opts.launcher !== undefined) body.launcher = oneOf(opts.launcher, LAUNCHERS, '--launcher')
      if (opts.triggerText !== undefined) {
        if (opts.triggerText.length > 24) throw new MushiCliError('E_INVALID_INPUT', '--trigger-text must be 24 characters or fewer')
        body.triggerText = opts.triggerText.trim() ? opts.triggerText : null
      }
      if (Object.keys(body).length === 0) {
        throw new MushiCliError('E_INVALID_INPUT', 'Nothing to change: pass --accent, --position, --theme, --trigger-text or --launcher.')
      }
      const config = requireConfig()
      const pid = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<SdkConfigReply>(`/v1/admin/projects/${pid}/sdk-config`, config, {
        method: 'PUT',
        body: JSON.stringify({ widget: body }),
      })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ enabled: result.data.enabled !== false, widget: view(result.data) }, null, 2))
        return
      }
      console.log('Saved. Installed SDKs pick this up at their next start.')
      for (const line of renderWidget(result.data)) console.log(line)
    })
}
