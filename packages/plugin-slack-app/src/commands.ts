/**
 * Wave G3 — `/mushi` slash command router.
 *
 * Slack's slash command flow:
 *   1. User types `/mushi list`; Slack POSTs application/x-www-form-urlencoded
 *      to our endpoint.
 *   2. We MUST respond within 3 seconds with HTTP 200, either with a public
 *      or ephemeral message. For longer work, send `response_type: 'ephemeral'`
 *      and defer to the `response_url`.
 *   3. For interactive buttons (transition/resolve), Slack sends a signed
 *      `payload=<url-encoded-json>` back to the same endpoint.
 */

export interface SlashCommandPayload {
  command: string
  text: string
  user_id: string
  channel_id: string
  team_id: string
  response_url: string
  trigger_id: string
}

export interface SlashCommandResponse {
  response_type?: 'in_channel' | 'ephemeral'
  text: string
  blocks?: unknown[]
}

type CommandHandler = (args: string[], payload: SlashCommandPayload) => Promise<SlashCommandResponse> | SlashCommandResponse

export interface RouterDeps {
  /** Inject a Mushi REST client for the team's OAuth-installed context. */
  listReports: (projectId: string, limit: number) => Promise<Array<{ id: string; title?: string; status: string; severity?: string }>>
  openReport: (reportId: string) => Promise<{ id: string; title?: string; status: string; summary?: string; url?: string }>
  transitionReport: (reportId: string, status: string) => Promise<void>
  /** Resolve Slack team → Mushi project id from the marketplace install record. */
  projectIdForTeam: (teamId: string) => Promise<string>
}

export function buildSlashRouter(deps: RouterDeps): (payload: SlashCommandPayload) => Promise<SlashCommandResponse> {
  const handlers: Record<string, CommandHandler> = {
    list: async (_args, payload) => {
      const projectId = await deps.projectIdForTeam(payload.team_id)
      const reports = await deps.listReports(projectId, 5)
      if (reports.length === 0) return { response_type: 'ephemeral', text: 'No recent reports.' }
      const lines = reports.map(r => `• *${r.severity ?? '?'}* [${r.status}] ${r.title ?? r.id.slice(0, 8)}`).join('\n')
      return { response_type: 'ephemeral', text: `Latest Mushi reports:\n${lines}` }
    },
    open: async (args) => {
      const reportId = args[0]
      if (!reportId) return { response_type: 'ephemeral', text: 'Usage: /mushi open <report-id>' }
      const r = await deps.openReport(reportId)
      const body = `*${r.title ?? r.id}* — [${r.status}]\n${r.summary ?? '(no summary yet)'}` + (r.url ? `\n${r.url}` : '')
      return { response_type: 'ephemeral', text: body }
    },
    resolve: async (args) => {
      const reportId = args[0]
      if (!reportId) return { response_type: 'ephemeral', text: 'Usage: /mushi resolve <report-id>' }
      await deps.transitionReport(reportId, 'fixed')
      return { response_type: 'ephemeral', text: `Marked ${reportId} as fixed.` }
    },
    help: async () => ({
      response_type: 'ephemeral',
      text: 'Usage:\n• `/mushi list` — latest reports\n• `/mushi open <id>` — report detail\n• `/mushi resolve <id>` — transition to fixed',
    }),
  }

  return async (payload) => {
    const parts = payload.text.trim().split(/\s+/).filter(Boolean)
    const sub = (parts[0] ?? 'help').toLowerCase()
    const handler = handlers[sub] ?? handlers.help
    try {
      return await handler(parts.slice(1), payload)
    } catch (err) {
      return { response_type: 'ephemeral', text: `Command failed: ${(err as Error).message}` }
    }
  }
}
