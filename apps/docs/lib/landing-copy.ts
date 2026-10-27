/**
 * Visitor-facing copy for the docs landing page.
 * SSOT for section prose — hero/category strings re-export from @mushi-mushi/brand.
 */
import { MUSHI_CANONICAL_URLS, MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'
import { ADMIN_DEMO_BASE } from '../data/admin-screenshots'

/** EditorialHero — category eyebrow + lead (title stays JSX in index.mdx for <em>). */
export const LANDING_HERO = {
  eyebrow: MUSHI_TAGLINE_V2.category,
  /** One sentence of what and for whom; no paragraph before the first action. */
  lead:
    'For solo builders on Cursor or Claude Code: a user reports a bug, Mushi explains it in plain English and hands your AI the fix. No Sentry needed.',
  /**
   * Stage-fit proof under the actions: what it costs to try and what you can
   * read. No star count — at this stage a small number is anti-proof.
   */
  reassure: 'Free: 50 diagnoses a month, no card. Open source.',
  star: {
    label: 'Star on GitHub',
    href: MUSHI_CANONICAL_URLS.repo,
    ctaId: 'landing-star',
  },
} as const

/**
 * The hero's one-click start: three actions with three different jobs, so no
 * two buttons share an intent. `id` becomes `cta_click.cta_id` (and `?src=` on
 * the signup link); `landing-hero` stays on signup so the funnel keeps its
 * history. The Cursor deeplink is built in the component from the shared
 * MCP client registry (`buildOAuthInstall`), the same way /connect builds it.
 */
export const LANDING_HERO_START = {
  console: {
    id: 'landing-hero',
    label: 'Start free in the console',
    href: `${ADMIN_DEMO_BASE}/signup?src=landing-hero`,
  },
  cursor: {
    id: 'landing-hero-cursor',
    label: 'Add to Cursor',
  },
  npx: {
    id: 'landing-hero-npx',
    label: 'Add the report button to your app',
    cmd: 'npx mushi-mushi',
  },
  more: {
    // Was the hero's secondary button; the editor picker for every client.
    id: 'landing-connect',
    label: 'Other editors',
    href: '/connect',
  },
} as const

/** Pricing proof under the three start steps. */
export const LANDING_SIXTY_SECOND = {
  pricing:
    '50 diagnoses a month on the free plan, no card needed. You can also run it on your own server in under five minutes.',
} as const

/**
 * "Start in three steps" right under the pipeline: the same cycle as the
 * console sidebar (ADR 0027: connect, bugs come in, fix and review), worded
 * as a newcomer's first run and matching the quickstart page (install →
 * first report → first fix). Each step ends in what you should see.
 */
export const LANDING_HOW_IT_WORKS = {
  heading: 'Start in three steps',
  steps: [
    {
      title: 'Install',
      desc: 'Run one command in your app folder. It finds your framework, signs you in through the browser and adds the report button.',
      check: 'A report button in your app and a new project in the console.',
    },
    {
      title: 'Send a first report',
      desc: 'Tap the button and write one sentence, or let the wizard send a test report.',
      check: 'The report in your console with a plain-English diagnosis, in about 10 seconds.',
    },
    {
      title: 'Get your first fix',
      desc: 'Connect your AI editor in one click, then ask it: "Get the latest Mushi report and fix it."',
      check: 'A fix brief in your editor: the cause, the files to change and how to check it. You review the change before it ships.',
    },
  ],
} as const

/**
 * Editor install buttons inside step 3. Every editor button installs the
 * hosted server URL only (`buildOAuthInstall`), so the editor runs the Mushi
 * sign-in on first use; a static key header would switch that sign-in off.
 */
export const LANDING_ONE_CLICK = {
  note: 'No key to paste. The first time your editor calls Mushi, your browser opens so you can sign in (or sign up free).',
  cursorAlt: 'Add Mushi to Cursor',
  vscodeLabel: 'Install in VS Code',
  claudeLabel: 'Using Claude Code? Add Mushi with one command',
  npxCmd: 'npx mushi-mushi',
  moreLabel: 'Windsurf, Zed and more',
  moreHref: '/connect',
} as const

/** Landing FAQ — visible Q&A doubles as FAQPage JSON-LD (answers stay plain text). */
export interface LandingFaqItem {
  q: string
  a: string
}

export const LANDING_FAQ: readonly LandingFaqItem[] = [
  {
    q: 'What is Mushi Mushi, in plain terms?',
    a: 'A bug-report inbox with an AI that explains each bug. People who use your app can report a problem with one tap. Mushi turns each report into a short, plain-English explanation of what went wrong and how to fix it, and sends that to the AI assistant in your code editor so the fix can start right away. The name comes from 虫 (mushi), the Japanese word for "bug" or "insect".',
  },
  {
    q: 'Who makes it, and can I use it today?',
    a: 'Mushi Mushi is built by Kensaurus 合同会社, a small company in Japan, and it runs on the company\'s own apps and sites. The hosted service is live, the libraries are published on npm, and the source code is public on GitHub. The native iOS, Android and Flutter libraries are still previews.',
  },
  {
    q: 'Is Mushi Mushi a Sentry alternative?',
    a: "It can be, or it can run alongside Sentry. Sentry is built around what the code threw, with a User Feedback widget and replay alongside. Mushi starts from what the user reported, ingests Sentry's errors too, explains each one in plain English, and hands your agent a fix prompt to start from. One queue, with or without Sentry.",
  },
  {
    q: 'Do I need Sentry to use it?',
    a: 'No. Mushi works on its own. If you already use Sentry (a popular service that records errors when code crashes), you can point its alerts at Mushi. Those errors then land in the same list as user reports, with duplicates merged, each one explained in plain English and marked resolved in Sentry when the fix is merged.',
  },
  {
    q: 'What does npx mushi-mushi do?',
    a: 'It runs a setup wizard. The wizard works out which framework your app uses (React, Next.js, Vue, Nuxt, Svelte, Angular, React Native, Expo, Capacitor or Node), installs the matching Mushi library, saves your settings (environment variables) and prints the snippet to paste.',
  },
  {
    q: 'How do I debug an app that Cursor or Claude Code wrote?',
    a: 'Connect your editor to Mushi with the command npx mushi-mushi setup --ide cursor (it uses MCP, the standard way AI editors connect to outside tools). Bug reports then arrive as plain-English diagnoses your AI assistant can read, with a fix prompt ready to apply without leaving the editor.',
  },
  {
    q: 'Is it open source? Can I self-host?',
    a: 'Yes. The libraries you add to your app (SDKs) are MIT-licensed and the server is AGPLv3. You can run the whole thing on your own server with one command, or use the hosted free plan: 50 diagnoses a month, no card.',
  },
  {
    q: 'Which frameworks are supported?',
    a: 'Web: React, Vue, Svelte, Angular, and any other site through the browser widget. Mobile: React Native and Capacitor. Server: Node. One wizard installs any of them. Native iOS, Android and Flutter SDKs are previews and install from the GitHub repo.',
  },
] as const

export const LANDING_MEDIA_INTRO =
  'The Mushi dashboard, the report button on a real app (glot.it), and light and dark screenshots. Click a picture to open the live page.'

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export const LANDING_WHAT_THIS_IS = {
  /**
   * One plain "Mushi Mushi is …" sentence, the shape answer engines lift as a
   * definition. Category and promise come from the brand SSOT so it cannot
   * drift from the eyebrow, the npm cards or the JSON-LD.
   */
  definition: `Mushi Mushi is ${lowerFirst(MUSHI_TAGLINE_V2.category)}, an open-source tool that gives every bug your users report a ${lowerFirst(MUSHI_TAGLINE_V2.promise)}.`,
  who: 'Solo founders who build with AI tools and then lose whole afternoons fixing code they did not fully write themselves. People who work this way are often called vibe coders.',
  boundary:
    'It works inside your code editor, not as yet another dashboard to check. Sentry, Linear and Slack can feed into the same list, but you need none of them to start.',
} as const

export const LANDING_WHERE_TO_START_INTRO =
  'Pick the card that matches what you are doing right now. Each one links to the right next step.'

export interface LandingPathCard {
  title: string
  desc: string
  href: string
  cmd?: string
  /** When set, the card is a tracked CTA (`cta_click.cta_id`). */
  ctaId?: string
}

export const LANDING_WHERE_TO_START: readonly LandingPathCard[] = [
  {
    title: 'I build with Cursor or Claude Code',
    desc: 'Connect Mushi to your editor first, so your AI assistant can read bug reports and fix prompts without leaving the window.',
    href: '/quickstart/incident-loop',
    cmd: 'npx mushi-mushi setup --ide cursor',
  },
  {
    title: 'I have a web or mobile app',
    desc: 'Add the report button (the SDK), send a first test report, and get a plain-English read in about 10 seconds.',
    href: '/quickstart/react',
    cmd: 'npx mushi-mushi',
  },
  {
    title: 'I want the web dashboard',
    desc: 'Create a project, connect GitHub (where your code lives), and follow the setup checklist.',
    // Absolute URL (not `/admin/onboarding`) so the apex-redirect CloudFront
    // Function — which treats `/admin/*` as a docs-nested prefix — never gets
    // a chance to send this to the *documentation* page instead of the app.
    href: `${ADMIN_DEMO_BASE}/onboarding?src=landing-console`,
    cmd: 'mushi login && mushi status',
    ctaId: 'landing-console',
  },
] as const

export const LANDING_QUICKSTART_INTRO =
  'A first diagnosis usually arrives in about 10 seconds. Pick a starting point:'

export interface LandingPlatformCard {
  title: string
  icon: string
  /**
   * Real product logo, served from `public/brand/platforms/<slug>.svg`.
   * Every card previously rendered the same generic Mushi mark, so four
   * visually identical tiles claimed to be four different platforms — the
   * tell that a page is mocked up rather than shipped.
   *
   * Bundled rather than fetched from a CDN: the docs CSP is
   * `img-src 'self' data: blob: https://*.supabase.co`, so any third-party
   * image host is blocked outright and would silently fall back to the very
   * state this replaces. Local assets also keep visitor IPs off a third
   * party on a public marketing page. Marks are CC0 (Simple Icons), used
   * nominatively to identify the platform each quickstart supports.
   */
  iconSlug?: string
  /** Brand hex (with `#`) — the mark is masked to keep its own identity. */
  iconColor?: string
  href: string
  cmd: string
  desc: string
  badge?: string
}

/**
 * Shared brand mark path (served from apps/docs/public).
 * Prefix with MUSHI_BASE_PATH so static export under
 * `/mushi-mushi/docs` does not emit root-absolute `/brand/*`
 * (those 404 on the kensaur Default origin; CF 301 is only a safety net).
 */
const DOCS_BASE = (process.env.NEXT_PUBLIC_MUSHI_BASE_PATH ?? '').replace(/\/+$/, '')
const LANDING_BRAND_MARK = `${DOCS_BASE}/brand/logo-mark.svg`

/** Base path for assets under `apps/docs/public`. Exported so components can
 *  build self-hosted asset URLs without re-deriving the static-export prefix. */
export const MUSHI_DOCS_BASE = DOCS_BASE

export const LANDING_QUICKSTART_PLATFORMS: readonly LandingPlatformCard[] = [
  {
    title: 'Incident loop',
    icon: LANDING_BRAND_MARK,
    href: '/quickstart/incident-loop',
    cmd: 'npx mushi-mushi',
    desc: 'A bug in your live app → a plain-English read → a fix prompt ready to paste into Cursor.',
    badge: 'Start here',
  },
  {
    title: 'MCP server',
    icon: LANDING_BRAND_MARK,
    iconSlug: 'anthropic',
    iconColor: '#D97757',
    href: '/quickstart/mcp',
    cmd: 'npx mushi-mushi setup --ide cursor',
    desc: 'Ask your editor what broke and get a fix brief, in Claude, Cursor or Codex. No extra AI key needed.',
    badge: 'Editor-first',
  },
  {
    title: 'React',
    icon: LANDING_BRAND_MARK,
    iconSlug: 'react',
    iconColor: '#61DAFB',
    href: '/quickstart/react',
    cmd: 'npx mushi-mushi',
    desc: 'The wizard installs the SDK, saves your settings and can send a test report.',
  },
  {
    title: 'Mobile',
    icon: LANDING_BRAND_MARK,
    iconSlug: 'flutter',
    iconColor: '#02569B',
    href: '/quickstart/mobile',
    cmd: 'npx mushi-mushi',
    desc: 'React Native and Capacitor: shake the phone to report, and reports wait until the phone is back online. iOS, Android and Flutter SDKs are previews.',
    badge: 'Mobile',
  },
] as const

export interface LandingComparisonRow {
  label: string
  foil: string
  mushi: string
}

export const LANDING_COMPARISON_ROWS: readonly LandingComparisonRow[] = [
  {
    label: 'What it sees',
    foil: 'Errors and performance, plus Session Replay and a User Feedback widget',
    mushi: 'User reports from the widget with a screenshot, plus the errors Sentry catches, in one queue',
  },
  {
    label: 'What lands in your queue',
    foil: 'A stack trace (the technical record of where the code failed)',
    mushi: 'A short user note plus the screenshot they were looking at',
  },
  {
    label: 'Repeat bugs',
    foil: 'Repeat events of the same error group into one issue',
    mushi: 'Repeat user reports of the same broken button collapse to one row, even when nothing threw',
  },
  {
    label: 'What you learn from fixes',
    foil: 'A resolved issue reopens as a regression if it recurs; there is no lessons file for your editor',
    mushi: 'Past fixes become rules your editor sees on the next PR (.mushi/lessons.json)',
  },
  {
    label: 'Closing the loop',
    foil: 'Resolve by hand, from a commit that references the issue, or in a release; Seer, the paid AI debugging add-on, is on Team and above',
    mushi: 'A draft PR from your agent; merging it resolves the linked Linear issue, and the linked Sentry issue once the Sentry plugin is on (Indie and above, or self-hosted)',
  },
  {
    label: 'Reporter attribution',
    foil: 'The user you set with setUser, or the name and email on a feedback submission; no credit when it is fixed',
    mushi: '"Fixed by Kenji" in the changelog and an SDK toast, once Releases is enabled',
  },
  {
    label: 'From your IDE',
    foil: 'Sentry\'s MCP server lets Cursor or Claude Code read issues and ask Seer',
    mushi: 'Cursor reads the report and the relevant lessons, then proposes the code change',
  },
  {
    label: 'Where it runs',
    foil: 'Their cloud, or yours with getsentry/self-hosted (no Seer)',
    mushi: 'Yours, ours, or both',
  },
] as const

export interface LandingPillar {
  step: string
  name: string
  role: string
  /**
   * Which glyph `<Pillars>` draws above the step. The four cards previously
   * carried no graphic at all, so the loop's most important explanation was
   * four indistinguishable text blocks. Keyed rather than inlined so the copy
   * module stays free of markup.
   */
  glyph: 'report' | 'diagnose' | 'group' | 'ship'
}

export const LANDING_PILLARS: readonly LandingPillar[] = [
  {
    step: 'Step 1',
    name: 'User reports',
    glyph: 'report',
    role: 'A shake or a tap sends it, with a picture of the screen and what the user was doing.',
  },
  {
    step: 'Step 2',
    name: 'Plain read',
    glyph: 'diagnose',
    role: 'How serious it is and the likely cause, in everyday English, not error code.',
  },
  {
    step: 'Step 3',
    name: 'One row',
    glyph: 'group',
    role: 'Twenty reports of the same broken button become one item, not twenty.',
  },
  {
    step: 'Step 4',
    name: 'Draft PR',
    glyph: 'ship',
    role: 'Optional: an AI agent proposes the fix and a second AI reviews it. You decide.',
  },
] as const

/**
 * "This is what a diagnosis looks like" — one real classifier output, so the
 * wedge (VISION.md Bucket A) is shown, not only described.
 *
 * Source: `reports.stage2_analysis` of report 4618a607 in the public demo
 * project `mushi-demo`, classified 2026-09-20. The report text is a fixture
 * WE wrote (`_shared/demo-report-fixtures.json`, seeded by
 * scripts/marketing/seed-demo.mjs); the diagnosis is the model's output,
 * trimmed only where an ellipsis marks it. Kept as static copy because the
 * demo can be reseeded. Never edit the wording to read better — re-pull it.
 */
export const LANDING_REAL_DIAGNOSIS = {
  heading: 'This is what a diagnosis looks like',
  report:
    "After finishing the daily lesson the celebration sheet shows '+0 XP earned today' but my streak counter on the home screen incremented by 1. … Also the haptic 'tada' on the celebration sheet that used to fire is silent now. …",
  title: 'Celebration screen shows +0 XP and haptic feedback is silent after lesson',
  severity: 'high',
  category: 'bug',
  confidence: '0.82',
  rootCause:
    '… The XP value passed to the CelebrationSheet is read from state or props before the XP award async operation resolves, resulting in a stale 0 value being displayed … The haptic \'tada\' feedback call is either gated on the XP value being non-zero, is invoked before the component is fully mounted, or … missing/unreachable on this code path entirely.',
  suggestedFix:
    "… Ensure the XP earned value is sourced from the resolved result of the lesson-completion API call … Guard against rendering '0' as a fallback when the value is undefined/null — use a loading indicator instead. … Verify the haptic 'tada' trigger is called unconditionally on sheet presentation … and is not gated behind the XP value being truthy.",
  editorCmd: 'get_fix_context',
  provenance:
    'Real classifier output from the public demo project, 2026-09-20, trimmed where marked with an ellipsis (numbering and headings inside the answer included). The report itself is a sample we wrote to resemble a real one. A diagnosis is a model’s reading and can be wrong; check it before you merge.',
  nextHref: '/quickstart/incident-loop',
  nextLabel: 'Pull a diagnosis into Cursor or Claude Code →',
} as const

export interface LandingMediatorLink {
  label: string
  detail: string
  href: string
}

/**
 * The mediator map (VISION.md §1.5, Bucket C): where bugs come in and where
 * fixes and status go out. Every row links to the page that documents it —
 * a row with no docs page does not belong here. No counts: they drift.
 */
export const LANDING_MEDIATOR = {
  inbound: [
    { label: 'Your users', detail: 'Widget or shake-to-report, with a screenshot and the console tail', href: '/quickstart/react' },
    { label: 'Sentry', detail: 'An issue-alert webhook drops errors into the same queue', href: '/plugins/sentry' },
    { label: 'Datadog · Bugsnag · Crashlytics · more', detail: 'Alerts from other monitoring tools, turned into reports', href: '/sdks/adapters' },
    { label: 'Your voice', detail: 'Dictate a bug from an iOS Shortcut, Slack, or a Telegram bot', href: '/integrations/voice-intake' },
  ],
  outbound: [
    { label: 'Your editor', detail: 'Cursor or Claude Code reads the diagnosis and fix prompt over MCP', href: '/quickstart/mcp' },
    { label: 'Cloud coding agents', detail: 'A Cursor agent in the cloud drafts the fix and opens a pull request', href: '/plugins/cursor-cloud' },
    { label: 'Linear · Jira · GitHub Issues', detail: 'An issue is filed when a report is classified', href: '/plugins/linear' },
    { label: 'Slack · Discord · Teams', detail: 'Slack gets a card with buttons to dispatch a fix or resolve', href: '/plugins/slack' },
  ],
  core: 'One list: duplicates merged, each bug explained in plain English, past fixes remembered as lessons',
  gating:
    'The SDK, the report button, the diagnosis and the editor connection (MCP server) all work on the free plan. Plugins for other tools need the Indie plan or above on Mushi Cloud, or your own server.',
} as const satisfies {
  inbound: readonly LandingMediatorLink[]
  outbound: readonly LandingMediatorLink[]
  core: string
  gating: string
}

/** Landing pricing strip — tier rows come from PRICING_TIERS (lib/public-copy.ts). */
export const LANDING_PRICING_STRIP = {
  heading: 'What it costs',
  lead: 'You pay per diagnosis (one bug that Mushi explains), not for every error it sees. Duplicate reports and noise are filtered out for free. Every paid plan has a spending cap, so the bill cannot run away.',
  tierIds: ['free', 'indie', 'pro', 'self-host'] as const,
  cta: 'Full pricing and the estimator →',
  href: '/pricing',
  ctaId: 'landing-pricing',
} as const

/** Community line under the closing CTA. */
export const LANDING_COMMUNITY = {
  lead: 'Shipped an app that an AI mostly wrote, and hear about bugs from users? Tell us what you do with those messages today.',
  label: 'GitHub Discussions →',
  href: `${MUSHI_CANONICAL_URLS.repo}/discussions`,
} as const

export const LANDING_OPERATOR = {
  question: 'Try it on your own app',
  soloCta: 'Start free →',
  soloHref: `${ADMIN_DEMO_BASE}/signup?src=landing-closing`,
  soloCtaId: 'landing-closing',
  teamLead:
    'Setting it up for a team, with single sign-on (SSO) or audit logs? The operator notes on GitHub cover that.',
  teamCta: 'Operators docs →',
  teamHref: `${MUSHI_CANONICAL_URLS.repo}/tree/master/docs/operators`,
} as const

export const LANDING_MEDIA_CAPTIONS = {
  adminTour: {
    alt: 'Animated guided tour through the Mushi admin console — reports, fixes, and integrations',
    captionStrong: 'Bug list',
    captionRest: '· the web dashboard, for when you want the whole list of bugs in front of you',
  },
  glotit: {
    alt: 'glot.it dogfood — user taps the Mushi feedback widget, submits a bug report',
    captionStrong: 'Real users',
    captionRest: '· a shake or tap sends a report on glot.it, a Thai-learning app we run',
  },
  dashboard: {
    alt: 'Mushi admin dashboard — an overview of reports and fixes',
    captionStrong: 'Dashboard',
    captionRest: '· the same overview in light and dark mode',
  },
  reportDetail: {
    alt: 'Report detail — screenshot, classification, and fix timeline',
    captionStrong: 'One report',
    captionRest: '· the screenshot, the plain-English read and the fix history',
  },
} as const

/**
 * Trust-strip headline for the landing. The brand ladder's
 * MUSHI_OSS.trustStrip says the same thing in developer shorthand
 * ("self-hostable", "no second LLM key"); this is the plain version a
 * first-time visitor can read.
 */
export const LANDING_TRUST_HEADLINE =
  'Open source (MIT-licensed SDKs) · run it on your own server if you like · no extra AI key needed'

export const LANDING_TRUST_LINKS = [
  {
    label: 'License',
    text: 'SDKs MIT · server AGPL',
    href: `${MUSHI_CANONICAL_URLS.repo}/blob/master/LICENSE`,
  },
  {
    label: 'Self-host',
    text: 'One-command stack',
    href: '/self-hosting',
  },
  {
    label: 'Source',
    text: 'kensaurus/mushi-mushi',
    href: MUSHI_CANONICAL_URLS.repo,
  },
  {
    label: 'Dogfood',
    text: 'Runs on glot.it',
    href: 'https://kensaur.us/glot-it',
  },
  {
    label: 'Security',
    text: 'Each account sees only its own data',
    href: '/security',
  },
] as const
