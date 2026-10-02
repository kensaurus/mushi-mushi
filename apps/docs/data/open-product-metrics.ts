/**
 * Product-usage numbers for /open — filled by hand by the owner from the
 * weekly GTM scorecard (docs/marketing/scorecard.md). While this is `null`
 * the "Product" section is not rendered at all; no public page shows a
 * placeholder. Instructions: docs/launch/README.md → "Owner: product numbers on /open".
 *
 * Only numbers the scorecard already holds, never rounded, always dated.
 */
export interface OpenProductMetrics {
  /** ISO date the numbers describe (the scorecard week's Monday). */
  asOf: string
  rows: ReadonlyArray<{ label: string; value: string }>
}

export const OPEN_PRODUCT_METRICS: OpenProductMetrics | null = null
