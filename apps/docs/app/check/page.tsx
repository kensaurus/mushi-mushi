/**
 * /check — the free Production Check (docs/plan-gtm-november-2026.md §4).
 * One address field and an optional email. The report for a check renders on
 * this same static page at `/check?id=<uuid>` (and at `/check/<uuid>` through
 * the 404 fallback); the browser polls the API until the check finishes.
 */

import { CheckClient } from './CheckClient'

export default function ProductionCheckPage() {
  return <CheckClient />
}
