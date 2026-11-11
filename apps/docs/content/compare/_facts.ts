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

export const FACTS_REVIEWED_AT = '2026-10-29'
/** Mushi's own facts follow its pricing page (Free / Builder / Studio, 2026-10-28); competitor facts keep FACTS_REVIEWED_AT. */
const MUSHI_FACTS_REVIEWED_AT = '2026-10-29'
export const NEXT_REVIEW_DUE = '2027-01-29'
/** The agency feedback tools page (Marker.io, BugHerd, Userback) was read on its own day. */
export const AGENCY_FACTS_REVIEWED_AT = '2026-11-11'
export const AGENCY_NEXT_REVIEW_DUE = '2027-02-11'

interface Fact {
  /** Short label, e.g. "Free tier". */
  claim: string
  /** The fact as we state it, in plain English. */
  value: string
  /** The page the fact was read from on `reviewedAt`. */
  sourceUrl: string
  reviewedAt: typeof FACTS_REVIEWED_AT | typeof MUSHI_FACTS_REVIEWED_AT | typeof AGENCY_FACTS_REVIEWED_AT
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
    'An in-app bug reporter for production apps: a user reports from the widget, Mushi Mushi attaches the screenshot and console/network tail, writes a plain-English diagnosis, and hands a fix prompt to Cursor or Claude Code over MCP.',
  facts: [
    { claim: 'Free tier', value: 'Free: 1 app, 100 diagnoses per month (hard stop; later reports are kept, not diagnosed), 1 seat, 14-day retention, your own AI key allowed, no card', sourceUrl: MUSHI_PRICING, reviewedAt: MUSHI_FACTS_REVIEWED_AT },
    { claim: 'Paid tiers', value: 'Builder $29/mo (3 apps, 1,000 diagnoses) · Studio $79/mo (10 apps, 3,000 diagnoses) · Enterprise from $499/mo', sourceUrl: MUSHI_PRICING, reviewedAt: MUSHI_FACTS_REVIEWED_AT },
    { claim: 'License', value: 'SDKs MIT; server AGPLv3, except the enterprise folder (packages/server/ee: SSO, audit export, retention policies), which is source-available and needs a license in production', sourceUrl: `${MUSHI_REPO}/blob/master/LICENSE`, reviewedAt: R },
    { claim: 'Self-host', value: 'Free, whole stack, one command onto your own Supabase project (free tier works); bring your own Anthropic key (SELF_HOSTED.md)', sourceUrl: `${MUSHI_REPO}/blob/master/SELF_HOSTED.md`, reviewedAt: R },
    { claim: 'Editor loop', value: 'MCP server for Cursor / Claude Code; no second LLM key in the MCP process', sourceUrl: 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp', reviewedAt: R },
    { claim: 'Diagnosis accuracy', value: 'An LLM reading of the report and your repo. It can be wrong or name the wrong file; read it before you apply the fix.', sourceUrl: 'https://kensaur.us/mushi-mushi/docs/concepts/judge-loop', reviewedAt: R },
  ],
}

// ── Sentry ─────────────────────────────────────────────────────────────────

const SENTRY_PRICING = 'https://sentry.io/pricing/'
const SENTRY_PRICING_DOCS = 'https://docs.sentry.io/pricing/'
const SENTRY_SELF_HOSTED = 'https://develop.sentry.dev/self-hosted/'

export const SENTRY: Vendor = {
  name: 'Sentry',
  url: 'https://sentry.io/',
  whatItIs:
    'Error and performance monitoring: SDKs capture exceptions, traces and releases, and Seer is a paid AI debugging agent on top.',
  facts: [
    { claim: 'Free tier', value: 'Developer plan: $0, 5k errors, limited to one user', sourceUrl: SENTRY_PRICING, reviewedAt: R },
    { claim: 'Paid tiers', value: 'Team $26/mo · Business $80/mo, billed annually ($29 and $89 billed monthly) · Enterprise custom', sourceUrl: SENTRY_PRICING, reviewedAt: R },
    {
      claim: 'Seer (AI debugging agent)',
      value: 'An add-on to the Team or Business plan at $40 per active contributor per month, billed as its own monthly charge, separate from pay-as-you-go. An active contributor is anyone who opens two or more pull requests in a month to a Seer-enabled repo. The older $20-a-month-plus-credits pricing stopped being offered in January 2026.',
      sourceUrl: SENTRY_PRICING_DOCS,
      reviewedAt: R,
    },
    {
      claim: 'Self-host',
      value: 'Yes: getsentry/self-hosted (Docker Compose; 4 cores, 16 GB RAM + 16 GB swap, 20 GB disk). Seer is closed source and not available in self-hosted Sentry.',
      sourceUrl: SENTRY_SELF_HOSTED,
      reviewedAt: R,
    },
  ],
}

/** Pricing rows appended under `LANDING_COMPARISON_ROWS` on /compare/sentry-vs-mushi. */
export const SENTRY_PRICING_ROWS: readonly LandingComparisonRow[] = [
  {
    label: 'Free tier',
    foil: 'Developer: 5k errors/mo, one user',
    mushi: 'Free: 1 app, 100 diagnoses/mo, 1 seat, 14-day retention, no card',
  },
  {
    label: 'AI diagnosis',
    foil: 'Seer: $40 per active contributor per month, an add-on to Team ($26/mo billed annually) or Business',
    mushi: 'Included in every diagnosis, free tier onward',
  },
  {
    label: 'Self-host',
    foil: 'getsentry/self-hosted (no Seer); 4 cores / 16 GB RAM minimum',
    mushi: 'AGPLv3 server on your own Supabase project, one command; diagnosis with your own LLM key',
  },
]

export const SENTRY_FAQ: readonly FaqEntry[] = [
  {
    q: 'Is Mushi Mushi a replacement for Sentry?',
    a: 'It can be, or it can run alongside Sentry. Sentry is built around what the code threw, with a User Feedback widget and Session Replay alongside. Mushi Mushi starts from what the user reported, ingests Sentry\'s errors too, explains each one in plain English, and hands your agent a fix prompt to start from. One queue, with or without Sentry.',
  },
  {
    q: 'Can I run Mushi Mushi alongside Sentry?',
    a: 'Yes. Point a Sentry issue-alert webhook at Mushi Mushi and errors land in the same queue as user reports, deduped and diagnosed; that inbound path works on every plan. Resolving the Sentry issue when the Mushi Mushi fix merges also works on every plan, once you add a Sentry auth token under Integrations → Sentry. Setup is on the Sentry plugin page.',
  },
  {
    q: 'Does Sentry have an AI fix loop?',
    a: 'Seer is Sentry\'s AI debugging agent. Sentry sells it as an add-on to the Team or Business plan at $40 per active contributor per month, where an active contributor is anyone who opens two or more pull requests in a month to a Seer-enabled repo. It is billed as its own monthly charge, separate from pay-as-you-go, and it is not available in self-hosted Sentry.',
  },
  {
    q: 'What does Mushi Mushi cost?',
    a: 'Free covers one app and 100 diagnoses a month with no card. Builder is $29 a month for 3 apps, Studio $79 a month for 10. Self-hosting the AGPLv3 server is free.',
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
    mushi: '1 app, 100 diagnoses/mo, 1 seat, 14-day retention, no card',
  },
  {
    label: 'Paid entry',
    foil: '$14 per creator per month, billed yearly',
    mushi: '$29/mo Builder (3 apps, 1,000 diagnoses)',
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
    a: 'Mostly for people on or near the team. Jam is a Chrome extension a teammate, tester or support agent uses to record a bug; Recording Links let someone outside the workspace record too. Mushi Mushi is an SDK inside your production app, so the person who hit the bug reports it without installing anything.',
  },
  {
    q: 'Can I use Jam and Mushi Mushi together?',
    a: 'Yes, and it is a sensible split: Jam for internal QA and support recordings, Mushi Mushi for reports from real users in production and for the diagnosis-to-fix loop in your editor. There is no direct integration between the two today.',
  },
  {
    q: 'Which one gives my coding agent more?',
    a: 'Both have MCP. Jam\'s MCP hands the recording\'s console and network logs to your agent. Mushi Mushi\'s MCP hands over the plain-English diagnosis, the fix context scoped to files, past lessons, and can dispatch a draft PR.',
  },
  {
    q: 'What do the free tiers cover?',
    a: 'Jam Free (2026-10-29): 30 Jams a month, recordings up to 5 minutes, 5 Recording Links, 5 creator seats. Mushi Mushi Free: one app, 100 diagnoses a month, no card, unlimited reports.',
  },
]

// ── PostHog ────────────────────────────────────────────────────────────────

const POSTHOG_PRICING = 'https://posthog.com/pricing'
const POSTHOG_ERROR_TRACKING = 'https://posthog.com/docs/error-tracking/surfaces/web-app'
const POSTHOG_SELF_DRIVING_PRICING = 'https://posthog.com/docs/self-driving/pricing'

export const POSTHOG: Vendor = {
  name: 'PostHog',
  url: 'https://posthog.com/',
  whatItIs:
    'A product-analytics platform with session replay, error tracking, feature flags, surveys and more, priced per product with a monthly free allowance on each.',
  facts: [
    { claim: 'Session replay free tier', value: '5K recordings per month', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Error tracking free tier', value: '100K exceptions per month', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Analytics free tier', value: '1M events per month', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Free plan limits', value: 'No credit card; 1 project; 1-year data retention', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Open source', value: 'An MIT-licensed open-source product is available (pricing page FAQ)', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'AI free tier', value: '500 PostHog AI credits per month (worth $5) and 3 pull requests per month from the Inbox (beta)', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    {
      claim: 'AI on errors',
      value: 'In the web app you can ask PostHog AI to search your issues and work out the root cause from the stack trace. Every error-tracking issue has a "Fix with AI" button that writes a fix or explain prompt for PostHog AI or a coding assistant.',
      sourceUrl: POSTHOG_ERROR_TRACKING,
      reviewedAt: R,
    },
    {
      claim: 'AI pull requests',
      value: 'Self-driving (open beta) turns recurring high-impact errors into Inbox reports and, when a code fix is possible, opens a draft pull request for you to review. The first 3 PRs each month are free, then $15 per PR.',
      sourceUrl: POSTHOG_SELF_DRIVING_PRICING,
      reviewedAt: R,
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
    foil: 'You read the exception and the replay, or ask PostHog AI to find the root cause',
    mushi: 'Mushi Mushi writes the diagnosis: what broke, why, which files',
  },
  {
    label: 'Bugs that never throw',
    foil: 'Visible in replay if you know which session to open',
    mushi: 'The user tells you, and the report carries the screen they were looking at',
  },
  {
    label: 'Editor hand-off',
    foil: '"Fix with AI" on each error issue writes a fix prompt for PostHog AI or your coding assistant',
    mushi: 'MCP: diagnosis, fix context and lessons in Cursor / Claude Code',
  },
  {
    label: 'Draft pull requests',
    foil: 'Self-driving (open beta) opens one for recurring high-impact errors: 3 free a month, then $15 per PR',
    mushi: 'Optional agent-drafted PR from any report',
  },
  {
    label: 'Product analytics',
    foil: 'Full suite: 1M events/mo free',
    mushi: 'Basic: track(), funnels, paths, people, retention in the same console',
  },
  {
    label: 'Free tier',
    foil: '5K replays + 100K exceptions/mo, 500 AI credits, 3 AI PRs, no card, 1 project',
    mushi: '1 app, 100 diagnoses/mo, 1 seat, 14-day retention, no card',
  },
  {
    label: 'Self-host',
    foil: 'MIT open-source product available',
    mushi: 'Free, AGPLv3 server, MIT SDKs',
  },
]

export const POSTHOG_FAQ: readonly FaqEntry[] = [
  {
    q: 'Does Mushi Mushi replace PostHog session replay?',
    a: 'No. PostHog records every session; Mushi Mushi records the moment a user reports a bug, with the screenshot and console/network tail, and then writes the diagnosis. Keep PostHog for replay and product analytics; add Mushi Mushi when you want the report to arrive already explained.',
  },
  {
    q: 'Does PostHog fix errors with AI?',
    a: 'Yes, in two ways. Every error-tracking issue has a "Fix with AI" button that writes a fix or explain prompt for PostHog AI or a coding assistant, and PostHog AI can search errors and find their root cause. Self-driving, in open beta, turns recurring high-impact errors into Inbox reports and opens a draft pull request when a code fix is possible: 3 a month free, then $15 per PR. Both are on PostHog\'s free plan (500 AI credits and 3 PRs a month). The difference with Mushi Mushi is where it starts: PostHog works from the exceptions it captured; Mushi Mushi starts from what a user reported, with their screenshot, writes a plain-English diagnosis (100 a month on Free, unlimited self-hosted with your own key), and pulls the fix context into Cursor or Claude Code over MCP.',
  },
  {
    q: 'Can I run PostHog and Mushi Mushi together?',
    a: 'Yes. They do not conflict in the browser. There is no PostHog plugin for Mushi Mushi today, so a report will not deep-link to the PostHog replay; you can add the PostHog session id to Mushi Mushi metadata yourself.',
  },
  {
    q: 'Does Mushi Mushi do product analytics?',
    a: 'A basic version: Mushi.track() with funnels, paths, people and retention in the same console, 90-day retention by default. PostHog is the fuller analytics product; Mushi Mushi\'s is there so a solo builder does not need a second tool to see a funnel.',
  },
  {
    q: 'What do the free tiers cover?',
    a: 'PostHog (2026-10-29): 5K session recordings, 100K exceptions and 1M analytics events a month, 500 PostHog AI credits (worth $5) and 3 Inbox pull requests a month, no card, one project, one-year retention. Mushi Mushi: one app and 100 diagnoses a month, no card; self-hosting is free.',
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
  /** The page most of the row was read from (usually the pricing page). */
  sourceUrl: string
  /** Primary pages for the cells `sourceUrl` does not cover, e.g. self-host docs or the AI product page. */
  moreSources?: readonly { label: string; url: string }[]
  unverified?: boolean
}

const BUGSNAG_PRICING = 'https://www.bugsnag.com/pricing/'
const BUGSNAG_ON_PREMISE = 'https://docs.bugsnag.com/on-premise/'
const BUGSNAG_HOME = 'https://www.bugsnag.com/'
const ROLLBAR_PRICING = 'https://rollbar.com/pricing'
const ROLLBAR_RESOLVE = 'https://rollbar.com/resolve'
const ROLLBAR_CLOUD_ONLY = 'https://rollbar.com/blog/sentry-alternatives/'
const HIGHLIGHT_REPO = 'https://github.com/highlight/highlight'
const HIGHLIGHT_MIGRATION = 'https://github.com/highlight/highlight/blob/main/blog-content/launchdarkly-migration.md'
const LAUNCHDARKLY_PRICING = 'https://launchdarkly.com/pricing/'

export const ALTERNATIVES: readonly AlternativeRow[] = [
  {
    vendor: 'Sentry',
    url: 'https://sentry.io/',
    freeTier: 'Developer: 5k errors/mo, one user',
    selfHost: 'Yes, getsentry/self-hosted (Docker; 4 cores / 16 GB RAM); no Seer',
    aiFix: 'Seer: $40 per active contributor/mo, an add-on to Team ($26/mo), Business or Enterprise',
    pickIf: 'You want the deepest error, tracing and release tooling and expect to grow into a team plan.',
    sourceUrl: SENTRY_PRICING,
    moreSources: [
      { label: 'Seer billing', url: SENTRY_PRICING_DOCS },
      { label: 'self-host', url: SENTRY_SELF_HOSTED },
    ],
  },
  {
    vendor: 'Bugsnag',
    url: BUGSNAG_HOME,
    freeTier: 'Free: $0, 1 user, 7.5K events + 1M spans/mo, 7-day retention',
    selfHost: 'Yes: the Preferred plan includes "On premises or SaaS deployment"',
    aiFix: 'None on the pricing page; SmartBear\'s MCP server offers AI-powered fix suggestions in your IDE',
    pickIf: 'You want error and performance monitoring free for one person, with paid Select and Preferred plans priced by event volume and an on-premise option if you ever need one.',
    sourceUrl: BUGSNAG_PRICING,
    moreSources: [
      { label: 'on-premise', url: BUGSNAG_ON_PREMISE },
      { label: 'MCP', url: BUGSNAG_HOME },
    ],
  },
  {
    vendor: 'Rollbar',
    url: 'https://rollbar.com/',
    freeTier: 'Free: 5,000 occurrences + 1,000 session replays/mo, 0 included credits',
    selfHost: 'No, cloud-only',
    aiFix: 'Rollbar Resolve: works out what is wrong, writes a fix, runs your tests in an isolated environment, then opens a PR. It runs on credits; the Free plan includes none',
    pickIf: 'Your volume is low, you want a small replay allowance for free, cloud-only is fine, and you would pay for AI credits to get fix PRs.',
    sourceUrl: ROLLBAR_PRICING,
    moreSources: [
      { label: 'Resolve', url: ROLLBAR_RESOLVE },
      { label: 'cloud-only', url: ROLLBAR_CLOUD_ONLY },
    ],
  },
  {
    vendor: 'highlight.io (now LaunchDarkly)',
    url: HIGHLIGHT_REPO,
    freeTier: 'Hosted highlight.io shut down on 2026-02-28. The hosted free path is LaunchDarkly Developer: $0, 5K session replays, 5K errors, 10M logs, 10M traces/mo',
    selfHost: 'Yes, from the open-source repo: a one-line Docker hobby install for under 10k sessions and 50k errors/mo',
    aiFix: 'None listed in the open-source README',
    pickIf: 'You want replay, errors, logs and traces in one open-source box you run yourself at hobby scale, or you are happy to move to LaunchDarkly for the hosted version.',
    sourceUrl: HIGHLIGHT_MIGRATION,
    moreSources: [
      { label: 'LaunchDarkly pricing', url: LAUNCHDARKLY_PRICING },
      { label: 'self-host', url: HIGHLIGHT_REPO },
    ],
  },
  {
    vendor: 'PostHog',
    url: 'https://posthog.com/',
    freeTier: '5K replays + 100K exceptions + 1M events/mo, 500 AI credits, no card, 1 project',
    selfHost: 'MIT open-source product available',
    aiFix: '"Fix with AI" prompt on every error issue; Self-driving (open beta) opens draft PRs for recurring errors, 3 free/mo then $15 per PR',
    pickIf: 'You already want product analytics and replay, and error tracking can ride along.',
    sourceUrl: POSTHOG_PRICING,
    moreSources: [
      { label: 'Fix with AI', url: POSTHOG_ERROR_TRACKING },
      { label: 'PR pricing', url: POSTHOG_SELF_DRIVING_PRICING },
    ],
  },
  {
    vendor: 'Mushi Mushi',
    url: 'https://kensaur.us/mushi-mushi/',
    freeTier: 'Free: 1 app, 100 diagnoses/mo (hard stop), 1 seat, 14-day retention, no card',
    selfHost: 'Yes, free, AGPLv3 server on your own Supabase project, one command; bring your own Anthropic key',
    aiFix: 'Included within the plan\'s diagnosis quota (100/mo on Free): plain-English diagnosis + fix prompt, which can be wrong; MCP into Cursor / Claude Code; optional agent-drafted PR',
    pickIf: 'You did not write most of the code, your users tell you about bugs, and you want the fix in your editor.',
    sourceUrl: MUSHI_PRICING,
  },
]

export const ALTERNATIVES_FAQ: readonly FaqEntry[] = [
  {
    q: 'What is the cheapest way to get error tracking as a solo founder?',
    a: 'Every tool on this page has a $0 plan: Sentry Developer, Bugsnag Free, Rollbar Free, LaunchDarkly Developer (where hosted highlight.io went), PostHog and Mushi Mushi Free. Sentry, PostHog and Mushi Mushi can also be self-hosted for free, and highlight.io\'s open-source repo documents a free hobby install. Bugsnag offers on-premises deployment on its Preferred plan, and Rollbar is cloud-only. The real cost is the afternoon you spend reading what they collected.',
  },
  {
    q: 'Which of these explain the bug instead of showing a stack trace?',
    a: 'Most now have something. Sentry\'s Seer is an add-on to Team or Business at $40 per active contributor per month. Rollbar Resolve works out what is wrong, writes a fix, runs your tests in an isolated environment and opens a pull request, using credits the Free plan does not include. PostHog has a "Fix with AI" prompt on every error issue and, in open beta, draft pull requests for recurring errors: 3 a month free, then $15 each. Bugsnag\'s pricing page lists no AI feature; SmartBear\'s MCP server offers AI fix suggestions in the IDE. Mushi Mushi writes a plain-English diagnosis on every plan: up to 100 a month on Free (a hard stop; later reports are kept but not diagnosed until next month), 1,000 included on Builder, and unlimited self-hosted with your own LLM key. Like the others, it is an AI reading and can be wrong. The report it starts from is what a user said and saw, not only what threw.',
  },
  {
    q: 'Do I have to rip out Sentry to try Mushi Mushi?',
    a: 'No. Mushi Mushi runs standalone or alongside Sentry: a Sentry issue-alert webhook sends errors into Mushi Mushi\'s queue on every plan, and once you add a Sentry auth token under Integrations → Sentry, merging the fix resolves the Sentry issue.',
  },
  {
    q: 'How current is this page?',
    a: 'Every number was read on 2026-10-29 from the vendor\'s own pages, linked under each tool\'s name. A value that cannot be confirmed on a review date is marked unverified or removed instead of guessed. The next scheduled review is 2027-01-29.',
  },
]

// ── Agency feedback tools: Marker.io, BugHerd, Userback ───────────────────
// Read on AGENCY_FACTS_REVIEWED_AT from each vendor's own pricing and help
// pages. This page keeps its own review date: the other pages were not
// re-read on that day, so FACTS_REVIEWED_AT stays where it is.

const A = AGENCY_FACTS_REVIEWED_AT

const MARKER_PRICING = 'https://marker.io/pricing'
const MARKER_GUEST_ACCESS = 'https://help.marker.io/en/articles/9617051-issue-page-access'
const BUGHERD_PRICING = 'https://bugherd.com/pricing'
const BUGHERD_CLIENT_INVITES = 'https://support.bugherd.com/en/articles/11424313-get-feedback-from-clients-on-websites-and-files'
const USERBACK_PRICING = 'https://userback.io/pricing/'
const MUSHI_AGENCY_PAGE = 'https://kensaur.us/mushi-mushi/docs/use-cases/agency-client-apps'

export const MARKER: Vendor = {
  name: 'Marker.io',
  url: 'https://marker.io/',
  whatItIs:
    'A website feedback and issue tracking tool for teams that build sites for clients: a widget and browser extension for annotated reports, sent on to the tracker the team already uses.',
  facts: [
    { claim: 'Price', value: 'Starter $39/mo billed annually ($59 monthly) · Team $149/mo billed annually ($199 monthly) · Business custom. No free plan; a 15-day free trial with no card.', sourceUrl: MARKER_PRICING, reviewedAt: A },
    { claim: 'Team seats and projects', value: 'Starter: 3 members, up to 10 projects. Team: 15 members, up to 50 projects. Extra members $4 each on Starter and $6 on Team per month, billed annually.', sourceUrl: MARKER_PRICING, reviewedAt: A },
    { claim: 'Clients', value: 'Guests and reporters are free and unlimited on every plan, with no paid seat. A guest sees issues only on the projects they are invited to.', sourceUrl: MARKER_GUEST_ACCESS, reviewedAt: A },
    { claim: 'Internal comments', value: 'On every plan: comments clients and reporters never see.', sourceUrl: MARKER_PRICING, reviewedAt: A },
    { claim: 'Session replay, console logs and network requests', value: 'Team and Business only; not on Starter.', sourceUrl: MARKER_PRICING, reviewedAt: A },
    { claim: 'Custom branding', value: 'Team and Business only.', sourceUrl: MARKER_PRICING, reviewedAt: A },
    { claim: 'Security', value: 'SOC 2 Type II on every plan. SAML single sign-on on Business.', sourceUrl: MARKER_PRICING, reviewedAt: A },
    { claim: 'AI', value: 'AI translation, rewrite and automatic issue titles on every plan, and an MCP server so an AI agent can read the feedback and fix issues.', sourceUrl: MARKER_PRICING, reviewedAt: A },
  ],
}

export const BUGHERD: Vendor = {
  name: 'BugHerd',
  url: 'https://bugherd.com/',
  whatItIs:
    'A website feedback tool built around pinning comments to the page and a task board, for agencies collecting feedback from clients.',
  facts: [
    { claim: 'Price', value: 'Standard $50/mo ($42 billed annually) · Studio $80/mo ($67) · Premium $150/mo ($125) · Custom on request. No free plan; a 7-day free trial with no card.', sourceUrl: BUGHERD_PRICING, reviewedAt: A },
    { claim: 'Team seats and projects', value: 'Standard 5 members, Studio 10, Premium 25. Unlimited projects on every plan. Extra members $8 each per month.', sourceUrl: BUGHERD_PRICING, reviewedAt: A },
    { claim: 'Clients', value: 'Unlimited guests (clients and stakeholders) on every plan. Guests are invited to a project.', sourceUrl: BUGHERD_CLIENT_INVITES, reviewedAt: A },
    { claim: 'Client task board and member-only comments', value: 'Premium and above: a guest task board, member-only commenting, and a choice of whether guests see member feedback.', sourceUrl: BUGHERD_PRICING, reviewedAt: A },
    { claim: 'Video feedback', value: 'On every plan.', sourceUrl: BUGHERD_PRICING, reviewedAt: A },
    { claim: 'Custom branding', value: 'Premium and above.', sourceUrl: BUGHERD_PRICING, reviewedAt: A },
    { claim: 'Security', value: 'Single sign-on and a 99.9% uptime SLA on the Custom plan. The pricing page does not mention SOC 2.', sourceUrl: BUGHERD_PRICING, reviewedAt: A },
    { claim: 'AI', value: 'MCP and automatic titles on every plan (beta); automatic tagging and similar-task detection on Premium (beta).', sourceUrl: BUGHERD_PRICING, reviewedAt: A },
  ],
}

export const USERBACK: Vendor = {
  name: 'Userback',
  url: 'https://userback.io/',
  whatItIs:
    'A user feedback platform: a widget and browser extension for annotated feedback and bug reports, a kanban board to manage them, and surveys and a feature portal on higher plans.',
  facts: [
    { claim: 'Price', value: 'Free forever $0 · Team $39/mo billed annually ($49 monthly) · Business $89/mo ($119) · Business Plus $159/mo ($199).', sourceUrl: USERBACK_PRICING, reviewedAt: A },
    { claim: 'Free plan', value: '2 sites, 2 seats, unlimited feedback, but feedback can be viewed for 7 days only.', sourceUrl: USERBACK_PRICING, reviewedAt: A },
    { claim: 'Team seats and sites', value: 'Team: 5 sites, 5 seats. Business: 25 sites, 15 seats. Business Plus: 50 sites, 25 seats. Extra seats $7 each per month billed annually, on Business and above.', sourceUrl: USERBACK_PRICING, reviewedAt: A },
    { claim: 'Clients', value: 'Unlimited reporters on every plan, with no seat. Team member roles can grant access to specific projects.', sourceUrl: USERBACK_PRICING, reviewedAt: A },
    { claim: 'Session replay, console logs and network requests', value: 'Business and above; not on Free or Team.', sourceUrl: USERBACK_PRICING, reviewedAt: A },
    { claim: 'Mobile SDK', value: 'Business Plus only.', sourceUrl: USERBACK_PRICING, reviewedAt: A },
    { claim: 'Remove the Userback logo', value: 'Business Plus only.', sourceUrl: USERBACK_PRICING, reviewedAt: A },
    { claim: 'Board and internal comments', value: 'A kanban board on every plan. Team comment controls (internal-only comments for some members) on Business and above.', sourceUrl: USERBACK_PRICING, reviewedAt: A },
    { claim: 'AI', value: 'MCP connectors from Team; AI insights (patterns, sentiment) on Business and above.', sourceUrl: USERBACK_PRICING, reviewedAt: A },
  ],
}

/** Mushi Mushi's own facts for the agency page, from the code and the pages linked. */
export const MUSHI_FOR_AGENCIES: Vendor = {
  name: 'Mushi Mushi',
  url: 'https://kensaur.us/mushi-mushi/',
  whatItIs:
    'An in-app bug reporter: the person using the app reports from a widget, and Mushi Mushi writes the likely cause in plain English with a fix prompt for Cursor, Claude Code, Lovable or Bolt.',
  facts: [
    { claim: 'Price', value: 'Free $0 (1 app, 100 diagnoses a month, no card) · Builder $29/mo (3 apps) · Studio $79/mo (10 apps, 5 seats). A paid plan is attached to one app: that app gets the plan\'s diagnoses (1,000 on Builder, 3,000 on Studio) and the other apps in the team keep 100 a month until they are upgraded too.', sourceUrl: MUSHI_PRICING, reviewedAt: A },
    { claim: 'Clients', value: 'No free guest seats. A client who signs in takes one of the 5 Studio seats, and every member of a team, a read-only Viewer included, can read every app in that team. To show a client only their own app, give it its own team.', sourceUrl: MUSHI_AGENCY_PAGE, reviewedAt: A },
    { claim: 'Task board, internal comments, video', value: 'None of these. Reports sit in a list with filters, and can be sent on to Linear, Jira or GitHub Issues. No video feedback; the web SDK has an optional session replay setting that is off unless you turn it on.', sourceUrl: 'https://kensaur.us/mushi-mushi/docs/migrations/bugherd-to-mushi', reviewedAt: A },
    { claim: 'Console and network logs', value: 'On every plan, Free included: the last console and network events arrive with each report.', sourceUrl: 'https://kensaur.us/mushi-mushi/docs/sdks/web', reviewedAt: A },
    { claim: 'A written cause and a fix prompt', value: 'On every plan: each bug gets a plain-English diagnosis and a prompt to paste into an AI editor. It is an AI\'s reading and can be wrong; check it before you ship.', sourceUrl: MUSHI_PRICING, reviewedAt: A },
    { claim: 'Mobile SDKs', value: 'React Native and Capacitor SDKs on every plan, Free included. Native iOS, Android and Flutter libraries are previews.', sourceUrl: 'https://kensaur.us/mushi-mushi/docs/quickstart/mobile', reviewedAt: A },
    { claim: 'Brand mark on the widget', value: 'None on Builder and Studio. On Free, a small "Bug reports by Mushi Mushi" link that you can turn off in Settings.', sourceUrl: MUSHI_AGENCY_PAGE, reviewedAt: A },
    { claim: 'Security', value: 'No SOC 2 report. Mushi Mushi collects evidence toward one; that is not a certification. SAML single sign-on on Enterprise.', sourceUrl: 'https://kensaur.us/mushi-mushi/docs/security/soc2', reviewedAt: A },
    { claim: 'Self-host', value: 'Yes, free: MIT SDKs and an AGPLv3 server you can run yourself.', sourceUrl: `${MUSHI_REPO}/blob/master/SELF_HOSTED.md`, reviewedAt: A },
  ],
}

export const AGENCY_ROWS: readonly LandingComparisonRow[] = [
  {
    label: 'Who presses the button',
    foil: 'Mostly your client and your own team, reviewing a site you are building or maintaining',
    mushi: 'The people using the finished app, in production',
  },
  {
    label: 'Free client access',
    foil: 'Yes, on all three: unlimited guests or reporters without a paid seat',
    mushi: 'No. A client who signs in takes a seat',
  },
  {
    label: 'A client sees only their own project',
    foil: 'Yes: guests are invited per project (Marker.io, BugHerd); roles can grant access to specific projects (Userback)',
    mushi: 'Only if that client\'s app is in its own team. A member reads every app in a team',
  },
  {
    label: 'Task board for the client',
    foil: 'BugHerd (guest task board on Premium) and Userback (kanban board) have one; Marker.io has its own issue list with statuses and sends issues to your tracker',
    mushi: 'No board. A list with filters, and sync to Linear, Jira or GitHub Issues',
  },
  {
    label: 'Comments the client cannot see',
    foil: 'Marker.io on every plan; BugHerd on Premium; Userback on Business',
    mushi: 'No',
  },
  {
    label: 'Video or session replay',
    foil: 'BugHerd: video feedback on every plan. Marker.io: session replay from Team. Userback: session replay from Business',
    mushi: 'No video. An optional replay setting in the web SDK, off by default',
  },
  {
    label: 'Console and network logs',
    foil: 'Marker.io from Team; Userback from Business. BugHerd lists "technical data" (browser, OS, screen size) on every plan',
    mushi: 'On every plan, Free included',
  },
  {
    label: 'What you read first',
    foil: 'The client\'s comment, pinned to the page with a screenshot',
    mushi: 'The likely cause in plain English, with a fix prompt for your AI editor',
  },
  {
    label: 'Phone apps',
    foil: 'Userback has a mobile SDK on Business Plus. The Marker.io and BugHerd pricing pages list none',
    mushi: 'React Native and Capacitor SDKs on every plan',
  },
  {
    label: 'Your own brand, no vendor mark',
    foil: 'Marker.io from Team; BugHerd on Premium; Userback removes its logo on Business Plus',
    mushi: 'No Mushi Mushi mark from Builder; on Free you can turn it off',
  },
  {
    label: 'SOC 2',
    foil: 'Marker.io: SOC 2 Type II on every plan',
    mushi: 'No SOC 2 report',
  },
  {
    label: 'Run it yourself',
    foil: 'None of the three pricing pages offers it',
    mushi: 'Yes, free (AGPLv3 server)',
  },
]

export const AGENCY_FAQ: readonly FaqEntry[] = [
  {
    q: 'Can my clients use Mushi Mushi for free, the way guests work in Marker.io or BugHerd?',
    a: 'Not as signed-in guests. Marker.io, BugHerd and Userback all let unlimited clients send and follow feedback without a paid seat. In Mushi Mushi anyone can send a report from the widget for free and follow it there, but a client who signs in to the console takes one of the 5 seats on Studio.',
  },
  {
    q: 'Can a client see only their own project in Mushi Mushi?',
    a: 'Only if their app is in its own team. An invitation is to a team, and every member, a read-only Viewer included, can read every app in it. Marker.io and BugHerd invite guests per project, and Userback roles can grant access to specific projects.',
  },
  {
    q: 'Which is cheaper for eight client sites?',
    a: 'It depends on what you count. On 2026-11-11, BugHerd Standard was $50 a month with unlimited projects and 5 members, and Marker.io Starter was $39 a month billed annually for up to 10 projects and 3 members. Mushi Mushi Studio is $79 a month for a team of up to 10 apps and 5 seats, with 3,000 diagnoses a month shared by all of them.',
  },
  {
    q: 'What does Mushi Mushi do that these three do not?',
    a: 'It is built for the people using the finished app rather than for a client reviewing a build, and it writes the likely cause of each bug in plain English with a fix prompt for Cursor, Claude Code, Lovable or Bolt. Console and network logs and the React Native and Capacitor SDKs are on the free plan, and you can run the whole thing yourself.',
  },
  {
    q: 'When should I pick one of the others?',
    a: 'When the job is collecting feedback from a client during a build: free guest seats, a board the client can follow, comments they cannot see, video, and, with Marker.io, a SOC 2 Type II report. Mushi Mushi has none of those.',
  },
  {
    q: 'How current is this page?',
    a: 'Every number was read on 2026-11-11 from the vendor\'s own pricing or help page, linked in each row. A value that cannot be confirmed on a review date is marked unverified or removed.',
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
