/**
 * Shared failed-fix preview builder for /projects and /dashboard stats.
 */

export interface FailedFixPreviewRow {
  id: string
  report_id: string
  error_head: string | null
  report_title: string | null
}

interface RawFailedFix {
  id: string
  project_id: string
  report_id: string
  error?: string | null
  finished_at?: string | null
  created_at?: string | null
}

export function bucketFailedFixPreviews(
  rows: RawFailedFix[],
  perProject = 3,
): Record<string, FailedFixPreviewRow[]> {
  const byProject: Record<string, RawFailedFix[]> = {}
  for (const row of rows) {
    if (!byProject[row.project_id]) byProject[row.project_id] = []
    byProject[row.project_id].push(row)
  }
  const out: Record<string, FailedFixPreviewRow[]> = {}
  for (const [pid, list] of Object.entries(byProject)) {
    list.sort((a, b) => {
      const ta = new Date(a.finished_at ?? a.created_at ?? 0).getTime()
      const tb = new Date(b.finished_at ?? b.created_at ?? 0).getTime()
      return tb - ta
    })
    out[pid] = list.slice(0, perProject).map((f) => ({
      id: f.id,
      report_id: f.report_id,
      error_head: f.error ? f.error.split('\n')[0].slice(0, 160) : null,
      report_title: null,
    }))
  }
  return out
}

export async function attachReportTitles(
  db: {
    from: (table: string) => {
      select: (cols: string) => {
        in: (col: string, ids: string[]) => PromiseLike<{ data: unknown[] | null }>
      }
    }
  },
  previews: FailedFixPreviewRow[],
): Promise<FailedFixPreviewRow[]> {
  const ids = [...new Set(previews.map((p) => p.report_id))]
  if (ids.length === 0) return previews
  const { data: titleRows } = await db
    .from('reports')
    .select('id, summary, description')
    .in('id', ids)
  const titleById: Record<string, string | null> = {}
  for (const r of titleRows ?? []) {
    const row = r as { id: string; summary?: string | null; description?: string | null }
    const summary = row.summary?.trim()
    const desc = row.description?.trim()
    titleById[row.id] =
      summary || (desc ? desc.slice(0, 80) + (desc.length > 80 ? '…' : '') : null)
  }
  return previews.map((p) => ({ ...p, report_title: titleById[p.report_id] ?? null }))
}
