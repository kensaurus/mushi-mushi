/**
 * Visitor-facing copy shared across docs routes (FAQ, pricing, connect, login).
 * Hero/category strings live in @mushi-mushi/brand and landing-copy.ts.
 */
import { ADMIN_DEMO_BASE } from '../data/admin-screenshots'

export interface PublicFaqItem {
  q: string
  a: string
}

export const PUBLIC_FAQ: readonly PublicFaqItem[] = [
  {
    q: 'The lime banner never appears in my store build',
    a: 'Native builds bake Mushi env vars at compile time. Open Admin → Connect → Native app CI secrets and sync the missing vars, or run scripts/check-mushi-env.mjs in your prebuild.',
  },
  {
    q: 'Reports return 401 or never show up',
    a: 'Check that your project ID and ingest key match the console. Run mushi ping and Send test report on Projects. Use the SDK ingest key — not your editor MCP key.',
  },
  {
    q: 'MCP tools list is empty in Cursor',
    a: 'Restart Cursor after editing .cursor/mcp.json. Pass MUSHI_PROJECT_ID in env. Mint an MCP read key in the console if you have not already.',
  },
  {
    q: 'Widget shows but classification stays pending',
    a: 'Add your Anthropic or OpenAI key under Settings → API Keys. Self-hosters: confirm migrations are applied and the classify worker is deployed.',
  },
] as const

export const PUBLIC_FAQ_MCP: readonly PublicFaqItem[] = [
  ...PUBLIC_FAQ,
  {
    q: 'Cursor says it cannot reach the Mushi server',
    a: 'Check the MCP endpoint URL and that your API key is active. Run npx mushi-mushi setup --ide cursor again to rewrite the config.',
  },
  {
    q: 'Claude Code says "HTTP 404 dialing" the Mushi server',
    a: 'Your editor saved an old sign-in for the server and keeps reusing it. Clear it: in Claude Code run /mcp, pick mushi, and choose to clear authentication (or remove the server and add it again). Then sign in once more.',
  },
] as const

/** Plain-English definition — no model names (those belong in depth sections). */
export const DIAGNOSIS_PLAIN =
  'A diagnosis is one completed plain-English root cause — the moment Mushi finishes reading a report and can hand your editor a paste-ready fix prompt. Noise filtered out or duplicate reports collapsed to one row do not count. You pay for comprehension, not volume.'

export const PRICING_LEDE = DIAGNOSIS_PLAIN

/**
 * Primary /pricing CTA — rendered under the lede and again at the foot
 * (<PricingCta />). `?src=pricing` is what the console reads as the signup
 * source; <MushiSiteAnalytics /> adds `ref=` from the first-touch utm_source
 * at click time.
 */
export const PRICING_CTA = {
  label: 'Start free — 1 app, 100 diagnoses/mo, no card',
  href: `${ADMIN_DEMO_BASE}/signup?src=pricing`,
  note: 'Move to Builder for a second app. Upgrade from Billing, no sales call.',
} as const

export interface PricingTierCta {
  label: string
  href: string
  /** Absolute URL to another app / site, or a `mailto:` — rendered as a plain `<a>`. */
  external: boolean
}

/**
 * "Get started" column of <PricingTiersTable />, keyed by PRICING_TIERS id.
 * Paid tiers deliberately start on Free — there is no checkout before a
 * project exists; Billing upgrades from inside the console.
 */
export const PRICING_TIER_CTAS: Readonly<Record<string, PricingTierCta>> = {
  'self-host': { label: 'Read the guide', href: '/self-hosting', external: false },
  free: { label: 'Start free', href: `${ADMIN_DEMO_BASE}/signup?src=pricing-free`, external: true },
  indie: {
    label: 'Start free, upgrade later',
    href: `${ADMIN_DEMO_BASE}/signup?src=pricing-indie`,
    external: true,
  },
  pro: {
    label: 'Start free, upgrade later',
    href: `${ADMIN_DEMO_BASE}/signup?src=pricing-pro`,
    external: true,
  },
  // docs/adr/0015 — kensaurus@gmail.com is the product inbox. Enterprise is
  // sales-led (owner decision 2026-10-10): no self-serve checkout.
  enterprise: {
    label: 'From $499/mo — contact us',
    href: 'mailto:kensaurus@gmail.com?subject=Mushi%20Enterprise%20inquiry',
    external: true,
  },
}

export const CLOUD_INTRO = {
  lead: 'Mushi Cloud at kensaur.us/mushi-mushi is the managed product. Same open-source code — we host it, you get a metered diagnosis bill.',
  diagnosisNote:
    'A diagnosis = one finished plain-English root cause written to your queue. Filtered noise and deduplicated groups do not count.',
  meteredWhy:
    'A plan is the number of apps you watch; diagnoses are the allowance under it. Free covers one app and 100 diagnoses a month, Builder three apps, Studio ten. Bug signals are bursty, so past the allowance each diagnosis is a few cents up to the cap you set. Duplicate stack traces collapse — you pay once per root cause.',
} as const

