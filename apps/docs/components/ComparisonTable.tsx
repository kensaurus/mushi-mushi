/**
 * FILE: apps/docs/components/ComparisonTable.tsx
 * PURPOSE: A 3-column "X vs Y" comparison table with the right column
 *   visually emphasised (vermillion wash) to point the eye at what *Mushi*
 *   uniquely offers vs the named compare-against (usually Sentry).
 *
 * WHY THIS COMPONENT EXISTS
 * -------------------------
 * Plain markdown tables on the docs site render with the Nextra default:
 * thin grey border, neutral headers, no semantic differentiation between
 * columns. On a "Why Mushi vs. Sentry alone" comparison this loses the
 * editorial point — both columns look equally weighted, and the reader
 * has to read every row to find the contrast. NN/g visual hierarchy +
 * Gestalt common-region say: when one column is the answer and the other
 * is the foil, give the answer column more visual weight.
 *
 * The CSS for the wash lives in `app/globals.css` under
 * `.nextra-content table[data-compare]` so the component is purely a
 * structural wrapper. Authors can also reach the same effect by writing
 * a plain markdown table and setting `data-compare="2"` via a small
 * `<table>` post-processor — the component just makes the common case
 * (3 columns: row label, foil, mushi) ergonomic.
 *
 * USAGE
 * -----
 *   <ComparisonTable
 *     foil="Sentry"
 *     rows={[
 *       { label: 'Source of bugs', foil: 'Stack traces & perf', mushi: 'Direct user reports + Sentry User Feedback' },
 *       …
 *     ]}
 *   />
 */

interface ComparisonRow {
  label: string
  foil: string
  mushi: string
}

interface ComparisonTableProps {
  foil: string
  rows: readonly ComparisonRow[]
}

export function ComparisonTable({ foil, rows }: ComparisonTableProps) {
  return (
    <table data-compare="2">
      <thead>
        <tr>
          <th scope="col">Layer</th>
          <th scope="col">{foil}</th>
          <th scope="col">Mushi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" style={{ fontWeight: 600 }}>
              {row.label}
            </th>
            <td>{row.foil}</td>
            <td>{row.mushi}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
