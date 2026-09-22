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

interface Fact {
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
    { claim: 'Free tier', value: 'Free Cloud: 50 diagnoses per month (hard stop; later reports are kept, not diagnosed), 1 seat, 7-day retention, no card', sourceUrl: MUSHI_PRICING, reviewedAt: R },
    { claim: 'Paid tiers', value: 'Indie $15/mo (500 diagnoses) · Pro $49/mo (2,000 diagnoses)', sourceUrl: MUSHI_PRICING, reviewedAt: R },
    { claim: 'License', value: 'SDKs MIT; server AGPLv3', sourceUrl: `${MUSHI_REPO}/blob/master/LICENSE`, reviewedAt: R },
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
    { claim: 'Paid tiers', value: 'Team $26/mo · Business $80/mo · Enterprise custom', sourceUrl: SENTRY_PRICING, reviewedAt: R },
    {
      claim: 'Seer (AI debugging agent)',
      value: 'An add-on to the Team, Business or Enterprise plan at $40 per active contributor per month, billed as its own monthly charge, separate from pay-as-you-go. An active contributor is anyone who opens two or more pull requests in a month to a Seer-enabled repo. The older $20-a-month-plus-credits pricing stopped being offered in January 2026.',
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
    mushi: 'Free Cloud: 50 diagnoses/mo, 1 seat, 7-day retention, no card',
  },
  {
    label: 'AI diagnosis',
    foil: 'Seer: $40 per active contributor per month, an add-on to Team ($26/mo), Business or Enterprise',
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
    q: 'Is Mushi a replacement for Sentry?',
    a: 'It can be, or it can run alongside Sentry. Sentry is built around what the code threw, with a User Feedback widget and Session Replay alongside. Mushi starts from what the user reported, ingests Sentry\'s errors too, explains each one in plain English, and hands your agent a fix prompt to start from. One queue, with or without Sentry.',
  },
  {
    q: 'Can I run Mushi alongside Sentry?',
    a: 'Yes. Point a Sentry issue-alert webhook at Mushi and errors land in the same queue as user reports, deduped and diagnosed; that inbound path works on every plan. Resolving the Sentry issue when the Mushi fix merges needs the outbound Sentry plugin, which is on Indie and above or self-hosted. Setup is on the Sentry plugin page.',
  },
  {
    q: 'Does Sentry have an AI fix loop?',
    a: 'Seer is Sentry\'s AI debugging agent. Sentry sells it as an add-on to the Team, Business or Enterprise plan at $40 per active contributor per month, where an active contributor is anyone who opens two or more pull requests in a month to a Seer-enabled repo. It is billed as its own monthly charge, separate from pay-as-you-go, and it is not available in self-hosted Sentry.',
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
    mushi: '50 diagnoses/mo, 1 seat, 7-day retention, no card',
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
const POSTHOG_ERROR_TRACKING = 'https://posthog.com/docs/error-tracking'
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
    { claim: 'Free plan limits', value: 'No credit card; 1 project; 1-year data retention; usage stops at the free limits', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'Open source', value: 'An MIT-licensed open-source product is available (pricing page FAQ)', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    { claim: 'AI free tier', value: '500 PostHog AI credits per month (worth $5) and 3 pull requests per month from the Inbox (beta)', sourceUrl: POSTHOG_PRICING, reviewedAt: R },
    {
      claim: 'AI on errors',
      value: 'PostHog AI can search errors and find their root cause in the web app. Every error-tracking issue has a "Fix with AI" button that writes a fix or explain prompt for PostHog AI or a coding assistant.',
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
    mushi: 'Mushi writes the diagnosis: what broke, why, which files',
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
    mushi: '50 diagnoses/mo, 1 seat, 7-day retention, no card',
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
    q: 'Does PostHog fix errors with AI?',
    a: 'Yes, in two ways. Every error-tracking issue has a "Fix with AI" button that writes a fix or explain prompt for PostHog AI or a coding assistant, and PostHog AI can search errors and find their root cause. Self-driving, in open beta, turns recurring high-impact errors into Inbox reports and opens a draft pull request when a code fix is possible: 3 a month free, then $15 per PR. Both are on PostHog\'s free plan (500 AI credits and 3 PRs a month). The difference with Mushi is where it starts: PostHog works from the exceptions it captured; Mushi starts from what a user reported, with their screenshot, writes a plain-English diagnosis (50 a month on Free Cloud, unlimited self-hosted with your own key), and pulls the fix context into Cursor or Claude Code over MCP.',
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
    a: 'PostHog (2026-09-21): 5K session recordings, 100K exceptions and 1M analytics events a month, 500 PostHog AI credits (worth $5) and 3 Inbox pull requests a month, no card, one project, one-year retention. Mushi: 50 diagnoses a month, no card; self-hosting is free.',
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
    selfHost: 'Yes, an "On-premise" edition on the Enterprise plan only; price on request',
    aiFix: 'None on the pricing page; SmartBear\'s MCP server (beta) offers AI fix suggestions in your IDE',
    pickIf: 'You want error and performance monitoring free for one person, with a paid step from $20/mo (Select) and an on-premise option if you ever need one.',
    sourceUrl: BUGSNAG_PRICING,
    moreSources: [
      { label: 'on-premise', url: BUGSNAG_ON_PREMISE },
      { label: 'MCP', url: BUGSNAG_HOME },
    ],
  },
  {
    vendor: 'Rollbar',
    url: 'https://rollbar.com/',
    freeTier: 'Free: 5,000 occurrences + 1,000 session replays/mo; Essentials from $9/mo for 10,000 occurrences',
    selfHost: 'No, cloud-only',
    aiFix: 'Rollbar Resolve (public beta): root cause, a code change tested in a sandbox, and a PR. Needs AI credits and the Rollbar GitHub App; the Free plan includes none',
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
    freeTier: 'Free Cloud: 50 diagnoses/mo (hard stop), 1 seat, 7-day retention, no card',
    selfHost: 'Yes, free, AGPLv3 server on your own Supabase project, one command; bring your own Anthropic key',
    aiFix: 'Included within the plan\'s diagnosis quota (50/mo on Free Cloud): plain-English diagnosis + fix prompt, which can be wrong; MCP into Cursor / Claude Code; optional agent-drafted PR',
    pickIf: 'You did not write most of the code, your users tell you about bugs, and you want the fix in your editor.',
    sourceUrl: MUSHI_PRICING,
  },
]

export const ALTERNATIVES_FAQ: readonly FaqEntry[] = [
  {
    q: 'What is the cheapest way to get error tracking as a solo founder?',
    a: 'Every tool on this page has a $0 plan: Sentry Developer, Bugsnag Free, Rollbar Free, LaunchDarkly Developer (where hosted highlight.io went), PostHog and Mushi Free Cloud. Sentry, PostHog and Mushi can also be self-hosted for free, and highlight.io\'s open-source repo documents a free hobby install. Bugsnag\'s on-premise edition is Enterprise-only, and Rollbar is cloud-only. The real cost is the afternoon you spend reading what they collected.',
  },
  {
    q: 'Which of these explain the bug instead of showing a stack trace?',
    a: 'Most now have something. Sentry\'s Seer is an add-on to Team, Business or Enterprise at $40 per active contributor per month. Rollbar Resolve (public beta) finds the root cause, writes a code change, runs your tests in a sandbox and opens a pull request, using AI credits the Free plan does not include. PostHog has a "Fix with AI" prompt on every error issue and, in open beta, draft pull requests for recurring errors: 3 a month free, then $15 each. Bugsnag\'s pricing page lists no AI feature; SmartBear\'s MCP server, in beta, offers AI fix suggestions in the IDE. Mushi writes a plain-English diagnosis on every plan: up to 50 a month on Free Cloud (a hard stop; later reports are kept but not diagnosed until next month), 500 included on Indie, and unlimited self-hosted with your own LLM key. Like the others, it is an AI reading and can be wrong. The report it starts from is what a user said and saw, not only what threw.',
  },
  {
    q: 'Do I have to rip out Sentry to try Mushi?',
    a: 'No. Mushi runs standalone or alongside Sentry: a Sentry issue-alert webhook sends errors into Mushi\'s queue on every plan, and with the outbound Sentry plugin (Indie and above, or self-hosted) merging the fix resolves the Sentry issue.',
  },
  {
    q: 'How current is this page?',
    a: 'Every number was read on 2026-09-21 from the vendor\'s own pages, linked under each tool\'s name. A value that cannot be confirmed on a review date is marked unverified instead of guessed. The next scheduled review is 2026-12-21.',
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
