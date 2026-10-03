/**
 * FILE: packages/cli/src/commands/outbox.ts
 * PURPOSE: `mushi outbox list|edit|release|discard` — the reporter outbox:
 *          status updates held for review before they reach the person who
 *          filed the report (/v1/admin/reporter-outbox*). Release and discard
 *          act on a real person's inbox, so both need --yes.
 */

import type { Command } from 'commander'
import { apiCall, die, fmtDate, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { oneLine, requireYes } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

/** Same cap as the server's BODY_OVERRIDE_MAX. */
const OUTBOX_TEXT_MAX = 1000

interface OutboxMessage {
  id: string
  project_id: string
  report_id: string | null
  report_title: string | null
  notification_type: string
  text: string
  body_override: string | null
  created_at: string
}

interface HeldActionData {
  delivered: number
  skipped: number
  duplicate: number
  failed: number
}

function validateOutboxText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > OUTBOX_TEXT_MAX) {
    throw new MushiCliError('E_INVALID_INPUT', `The message must be 1 to ${OUTBOX_TEXT_MAX} characters.`)
  }
  return trimmed
}

function renderOutbox(messages: OutboxMessage[]): string[] {
  if (messages.length === 0) return ['Nothing held. Every reporter update has gone out.']
  const lines = [`${messages.length} update(s) waiting for review:`]
  for (const m of messages) {
    lines.push(`  ${m.id}  ${m.notification_type}  ${fmtDate(m.created_at)}`)
    if (m.report_title) lines.push(`      report: ${oneLine(m.report_title, 90)}`)
    lines.push(`      sends:  ${oneLine(m.body_override ?? m.text, 200)}${m.body_override ? '  (edited)' : ''}`)
  }
  lines.push('Send one: mushi outbox release <id> --yes   ·   drop one: mushi outbox discard <id> --yes')
  return lines
}

function renderHeld(verb: string, d: HeldActionData): string {
  return `${verb}: delivered ${d.delivered}, skipped ${d.skipped}, duplicate ${d.duplicate}, failed ${d.failed}.`
}

export function registerOutboxCommands(program: Command): void {
  const outbox = program
    .command('outbox')
    .description('Reporter updates held for your review before they are sent')

  outbox
    .command('list')
    .description('Updates waiting for review, oldest first')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<{ messages: OutboxMessage[] }>('/v1/admin/reporter-outbox', config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderOutbox(result.data.messages)) console.log(line)
    })

  outbox
    .command('edit <messageId> <text>')
    .description('Reword a held update (it stays held)')
    .action(async (messageId: string, text: string) => {
      const id = requireUuid(messageId, 'message id')
      const body = validateOutboxText(text)
      const config = requireConfig()
      const result = await apiCall<{ id: string; body_override: string }>(
        `/v1/admin/reporter-outbox/${id}`,
        config,
        { method: 'PATCH', body: JSON.stringify({ body_override: body }) },
      )
      if (!result.ok) die(result)
      console.log(`Saved. Still held; send it with: mushi outbox release ${id} --yes`)
    })

  outbox
    .command('release <messageId>')
    .description('Send a held update to the reporter now')
    .option('--text <text>', 'Send this wording instead')
    .option('--yes', 'Confirm: the reporter receives it')
    .option('--json', 'Machine-readable JSON output')
    .action(async (messageId: string, opts: { text?: string; yes?: boolean; json?: boolean }) => {
      const id = requireUuid(messageId, 'message id')
      const override = opts.text !== undefined ? validateOutboxText(opts.text) : undefined
      requireYes(opts.yes, `Releasing ${id} sends it to the reporter.`)
      const config = requireConfig()
      const result = await apiCall<HeldActionData>(
        `/v1/admin/reporter-outbox/${id}/release`,
        config,
        { method: 'POST', body: JSON.stringify(override ? { body_override: override } : {}) },
      )
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(renderHeld('Released', result.data))
      if (result.data.failed > 0) process.exitCode = 1
    })

  outbox
    .command('discard <messageId>')
    .description('Drop a held update; the reporter never sees it')
    .option('--yes', 'Confirm the discard')
    .option('--json', 'Machine-readable JSON output')
    .action(async (messageId: string, opts: { yes?: boolean; json?: boolean }) => {
      const id = requireUuid(messageId, 'message id')
      requireYes(opts.yes, `Discarding ${id} means the reporter never gets this update.`)
      const config = requireConfig()
      const result = await apiCall<HeldActionData>(`/v1/admin/reporter-outbox/${id}/discard`, config, { method: 'POST', body: '{}' })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Discarded ${id}.`)
    })
}
