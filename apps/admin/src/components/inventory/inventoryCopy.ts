/**
 * Help copy for `/inventory`. The whitepaper breaks the inventory loop into
 * five movements (discover → propose → accept → ingest → reconcile) — this
 * help block exists because every first-time user asks the same question:
 * *"so what is this page actually doing?"*.
 *
 * v2.1 update: with passive SDK discovery + Claude-drafted proposals, most
 * users will never hand-author YAML. The copy now leads with the Discovery
 * tab; "ingest the YAML" is the power-user fallback.
 */

export const INVENTORY_HELP = {
  title: 'How this page works',
  whatIsIt:
    "Inventory is your app's user story, page, and action map. Once you install @mushi-mushi/web with discoverInventory: true, the SDK passively reports what users do; Claude drafts an inventory.yaml from those observations; you review & accept it. From there, gates and crawlers verify each action against your code & DB.",
  useCases: [
    'Discovery: install the SDK; we observe routes, testids, outbound APIs, and a 200-char DOM summary on every navigation (PII-safe — user IDs are SHA-256 hashed before they leave the browser).',
    'Proposal: when ≥3 routes & ≥10 events have been observed, click Generate on the Discovery tab and Claude drafts user stories, pages, and actions, with one-line rationales.',
    "Acceptance: review the draft (Stories tab is the primary view, YAML is the editable raw form), tweak persona names or merge stories, then click Accept — that becomes your project's active inventory.",
    'Verification: gates (dead_handler, mock_leak, status_claim, api_contract) run in CI on every PR; the crawler revisits each page.path and the synthetic monitor probes critical actions every 15 min.',
    "Status: every action's colour (verified · wired · mocked · stub · regressed) is derived from the gate + crawler + synthetic results — never hand-authored.",
  ],
  howToUse:
    "First time? Open Discovery — the lifecycle stepper there shows where you are in the install → observe → propose → accept loop. Once you have an active inventory, Stories shows it as user-readable cards, Tree shows the page × element grid, Gates lists open findings, Synthetic shows production probes, Drift shows what the crawler found that the YAML didn't (and vice-versa).",
}
