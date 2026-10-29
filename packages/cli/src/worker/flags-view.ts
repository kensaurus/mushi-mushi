/**
 * FILE: packages/cli/src/worker/flags-view.ts
 * PURPOSE: `mushi worker status` prints the same worker flags as the
 *          console's Workers tab (ADR 0048 amendment 2026-10-28): what is
 *          wrong, why, for how long, a stuck run's stage and last log lines,
 *          and what to do, worst first. The server derives them
 *          (`_shared/work-flags.ts`); the CLI only prints them.
 */

export interface WorkerFlagView {
  id: string
  kind: string
  severity: 'danger' | 'warn'
  hostname: string | null
  title: string
  cause: string
  sinceSec: number | null
  stage?: string | null
  log?: string[]
  actions: Array<{ kind: string; label: string; command?: string; claimId?: string; reportId?: string; prUrl?: string; to?: string; hostId?: string; laneId?: string }>
}

/** "under a minute", "12 min", "4 h 20 min", "3 d", as the console says it. */
function duration(sec: number): string {
  if (sec < 60) return 'under a minute'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return min % 60 && h < 10 ? `${h} h ${min % 60} min` : `${h} h`
  return `${Math.round(h / 24)} d`
}

/** What a console-only action becomes in a terminal. */
function actionLine(a: WorkerFlagView['actions'][number]): string | null {
  switch (a.kind) {
    case 'copy_command':
      return a.command ? `${a.label}: ${a.command}` : null
    case 'stop_run':
      return `${a.label}: in the console (Pipeline → Workers), claim ${a.claimId?.slice(0, 8) ?? ''}`
    case 'pause_lane':
      return `${a.label}: in the console (Pipeline → Workers)`
    case 'recheck_account':
      return `${a.label}: in the console (Pipeline → Workers), or run cursor-agent status on the machine`
    case 'switch_account':
      return `${a.label}: in the console (Pipeline → Workers → the machine → Switch account), or run cursor-agent login on the machine`
    case 'open_report':
      return a.reportId ? `${a.label}: mushi reports show ${a.reportId}` : null
    case 'open_pr':
      return a.prUrl ? `${a.label}: ${a.prUrl}` : null
    default:
      return null
  }
}

/** The flags as terminal lines; nothing when there are none. */
export function flagLines(flags: readonly WorkerFlagView[] | undefined): string[] {
  if (!flags || flags.length === 0) return []
  const danger = flags.filter((f) => f.severity === 'danger').length
  const out = [`${flags.length} problem${flags.length === 1 ? '' : 's'} with your local workers${danger ? `, ${danger} need${danger === 1 ? 's' : ''} you now` : ''} (worst first):`]
  for (const f of flags) {
    out.push(`  ${f.severity === 'danger' ? '!!' : ' !'} ${f.title}${f.sinceSec != null ? ` (for ${duration(f.sinceSec)})` : ''}`)
    out.push(`     ${f.cause}`)
    if (f.stage) out.push(`     stage: ${f.stage}`)
    for (const line of f.log ?? []) out.push(`     | ${line}`)
    for (const a of f.actions) {
      const line = actionLine(a)
      if (line) out.push(`     -> ${line}`)
    }
  }
  return out
}
