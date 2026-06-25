/**
 * Visitor-facing copy shared across docs routes (FAQ, pricing, connect, login).
 * Hero/category strings live in @mushi-mushi/brand and landing-copy.ts.
 */
import { MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'

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
] as const

/** Plain-English definition — no model names (those belong in depth sections). */
export const DIAGNOSIS_PLAIN =
  'A diagnosis is one completed plain-English root cause — the moment Mushi finishes reading a report and can hand your editor a paste-ready fix prompt. Noise filtered out or duplicate reports collapsed to one row do not count. You pay for comprehension, not volume.'

export const PRICING_LEDE = DIAGNOSIS_PLAIN

export const CLOUD_INTRO = {
  lead: 'Mushi Cloud at kensaur.us/mushi-mushi is the managed product. Same open-source code — we host it, you get a metered diagnosis bill.',
  diagnosisNote:
    'A diagnosis = one finished plain-English root cause written to your queue. Filtered noise and deduplicated groups do not count.',
  meteredWhy:
    'Bug signals are bursty. The free tier covers 50 diagnoses / month for side projects; usage-based overage means the bill tracks the value. Duplicate stack traces collapse — you pay once per root cause.',
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

export const LOGIN_HERO = {
  cloudTagline: MUSHI_TAGLINE_V2.oneLiner,
  selfHostTagline: 'Sign in to your self-hosted Mushi console.',
} as const

export const QUICKSTART_HUB_LEDE =
  'Start here if you vibe-code: the incident loop gets you from broken prod to a paste-ready fix prompt in Cursor — usually under a few minutes.'

export const QUICKSTART_ONE_KEY_CALLOUT =
  'One key for both surfaces. The wizard mints a single API key for the SDK (sending reports) and the CLI (mushi doctor, mushi billing, etc.). Same key also works for read-only MCP tools in your editor.'

export const CONCEPTS_INDEX_LEDE =
  'When a user feels something break, Mushi captures it, explains it in plain English, and can hand your editor a fix — without another dashboard to babysit.'

export const ADMIN_INDEX_LEDE =
  'See what users reported, what broke, and what got fixed — the console mirror of the loop on your landing page.'

export const INCIDENT_LOOP_LEDE =
  'Broken prod → plain-English read in your queue → paste-ready fix prompt in Cursor. This is the default path for vibe coders.'

export const MCP_QUICKSTART_LEDE =
  'Ask your editor what broke. Mushi sends back the report, the plain-English read, and a fix brief — without leaving the window.'

export const CURSOR_INTEGRATION_LEDE =
  'Your AI wrote the code. When prod breaks, pull the report and fix context into Cursor — plain English first, diff second.'

export interface PricingTierRow {
  id: string
  name: string
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
    monthly: 'Free forever',
    diagnoses: 'Unlimited (your own LLM key)',
    retention: 'Your choice',
    seats: 'Unlimited',
    highlights: 'Full OSS stack — MIT SDK, AGPLv3 server, bring your own LLM keys',
  },
  {
    id: 'free',
    name: 'Free Cloud',
    monthly: '$0',
    cloudCost: '$0 / mo',
    diagnoses: '50 / mo',
    retention: '7 days',
    seats: '1',
    highlights: 'Hosted admin, plain-English reads, hard stop at limit',
    cloudNotes: 'All SDKs, hosted admin, community Discord, plain-English reads',
  },
  {
    id: 'indie',
    name: 'Indie',
    monthly: '$15 / mo',
    annual: '$150 / yr ($12.50/mo)',
    cloudCost: '$15 / mo',
    diagnoses: '500 / mo',
    retention: '30 days',
    seats: '1',
    highlights:
      'Usage alerts at 50% / 80% / 100%, overage $0.03/diagnosis, $50 spend cap',
    cloudNotes:
      '80% / 100% email alerts, hard spend cap, plugin marketplace, email support — $0.03 / extra diagnosis',
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: '$49 / mo',
    annual: '$490 / yr ($40.83/mo)',
    cloudCost: '$49 / mo',
    diagnoses: '2,000 / mo',
    retention: '90 days',
    seats: '5',
    highlights:
      'Team seats, integrations, overage $0.025/diagnosis, $200 spend cap',
    cloudNotes:
      'Team seats (×5), shared issue views, Sentry / Linear / Jira integrations — $0.025 / extra diagnosis',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthly: 'Contact us',
    annual: 'Custom',
    cloudCost: 'Contact us',
    diagnoses: 'Custom',
    retention: 'Up to 365 days',
    seats: 'Unlimited',
    highlights: 'SAML SSO, SCIM, data residency, priority support',
    cloudNotes: 'SOC 2, SAML SSO, SCIM, your own LLM keys, data residency, self-host SLA',
  },
] as const
