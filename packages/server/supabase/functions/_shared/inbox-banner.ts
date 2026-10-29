/**
 * FILE: packages/server/supabase/functions/_shared/inbox-banner.ts
 * PURPOSE: Subtitle for the /inbox status banner.
 *
 * The banner title counts every open stage (Plan, Do, Check, Act, Ops).
 * The first stage's hint used to be that subtitle, so "Read each diagnosis,
 * then dispatch a fix or close it as not a code bug" described failing
 * connections as well as unfixed reports.
 */

export interface InboxBannerFlag {
  stage: string
  hint: string
}

/** Act and Ops are connection health, not reports to dispatch or dismiss. */
const CONNECTION_STAGES = new Set(['act', 'ops'])

/**
 * Banner subtitle. A lone stage keeps its own hint. A mix of report work
 * and failing connections keeps the first hint, then says how many items
 * are connections so they are not closed as "not a code bug".
 */
export function inboxBannerLabel(flags: ReadonlyArray<InboxBannerFlag>): string | null {
  const top = flags[0]
  if (!top) return null
  const connections = flags.reduce((n, flag) => n + (CONNECTION_STAGES.has(flag.stage) ? 1 : 0), 0)
  if (connections === 0 || connections === flags.length) return top.hint
  const lead = /[.!?]$/.test(top.hint) ? top.hint : `${top.hint}.`
  const rest =
    connections === 1
      ? `1 of these ${flags.length} is a failing connection — reconnect it instead.`
      : `${connections} of these ${flags.length} are failing connections — reconnect them instead.`
  return `${lead} ${rest}`
}
