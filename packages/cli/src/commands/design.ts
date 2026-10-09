/**
 * FILE: packages/cli/src/commands/design.ts
 * PURPOSE: `mushi design settings|set` — console parity for "When the score
 *          is too high" on the Design system page
 *          (GET|PUT /v1/admin/projects/:id/design/settings): what the design
 *          deviance score may do on its own. An API key can turn the design
 *          auto-fix off but never on; that needs a signed-in owner or admin.
 */

import type { Command } from 'commander'
import { apiCall, die, outputIsJson, requireConfig } from '../cli-shared.js'
import { resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

interface DesignSettings {
  threshold: number
  failCi: boolean
  autofix: boolean
  autofixEnabled: boolean
  canEdit: boolean
}

function parseOnOff(raw: string, flag: string): boolean {
  const v = raw.trim().toLowerCase()
  if (v === 'on' || v === 'true' || v === 'yes') return true
  if (v === 'off' || v === 'false' || v === 'no') return false
  throw new MushiCliError('E_INVALID_INPUT', `${flag} must be on or off`)
}

function renderSettings(s: DesignSettings): string[] {
  const lines = [
    `Threshold: ${s.threshold} (the actions below fire when the design score is above it)`,
    `  Fail CI:  ${s.failCi ? 'on' : 'off'} (mushi recipe check --push exits non-zero above it)`,
    `  Auto-fix: ${s.autofix ? 'on' : 'off'}${s.autofix && !s.autofixEnabled ? ' (does nothing: the project auto-fix switch is off)' : ''}`,
  ]
  if (!s.canEdit) lines.push('Read-only: only project owners and admins change these.')
  return lines
}

export function registerDesignCommands(program: Command): void {
  const design = program
    .command('design')
    .description('What the design deviance score may do on its own: fail CI, dispatch a fix')

  design
    .command('settings')
    .description('Show the threshold and the actions above it')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const pid = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<DesignSettings>(`/v1/admin/projects/${pid}/design/settings`, config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderSettings(result.data)) console.log(line)
    })

  design
    .command('set')
    .description('Change the threshold, fail CI, or turn the design auto-fix off (project owners and admins)')
    .option('--threshold <n>', 'Score 0-100 above which the actions fire')
    .option('--fail-ci <state>', 'on | off')
    .option('--autofix <state>', 'off (turning it on needs the console)')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { threshold?: string; failCi?: string; autofix?: string; projectId?: string; json?: boolean }) => {
      const body: Record<string, unknown> = {}
      if (opts.threshold !== undefined) {
        const n = Number(opts.threshold)
        if (!Number.isInteger(n) || n < 0 || n > 100) throw new MushiCliError('E_INVALID_INPUT', '--threshold must be a whole number from 0 to 100')
        body.threshold = n
      }
      if (opts.failCi !== undefined) body.failCi = parseOnOff(opts.failCi, '--fail-ci')
      if (opts.autofix !== undefined) body.autofix = parseOnOff(opts.autofix, '--autofix')
      if (Object.keys(body).length === 0) throw new MushiCliError('E_INVALID_INPUT', 'Nothing to change: pass --threshold, --fail-ci or --autofix.')
      const config = requireConfig()
      const pid = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<DesignSettings>(`/v1/admin/projects/${pid}/design/settings`, config, { method: 'PUT', body: JSON.stringify(body) })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log('Saved.')
      for (const line of renderSettings(result.data)) console.log(line)
    })
}
