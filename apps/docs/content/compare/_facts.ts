/**
 * FILE: apps/docs/content/compare/_facts.ts
 * PURPOSE: Single source of truth for every fact on the /compare/* pages and
 *          the "Lovable app broke in production" how-to.
 *
 * Rules (docs-comparison-pages):
 *   - One fact per entry, each with the URL it was checked against and the
 *     date it was checked. Pages render these arrays; no number is typed
 *     into MDX by hand.
 *   - A fact that could not be verified on `FACTS_REVIEWED_AT` carries
 *     `unverified: true` and renders with an explicit "unverified — check
 *     before publishing" note. Fix the fact; never delete the note.
 *   - Re-check every entry quarterly (`NEXT_REVIEW_DUE`) and whenever a
 *     competitor changes pricing. Bump `FACTS_REVIEWED_AT` only after a
 *     full pass — it is the "Facts checked …" line every page shows.
 *
 * The Sentry page reuses `LANDING_COMPARISON_ROWS` from lib/landing-copy.ts
 * (import, do not edit) and appends the pricing rows defined here.
 */

import type { LandingComparisonRow } from '@/lib/landing-copy'
import type { FaqEntry } from '@/lib/structured-data'

export const FACTS_REVIEWED_AT = '2026-09-21'
export const NEXT_REVIEW_DUE = '2026-12-21'

export interface Fact {
  /** Short label, e.g. "Free tier". */
  claim: string
  /** The fact as we state it, in plain English. */
  value: string
  /** The page the fact was read from on `reviewedAt`. */
  sourceUrl: string
  reviewedAt: typeof FACTS_REVIEWED_AT
  /** True when the source page did not confirm the value on `reviewedAt`. */
  unverified?: boolean
}

export interface Vendor {
  name: string
  url: string
  /** One sentence on what the product is for, in its own terms. */
  whatItIs: string
  facts: readonly Fact[]
}

/** Signup CTA with the per-page attribution the console's signup form reads (`?src=`). */
export function signupUrl(slug: string): string {
  return `https://kensaur.us/mushi-mushi/admin/signup?src=compare-${slug}`
}

const R = FACTS_REVIEWED_AT

// ── Mushi (from the repo and the live pricing page) ────────────────────────

const MUSHI_PRICING = 'https://kensaur.us/mushi-mushi/docs/pricing'
const MUSHI_REPO = 'https://github.com/kensaurus/mushi-mushi'

