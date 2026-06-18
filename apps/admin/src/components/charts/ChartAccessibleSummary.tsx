/**
 * FILE: ChartAccessibleSummary.tsx
 * PURPOSE: Screen-reader table alternative for sparklines and small charts (WCAG).
 */

export interface ChartAccessibleColumn {
  key: string
  label: string
}

export interface ChartAccessibleSummaryProps {
  caption: string
  columns: ChartAccessibleColumn[]
  rows: Array<Record<string, string | number>>
}

/** Hidden data table for assistive tech — pair with role="img" on the visual chart. */
export function ChartAccessibleSummary({
  caption,
  columns,
  rows,
}: ChartAccessibleSummaryProps) {
  if (rows.length === 0) return null
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} scope="col">
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((col) => (
              <td key={col.key}>{row[col.key] ?? '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Build rows from parallel day + value arrays (KPI sparklines). */
export function sparklineSummaryRows(
  days: string[] | undefined,
  values: number[],
): Array<Record<string, string | number>> {
  return values.map((value, i) => ({
    period: days?.[i] ?? `Point ${i + 1}`,
    value,
  }))
}