export const CONNECT_SKILLS = {
  intro:
    'Skills are playbooks your editor can read on demand — bug triage, fix-and-ship, QA, security audit, and more.',
  whatAreSkillsTitle: 'What are skills?',
  whatAreSkillsBody:
    'SKILL.md playbooks live in GitHub repos and sync into Mushi so the right playbook surfaces when a report lands. Your agent reads them — nothing runs automatically.',
  learnMoreHref: 'https://kensaur.us/mushi-mushi/docs/sdks/skills',
  learnMoreLabel: 'Learn about skills →',
} as const

export const QUICKSTART_HUB_LEDE =
  'New here? Three steps: install, send a first report, get your first fix.'

export const QUICKSTART_ONE_KEY_CALLOUT =
  'One key does it all. The wizard creates a single API key (a password your app uses to talk to Mushi) for the SDK, which sends reports, and for the command-line tool (mushi doctor, mushi billing and so on). The same key also works for the read-only MCP tools in your editor.'

export const CONCEPTS_INDEX_LEDE =
  'When a user runs into something broken, Mushi records it, explains it in plain English and can hand your editor a fix, without another dashboard to babysit.'

export const ADMIN_INDEX_LEDE =
  'See what users reported, what broke, and what got fixed — the console mirror of the loop on your landing page.'

export const INCIDENT_LOOP_LEDE =
  'The incident loop takes you from "a user hit a bug in my live app" to "my AI assistant is fixing it". The bug arrives in your Mushi list with a plain-English read, and you paste a ready-made fix prompt into Cursor. It is the default path for vibe coders.'

export const MCP_QUICKSTART_LEDE =
  'Ask your editor what broke. Over MCP (the standard way AI editors connect to outside tools), Mushi sends back the report, the plain-English read and a fix brief, without you leaving the window.'

export const CURSOR_INTEGRATION_LEDE =
  'Your AI wrote the code. When prod breaks, pull the report and fix context into Cursor — plain English first, diff second.'

export interface PricingTierRow {
  id: string
  name: string
  /** Apps a team can watch: the plan's headline limit (docs/plan-pricing.md, 2026-10-28). */
  apps: string
  monthly: string
  annual?: string
  cloudCost?: string
  diagnoses: string
  retention?: string
  seats?: string
  /** Plain-English feature summary — no "AI triage" jargon. */
  highlights: string
  /** Shorter notes column on /cloud */
  cloudNotes?: string
}

/** Single source of truth for plan rows on /pricing and /cloud. */
export const PRICING_TIERS: readonly PricingTierRow[] = [
  {
    id: 'self-host',
    name: 'Self-host',
    apps: 'Unlimited',
    monthly: 'Free forever',
    diagnoses: 'Unlimited (your own AI key)',
    retention: 'Your choice',
    seats: 'Unlimited',
    highlights: 'Full OSS stack — MIT SDK, AGPLv3 server, bring your own LLM keys',
  },
  {
    id: 'free',
    name: 'Free',
    apps: '1',
    monthly: '$0',
    cloudCost: '$0 / mo',
    diagnoses: '100 / mo',
    retention: '14 days',
    seats: '1',
    highlights: 'One app, the whole loop once: plain-English diagnosis and a fix packet in your editor; fix PRs with your own AI key. Hard stop at the limit',
    cloudNotes: 'All SDKs, hosted console, your own AI and Cursor keys, community support in GitHub Discussions'
  },
  {
    id: 'indie',
    name: 'Builder',
    apps: '3',
    monthly: '$29 / mo',
    annual: '$290 / yr ($24.17/mo)',
    cloudCost: '$29 / mo',
    diagnoses: '1,000 / mo',
    retention: '90 days',
    seats: '1',
    highlights:
      'Automatic fix PRs with a review gate, merge queue, Slack / Discord alerts; then $0.03/diagnosis up to a $50 cap you set',
    cloudNotes:
      'Three apps, automatic fix PRs, plugin marketplace, usage alerts, email support — $0.03 / extra diagnosis'
  },
  {
    id: 'pro',
    name: 'Studio',
    apps: '10',
    monthly: '$79 / mo',
    annual: '$790 / yr ($65.83/mo)',
    cloudCost: '$79 / mo',
    diagnoses: '3,000 / mo',
    retention: '180 days',
    seats: '5',
    highlights:
      'A portfolio of apps: 5 seats, the weekly report across your apps, longer history; then $0.03/diagnosis up to a $200 cap',
    cloudNotes:
      'Ten apps, 5 seats, weekly report, shared views, Sentry / Linear / Jira — $0.03 / extra diagnosis'
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    apps: 'Unlimited',
    monthly: 'From $499 / mo',
    annual: 'Custom',
    cloudCost: 'From $499 / mo',
    diagnoses: 'Custom',
    retention: 'Up to 365 days',
    seats: 'Unlimited',
    // SAML SSO is a real, shipped feature (console → SSO). SOC 2 refers to
    // the readiness/evidence-pack module (see /security/soc2), not a
    // third-party certification. Dedicated regional clusters are reserved,
    // not self-serve yet (see /security/data-residency) — Enterprise is the
    // path to get one provisioned. SCIM is intentionally omitted: no
    // provisioning endpoint exists yet, ask sales for the current status.
    highlights: 'SAML SSO, SOC 2 readiness pack, priority support',
    cloudNotes:
      'SOC 2 readiness pack, SAML SSO, your own LLM keys, dedicated regional cluster (provisioned on request), self-host SLA',
  },
] as const
