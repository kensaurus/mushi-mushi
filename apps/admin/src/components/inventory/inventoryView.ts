/**
 * FILE: apps/admin/src/components/inventory/inventoryView.ts
 * PURPOSE: Pure helpers for /inventory (User stories), round 2 (2026-11-18):
 *          - discoverySnippet: the one install snippet, the same package as Manage apps
 *            (`mushi-mushi`, not the old `@mushi-mushi/web`)
 *          - codeCheckGroups: Code checks findings worst first, one group per check
 *          - gateStatusLine: which inventory checks ran, in one line instead of five tiles
 */

/** The discovery switch on the current SDK package; the React provider takes the same block. */
export function discoverySnippet(projectId: string): string {
  return `import { Mushi } from 'mushi-mushi'

Mushi.init({
  projectId: '${projectId}',
  apiKey: 'mushi_<your-report-write-key>',
  capture: {
    discoverInventory: {
      enabled: true,
      // Optional: your framework's route templates, so
      // /practice/abc-123 counts as /practice/[id].
      routeTemplates: ['/practice/[id]', '/lessons/[lessonId]'],
    },
  },
})

// Using <MushiProvider> from 'mushi-mushi/react'? Put the same
// capture block in its config.`
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, error: 0, high: 0, warn: 1, warning: 1, medium: 1, info: 2, low: 2 }

function rank(severity: string | undefined): number {
  return SEVERITY_RANK[(severity ?? 'info').toLowerCase()] ?? 2
}

export interface CodeCheckGroup<F> {
  gate: string
  /** The worst severity rank in the group (0 = error). */
  worst: number
  findings: F[]
}

/**
 * Findings grouped by the check that raised them, worst group first and worst finding first
 * inside it (2026-11-18: WARN led ERROR, and every card repeated its check's name).
 */
export function codeCheckGroups<F extends { severity?: string; gate?: string }>(findings: readonly F[]): CodeCheckGroup<F>[] {
  const by = new Map<string, F[]>()
  for (const f of findings) {
    const g = f.gate ?? 'other'
    by.set(g, [...(by.get(g) ?? []), f])
  }
  return [...by]
    .map(([gate, list]) => {
      const sorted = list.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f.severity) - rank(b.f.severity) || a.i - b.i).map((x) => x.f)
      return { gate, worst: rank(sorted[0]?.severity), findings: sorted }
    })
    .sort((a, b) => a.worst - b.worst || b.findings.length - a.findings.length)
}

/**
 * The inventory checks in one line: the ones that never ran are named once ("Not run yet: Dead
 * handlers, …"), the ones that ran say their result. Five tiles of "Not run yet · 0 open findings"
 * sat above a list of findings from other checks (2026-11-18).
 */
export function gateStatusLine(
  gates: readonly string[],
  latest: (gate: string) => { word: string; open: number } | null,
  label: (gate: string) => string,
): { ran: Array<{ gate: string; text: string }>; notRun: string[] } {
  const ran: Array<{ gate: string; text: string }> = []
  const notRun: string[] = []
  for (const g of gates) {
    const l = latest(g)
    if (!l) notRun.push(label(g))
    else ran.push({ gate: g, text: `${label(g)}: ${l.word}${l.open > 0 ? `, ${l.open} open` : ''}` })
  }
  return { ran, notRun }
}
