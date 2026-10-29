/**
 * /proof — the public scoreboard (docs/plan-gtm-november-2026.md §3, Phase 3).
 * Live aggregate numbers for the founder's own apps, fetched in the browser
 * from GET /v1/public/scoreboard (cached 15 minutes server-side), so the page
 * never shows numbers older than the API's "as of" stamp.
 */

import { ProofClient } from './ProofClient'

export default function ProofPage() {
  return <ProofClient />
}
