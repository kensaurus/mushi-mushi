#!/usr/bin/env node
/**
 * Dogfood checklist for glot.it ↔ Mushi two-way loop.
 *
 * Prerequisites:
 *   - glot.it: NEXT_PUBLIC_MUSHI_* pointed at cloud dxptnwrhwsqckaftyymj
 *   - Console: localhost:6464 or https://kensaur.us/mushi-mushi/admin
 *   - CLI: MUSHI_API_KEY, MUSHI_API_ENDPOINT, MUSHI_PROJECT_ID=542b34e0-...
 *
 * Flow:
 *   1. Open glot.it → submit bug via Mushi banner
 *   2. Console /reports → triage → dispatch fix → merge
 *   3. glot.it "Your reports" → confirm fixed / not fixed
 *   4. CLI: mushi reports reply <id> "Thanks for confirming"
 */

const steps = [
  'Submit report from glot.it (banner or Settings → Bug Report)',
  'Verify in console /reports for project 542b34e0-019e-41fe-b900-7b637717bb86',
  'mushi reports reply <id> "We are on it"',
  'Check glot.it Your reports inbox shows admin reply',
  'mushi reports triage <id> --status fixing',
  'mushi fix <id> --wait (or merge manually in console)',
  'mushi fixes merge <fixId>',
  'In glot.it inbox tap "Yes, fixed for me" (confirms → verified)',
  'Re-report one bug with "Not fixed yet" to exercise regression reopen',
]

console.log('Mushi ↔ glot.it dogfood checklist\n')
for (const [i, step] of steps.entries()) {
  console.log(`${i + 1}. ${step}`)
}
