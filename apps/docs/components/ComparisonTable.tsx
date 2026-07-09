/** A 3-column "X vs Y" comparison table with the right column */

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
    <div className="not-prose my-6 overflow-x-auto">
    <table data-compare="2">
      <thead>
        <tr>
          <th scope="col">Question</th>
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
    </div>
  )
}
