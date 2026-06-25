import { PRICING_TIERS } from '@/lib/public-copy'

/** Full plan table for /pricing — sourced from PRICING_TIERS SSOT. */
export function PricingTiersTable() {
  return (
    <table>
      <thead>
        <tr>
          <th>Plan</th>
          <th>Monthly</th>
          <th>Annual (2 mo free)</th>
          <th>Diagnoses</th>
          <th>Retention</th>
          <th>Seats</th>
          <th>What you get</th>
        </tr>
      </thead>
      <tbody>
        {PRICING_TIERS.map((tier) => (
          <tr key={tier.id}>
            <td>
              <strong>{tier.name}</strong>
            </td>
            <td>{tier.monthly}</td>
            <td>{tier.annual ?? '—'}</td>
            <td>{tier.diagnoses}</td>
            <td>{tier.retention ?? '—'}</td>
            <td>{tier.seats ?? '—'}</td>
            <td>{tier.highlights}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Compact plan table for /cloud — same tier facts, fewer columns. */
export function CloudPlansTable() {
  return (
    <table>
      <thead>
        <tr>
          <th>Plan</th>
          <th>Cost</th>
          <th>Diagnoses included</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {PRICING_TIERS.filter((t) => t.id !== 'self-host').map((tier) => (
          <tr key={tier.id}>
            <td>
              <strong>{tier.name}</strong>
            </td>
            <td>{tier.cloudCost ?? tier.monthly}</td>
            <td>{tier.diagnoses}</td>
            <td>{tier.cloudNotes ?? tier.highlights}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
