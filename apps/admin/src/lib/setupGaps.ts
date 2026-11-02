/**
 * FILE: apps/admin/src/lib/setupGaps.ts
 * PURPOSE: The shape of GET /v1/admin/setup-gaps (server:
 *          _shared/setup-gaps.ts) and the one sentence the Set up page leads
 *          its "Setup gaps" section with. A check Mushi could not read is
 *          never counted as fine: while any line is `unknown`, the sentence
 *          says so instead of "nothing missing".
 */

type SetupGapStatus = 'ok' | 'gap' | 'unknown'

export interface SetupGap {
  id: string
  projectId: string | null
  audience: 'app_owner' | 'platform'
  status: SetupGapStatus
  title: string
  summary: string
  fixHref: string
}

interface ProjectSetupGaps {
  projectId: string
  name: string
  checkedAt: string
  gaps: SetupGap[]
}

export interface SetupGapsResponse {
  generatedAt: string
  projects: ProjectSetupGaps[]
  counts: Record<SetupGapStatus, number>
  truncated: boolean
}

function countGaps(gaps: SetupGap[]): Record<SetupGapStatus, number> {
  const out: Record<SetupGapStatus, number> = { ok: 0, gap: 0, unknown: 0 }
  for (const g of gaps) out[g.status]++
  return out
}

/** How the app's setup stands, in one sentence, and the tone of its dot. */
export function setupGapsSentence(gaps: SetupGap[]): { sentence: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  const c = countGaps(gaps)
  const things = (n: number) => `${n} thing${n === 1 ? '' : 's'}`
  if (gaps.length === 0) return { sentence: 'Mushi has nothing to check for this app yet.', tone: 'neutral' }
  if (c.gap > 0) {
    return {
      sentence: `${things(c.gap)} to fix before ${c.gap === 1 ? 'it breaks' : 'they break'} a fix or a reply.${c.unknown ? ` Mushi could not check ${things(c.unknown)} more.` : ''}`,
      tone: 'danger',
    }
  }
  if (c.unknown > 0) return { sentence: `Nothing missing found, but Mushi could not check ${things(c.unknown)}.`, tone: 'warn' }
  return { sentence: `All ${c.ok} checks pass.`, tone: 'ok' }
}

/** Console paths open in the app; anything else (docs) opens in a new tab. */
export function isConsolePath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}