export const MUSHI: Vendor = {
  name: 'Mushi Mushi',
  url: 'https://kensaur.us/mushi-mushi/',
  whatItIs:
    'An in-app bug reporter for production apps: a user reports from the widget, Mushi attaches the screenshot and console/network tail, writes a plain-English diagnosis, and hands a fix prompt to Cursor or Claude Code over MCP.',
  facts: [
    { claim: 'Free tier', value: 'Free Cloud: 50 diagnoses per month, no card', sourceUrl: MUSHI_PRICING, reviewedAt: R },
    { claim: 'Paid tiers', value: 'Indie $15/mo (500 diagnoses) · Pro $49/mo (2,000 diagnoses)', sourceUrl: MUSHI_PRICING, reviewedAt: R },
    { claim: 'License', value: 'SDKs MIT; server AGPLv3', sourceUrl: `${MUSHI_REPO}/blob/master/LICENSE`, reviewedAt: R },
    { claim: 'Self-host', value: 'Free, whole stack, one command (SELF_HOSTED.md)', sourceUrl: `${MUSHI_REPO}/blob/master/SELF_HOSTED.md`, reviewedAt: R },
    { claim: 'Editor loop', value: 'MCP server for Cursor / Claude Code; no second LLM key in the MCP process', sourceUrl: 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp', reviewedAt: R },
  ],
}

// ── Sentry ─────────────────────────────────────────────────────────────────

const SENTRY_PRICING = 'https://sentry.io/pricing/'

export const SENTRY: Vendor = {
  name: 'Sentry',
  url: 'https://sentry.io/',
  whatItIs:
    'Error and performance monitoring: SDKs capture exceptions, traces and releases, and Seer is a paid AI debugging agent on top.',
  facts: [
    { claim: 'Free tier', value: 'Developer plan: $0, 5k errors, limited to one user', sourceUrl: SENTRY_PRICING, reviewedAt: R },
    { claim: 'Paid tiers', value: 'Team $26/mo · Business $80/mo · Enterprise custom', sourceUrl: SENTRY_PRICING, reviewedAt: R },
    {
      claim: 'Seer (AI debugging agent)',
      value: 'Listed as "subscription required" on Team and above; the pricing page shows no per-seat number. Third-party write-ups put it at $40 per active contributor per month since 27 Jan 2026.',
      sourceUrl: 'https://last9.io/blog/sentry-pricing/',
      reviewedAt: R,
    },
    {
      claim: 'Self-host',
      value: 'Yes: getsentry/self-hosted (Docker Compose; 4 cores, 16 GB RAM + 16 GB swap, 20 GB disk). Seer and other AI features are not included in self-hosted.',
      sourceUrl: 'https://develop.sentry.dev/self-hosted/',
      reviewedAt: R,
    },
  ],
}

/** Pricing rows appended under `LANDING_COMPARISON_ROWS` on /compare/sentry-vs-mushi. */
export const SENTRY_PRICING_ROWS: readonly LandingComparisonRow[] = [
  {
    label: 'Free tier',
    foil: 'Developer: 5k errors/mo, one user',
    mushi: 'Free Cloud: 50 diagnoses/mo, no card',
  },
  {
    label: 'AI diagnosis',
    foil: 'Seer, a separate subscription on Team ($26/mo) and above',
    mushi: 'Included in every diagnosis, free tier onward',
  },
  {
    label: 'Self-host',
    foil: 'getsentry/self-hosted (no Seer); 4 cores / 16 GB RAM minimum',
    mushi: 'AGPLv3 server, one command, diagnosis included with your own LLM key',
  },
]

export const SENTRY_FAQ: readonly FaqEntry[] = [
  {
    q: 'Is Mushi a replacement for Sentry?',
    a: 'Your call. Sentry tells you what threw. Mushi ingests that, plus the bugs that never throw, explains each one in plain English, and closes the loop with a fix your agent can ship. One queue, with or without Sentry.',
  },
  {
    q: 'Can I run Mushi alongside Sentry?',
    a: 'Yes. Point a Sentry issue-alert webhook at Mushi and errors land in the same queue as user reports, deduped and diagnosed; merging the fix resolves the linked Sentry issue. The setup takes three steps on the Sentry plugin page.',
  },
  {
    q: 'Does Sentry have an AI fix loop?',
    a: 'Seer is Sentry\'s AI debugging agent. On 2026-09-21 the pricing page listed it as a separate subscription on Team and above, without a per-seat price; third-party write-ups put it at $40 per active contributor per month. Seer is not part of Sentry self-hosted.',
  },
  {
    q: 'What does Mushi cost?',
    a: 'Free Cloud is 50 diagnoses a month with no card. Indie is $15 a month, Pro is $49 a month. Self-hosting the AGPLv3 server is free.',
  },
]

// ── Jam.dev ────────────────────────────────────────────────────────────────

const JAM_PRICING = 'https://jam.dev/pricing'

export const JAM: Vendor = {
  name: 'Jam',
  url: 'https://jam.dev/',
  whatItIs:
    'A Chrome extension a person uses to record a bug: video plus console, network, device metadata and user actions, sent to Jira or Linear. Recording Links let people outside your workspace record too.',
  facts: [
    { claim: 'Free tier', value: '$0: 30 Jams/mo, recordings up to 5 min, 5 Recording Links/mo, 5 creator seats, MCP, webhooks, Jira/Linear', sourceUrl: JAM_PRICING, reviewedAt: R },
    { claim: 'Team tier', value: '$14 per creator per month billed yearly: unlimited Jams, 15-min recordings, 150 Recording Links/mo, 200 AI summaries', sourceUrl: JAM_PRICING, reviewedAt: R },
    { claim: 'Enterprise', value: 'Custom, yearly billing only: SAML/SSO, audit logs, automatic data deletion', sourceUrl: JAM_PRICING, reviewedAt: R },
    { claim: 'Agent access', value: '"Debug Jams via MCP" is on the free tier', sourceUrl: JAM_PRICING, reviewedAt: R },
    { claim: 'Self-host', value: 'Not offered on the pricing page', sourceUrl: JAM_PRICING, reviewedAt: R },
  ],
}

export const JAM_ROWS: readonly LandingComparisonRow[] = [
  {
    label: 'Who presses record',
    foil: 'A teammate, tester or support agent with the extension, or an outsider via a Recording Link',
    mushi: 'Your end user, from the widget or a phone shake, inside the production app',
  },
  {
    label: 'What arrives',
    foil: 'A video with console, network, device metadata and user actions',
    mushi: 'The user\'s sentence, a screenshot, the console/network tail, route and timeline',
  },
  {
    label: 'What you read first',
    foil: 'The recording',
    mushi: 'A plain-English diagnosis: what broke, why, which files',
  },
  {
    label: 'Repeat reports',
    foil: 'One Jam per recording',
    mushi: 'Same bug collapses to one row',
  },
  {
    label: 'Agent hand-off',
    foil: 'MCP exposes the Jam\'s logs to your agent',
    mushi: 'MCP exposes the diagnosis, fix context and lessons; optional agent-drafted PR',
  },
  {
    label: 'Free tier',
    foil: '30 Jams/mo, 5-min recordings, 5 creator seats',
    mushi: '50 diagnoses/mo, no card',
  },
  {
    label: 'Paid entry',
    foil: '$14 per creator per month, billed yearly',
    mushi: '$15/mo Indie (500 diagnoses)',
  },
  {
    label: 'Self-host',
    foil: 'Not offered',
    mushi: 'Free, AGPLv3',
  },
]

export const JAM_FAQ: readonly FaqEntry[] = [
  {
    q: 'Is Jam a bug reporter for end users?',
    a: 'Mostly for people on or near the team. Jam is a Chrome extension a teammate, tester or support agent uses to record a bug; Recording Links let someone outside the workspace record too. Mushi is an SDK inside your production app, so the person who hit the bug reports it without installing anything.',
  },
  {
    q: 'Can I use Jam and Mushi together?',
    a: 'Yes, and it is a sensible split: Jam for internal QA and support recordings, Mushi for reports from real users in production and for the diagnosis-to-fix loop in your editor. There is no direct integration between the two today.',
  },
  {
    q: 'Which one gives my coding agent more?',
    a: 'Both have MCP. Jam\'s MCP hands the recording\'s console and network logs to your agent. Mushi\'s MCP hands over the plain-English diagnosis, the fix context scoped to files, past lessons, and can dispatch a draft PR.',
  },
  {
    q: 'What do the free tiers cover?',
    a: 'Jam Free (2026-09-21): 30 Jams a month, recordings up to 5 minutes, 5 Recording Links, 5 creator seats. Mushi Free Cloud: 50 diagnoses a month, no card, unlimited reports.',
  },
]

// ── PostHog ────────────────────────────────────────────────────────────────

const POSTHOG_PRICING = 'https://posthog.com/pricing'

export const POSTHOG: Vendor = {
  name: 'PostHog',
  url: 'https://posthog.com/',
  whatItIs:
    'A product-analytics platform with session replay, error tracking, feature flags, surveys and more, priced per product with a monthly free allowance on each.',
  facts: [
    { claim: 'Session replay free tier', value: '5K recordings per month', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Error tracking free tier', value: '100K exceptions per month', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Analytics free tier', value: '1M events per month', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Free plan limits', value: 'No credit card; 1 project; 1-year data retention; usage stops at the free limits', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Open source', value: 'An MIT-licensed open-source product is available (pricing page FAQ)', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    {
      claim: 'AI fixes',
      value: 'The free tier lists "PostHog AI" credits and an "Inbox" beta with "3 PRs"; what that does for exceptions was not verified',
      sourceUrl: POSTHOG_PRICING,
      reviewedAt: R,
      unverified: true,
    },
  ],
}

export const POSTHOG_ROWS: readonly LandingComparisonRow[] = [
  {
    label: 'What it captures',
    foil: 'Every session as a replay, every exception as an event, plus product analytics',
    mushi: 'The sessions where a user said something was wrong, with the screenshot and console/network tail',
  },
  {
    label: 'Where the bug is found',
    foil: 'You scrub the replay and read the exception',
    mushi: 'Mushi writes the diagnosis: what broke, why, which files',
  },
  {
    label: 'Bugs that never throw',
    foil: 'Visible in replay if you know which session to open',
    mushi: 'The user tells you, and the report carries the screen they were looking at',
  },
  {
    label: 'Editor hand-off',
    foil: 'Copy what you learned into Cursor',
    mushi: 'MCP: diagnosis, fix context and lessons in Cursor / Claude Code',
  },
  {
    label: 'Product analytics',
    foil: 'Full suite: 1M events/mo free',
    mushi: 'Basic: track(), funnels, paths, people, retention in the same console',
  },
  {
    label: 'Free tier',
    foil: '5K replays + 100K exceptions/mo, no card, 1 project',
    mushi: '50 diagnoses/mo, no card',
  },
  {
    label: 'Self-host',
    foil: 'MIT open-source product available',
    mushi: 'Free, AGPLv3 server, MIT SDKs',
  },
]

export const POSTHOG_FAQ: readonly FaqEntry[] = [
  {
    q: 'Does Mushi replace PostHog session replay?',
    a: 'No. PostHog records every session; Mushi records the moment a user reports a bug, with the screenshot and console/network tail, and then writes the diagnosis. Keep PostHog for replay and product analytics; add Mushi when you want the report to arrive already explained.',
  },
  {
    q: 'Can I run PostHog and Mushi together?',
    a: 'Yes. They do not conflict in the browser. There is no PostHog plugin for Mushi today, so a report will not deep-link to the PostHog replay; you can add the PostHog session id to Mushi metadata yourself.',
  },
  {
    q: 'Does Mushi do product analytics?',
    a: 'A basic version: Mushi.track() with funnels, paths, people and retention in the same console, 90-day retention by default. PostHog is the fuller analytics product; Mushi\'s is there so a solo builder does not need a second tool to see a funnel.',
  },
  {
    q: 'What do the free tiers cover?',
    a: 'PostHog (2026-09-21): 5K session recordings, 100K exceptions and 1M analytics events a month, no card, one project, one-year retention. Mushi: 50 diagnoses a month, no card; self-hosting is free.',
  },
]

// ── Sentry alternatives for solo founders (six-way matrix) ────────────────

export interface AlternativeRow {
  vendor: string
  url: string
  freeTier: string
  selfHost: string
  aiFix: string
  pickIf: string
  sourceUrl: string
  unverified?: boolean
}

const BUGSNAG_PRICING = 'https://www.bugsnag.com/pricing/'
const ROLLBAR_PRICING = 'https://rollbar.com/pricing/'
const HIGHLIGHT_REPO = 'https://github.com/highlight/highlight'

export const ALTERNATIVES: readonly AlternativeRow[] = [
  {
    vendor: 'Sentry',
    url: 'https://sentry.io/',
    freeTier: 'Developer: 5k errors/mo, one user',
    selfHost: 'Yes, getsentry/self-hosted (Docker; 4 cores / 16 GB RAM); no Seer',
    aiFix: 'Seer, separate subscription on Team ($26/mo) and above',
    pickIf: 'You want the deepest error, tracing and release tooling and expect to grow into a team plan.',
    sourceUrl: SENTRY_PRICING,
  },
  {
    vendor: 'Bugsnag',
    url: 'https://www.bugsnag.com/',
    freeTier: 'Free: $0, "solo users and their passion projects", 7.5K events + 1M spans/mo',
    selfHost: 'unverified — check before publishing',
    aiFix: 'None listed on the pricing page',
    pickIf: 'You want stability-score style crash reporting for a mobile app and a free tier aimed at one person.',
    sourceUrl: BUGSNAG_PRICING,
    unverified: true,
  },
  {
    vendor: 'Rollbar',
    url: 'https://rollbar.com/',
    freeTier: 'Free: 5,000 events/mo, 1,000 replays/mo',
    selfHost: 'unverified — check before publishing',
    aiFix: 'unverified — check before publishing',
    pickIf: 'You want error grouping plus a small replay allowance without paying, and your volume is low.',
    sourceUrl: ROLLBAR_PRICING,
    unverified: true,
  },
  {
    vendor: 'highlight.io',
    url: HIGHLIGHT_REPO,
    freeTier: 'unverified — highlight.io/pricing redirected to launchdarkly.com on 2026-09-21; check before publishing',
    selfHost: 'Yes per the GitHub README: hobby self-hosted instance for under 10k sessions/mo',
    aiFix: 'None listed in the README',
    pickIf: 'You want replay, errors, logs and traces in one open-source box you run yourself.',
    sourceUrl: HIGHLIGHT_REPO,
    unverified: true,
  },
  {
    vendor: 'PostHog',
    url: 'https://posthog.com/',
    freeTier: '5K replays + 100K exceptions + 1M events/mo, no card, 1 project',
    selfHost: 'MIT open-source product available',
    aiFix: 'PostHog AI credits and an "Inbox" beta (3 PRs) on the free tier; scope unverified',
    pickIf: 'You already want product analytics and replay, and error tracking can ride along.',
    sourceUrl: POSTHOG_PRICING,
    unverified: true,
  },
  {
    vendor: 'Mushi Mushi',
    url: 'https://kensaur.us/mushi-mushi/',
    freeTier: 'Free Cloud: 50 diagnoses/mo, no card',
    selfHost: 'Yes, free, AGPLv3 server, one command',
    aiFix: 'Included: plain-English diagnosis + fix prompt; MCP into Cursor / Claude Code; optional agent-drafted PR',
    pickIf: 'You did not write most of the code, your users tell you about bugs, and you want the fix in your editor.',
    sourceUrl: MUSHI_PRICING,
  },
]

export const ALTERNATIVES_FAQ: readonly FaqEntry[] = [
  {
    q: 'What is the cheapest way to get error tracking as a solo founder?',
    a: 'Every tool on this page has a free tier with no card (Sentry Developer, Bugsnag Free, Rollbar Free, PostHog, Mushi Free Cloud), and Sentry, PostHog, highlight.io and Mushi can be self-hosted for free. The real cost is the afternoon you spend reading what they collected.',
  },
  {
    q: 'Which of these explain the bug instead of showing a stack trace?',
    a: 'Sentry\'s Seer does, as a separate paid subscription. Mushi does on every plan, including free and self-hosted with your own LLM key. PostHog lists AI credits and a PR beta whose scope we could not verify on 2026-09-21.',
  },
  {
    q: 'Do I have to rip out Sentry to try Mushi?',
    a: 'No. Mushi runs standalone or alongside Sentry: a Sentry issue-alert webhook sends errors into Mushi\'s queue, and merging the fix resolves the Sentry issue.',
  },
  {
    q: 'How current is this page?',
    a: 'Every number was read from the linked pricing page on 2026-09-21. Rows marked unverified could not be confirmed that day and say so. The next scheduled review is 2026-12-21.',
  },
]

// ── Lovable app broke in production (how-to) ──────────────────────────────

export const LOVABLE_FAQ: readonly FaqEntry[] = [
  {
    q: 'My Lovable app works for me but breaks for a user. Where do I start?',
    a: 'Get the user\'s exact words and the screen they were on, then reproduce in a private window on their device type. Most "works for me" bugs are a logged-out state, a stale cached build, or an environment variable that only exists locally.',
  },
  {
    q: 'How do I see errors in production when I did not write the code?',
    a: 'Open the browser console on the failing page and read the first red line, not the last. Then find the file it names in your repo and ask your AI editor what that function assumes. If you want reports to arrive with the console and screenshot attached, install a bug-report SDK.',
  },
  {
    q: 'Is it safe to paste the error into Cursor or Claude Code?',
    a: 'Yes, as long as you strip user emails, tokens and API keys first. Give the agent the error, the file it names and one sentence of what the user was trying to do; ask for the smallest change that fixes it and a test.',
  },
  {
    q: 'How do I stop the same bug from coming back?',
    a: 'Write the cause down where the agent will read it next time: a comment at the site, a rule file, or a lessons file your editor loads. Then add the failing case to a test before you ask the agent for the fix.',
  },
]
