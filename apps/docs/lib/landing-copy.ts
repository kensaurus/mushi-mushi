/**
 * Visitor-facing copy for the docs landing page.
 * SSOT for section prose — hero/category strings re-export from @mushi-mushi/brand.
 */
import { MUSHI_CANONICAL_URLS, MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'
import { ADMIN_DEMO_BASE } from '../data/admin-screenshots'

export { MUSHI_TAGLINE_V2 }

/** EditorialHero — category eyebrow + lead (title stays JSX in index.mdx for <em>). */
export const LANDING_HERO = {
  eyebrow: MUSHI_TAGLINE_V2.category,
  lead:
    'Plain-English explanation of what broke, plus a fix you can paste into Cursor or Claude Code — so a bug costs five minutes, not your whole afternoon.',
  proofLine: 'Works standalone. Sentry optional. Open source.',
} as const

export const LANDING_HERO_CTAS = [
  {
    label: 'Run the wizard',
    href: '/quickstart/incident-loop',
    kind: 'primary' as const,
    external: false,
  },
  {
    label: 'Browse the repo',
    href: MUSHI_CANONICAL_URLS.repo,
    kind: 'secondary' as const,
    external: true,
  },
  {
    label: 'Connect your editor',
    href: '/connect',
    kind: 'ghost' as const,
    external: false,
  },
] as const

export const LANDING_SIXTY_SECOND = {
  intro:
    'Run the wizard. It detects your framework, installs the SDK, writes env vars, and prints the snippet.',
  afterBreak:
    'When something breaks in prod, the report lands in your queue with a plain-English read on the cause and what to change. Pull it into your editor over MCP.',
  pricing:
    '50 diagnoses/month on the free tier — no card. Self-host in under five minutes if you want.',
} as const

/** "Get started in 60 seconds" strip — one command, three steps. */
export const LANDING_SIXTY_SECOND_STEPS = {
  heading: 'Get started in 60 seconds',
  cmd: 'npx mushi-mushi',
  steps: [
    {
      title: 'Run one command',
      desc: 'The wizard detects your framework, installs the SDK, and writes your env vars.',
    },
    {
      title: 'Ship, then break something',
      desc: 'When a user hits a bug, the report lands with a plain-English read on the cause.',
    },
    {
      title: 'Pull the fix into your editor',
      desc: 'Cursor or Claude Code picks it up over MCP — paste the fix, merge, done.',
    },
  ],
  footnote: '50 diagnoses/month free — no card. Self-host the whole stack if you prefer.',
} as const

/** Landing FAQ — visible Q&A doubles as FAQPage JSON-LD (answers stay plain text). */
export interface LandingFaqItem {
  q: string
  a: string
}

export const LANDING_FAQ: readonly LandingFaqItem[] = [
  {
    q: 'Is Mushi Mushi a Sentry alternative?',
    a: 'It can be. Mushi works standalone as an open-source bug reporting and diagnosis tool for AI-built apps, or alongside Sentry — Sentry sees the errors your code throws, Mushi explains what the user experienced and hands you a fix.',
  },
  {
    q: 'Do I need Sentry to use it?',
    a: 'No. Mushi is standalone by default. If you already run Sentry, an optional bridge links stack traces to Mushi reports.',
  },
  {
    q: 'What does `npx mushi-mushi` do?',
    a: 'It runs a setup wizard that detects your framework (React, Vue, Svelte, Angular, React Native, Capacitor, Flutter, or Node), installs the matching SDK, writes your env vars, and prints the snippet to paste.',
  },
  {
    q: 'How do I debug an app that Cursor or Claude Code wrote?',
    a: 'Connect your editor over MCP with `npx mushi-mushi setup --ide cursor`. Bug reports arrive as plain-English diagnoses your agent can read, and the fix prompt is ready to apply without leaving the editor.',
  },
  {
    q: 'Is it open source? Can I self-host?',
    a: 'Yes — SDKs are MIT-licensed and the server is AGPLv3. You can self-host the whole stack with one command, and the free cloud tier includes 50 diagnoses a month with no card.',
  },
  {
    q: 'Which frameworks are supported?',
    a: 'Web: React, Vue, Svelte, Angular, and any site via the browser widget. Mobile: React Native, Capacitor, Flutter, iOS, and Android. Server: Node. One wizard installs any of them.',
  },
] as const

export const LANDING_MEDIA_INTRO =
  'Admin console, the SDK on a real app (glot.it), and light/dark screenshots — click a frame to open the live surface.'

export const LANDING_WHAT_THIS_IS = {
  who: 'Built for solo founders who ship with AI and lose afternoons debugging code they did not fully write.',
  boundary:
    'Works inside your editor — not another dashboard. Sentry can plug in later; you do not need it to start.',
} as const

export const LANDING_WHERE_TO_START_INTRO =
  'Pick the path that matches what you are doing right now — each card links to the right next step.'

export interface LandingPathCard {
  title: string
  desc: string
  href: string
  cmd?: string
}

export const LANDING_WHERE_TO_START: readonly LandingPathCard[] = [
  {
    title: 'I use Cursor / Claude',
    desc: 'Connect Mushi to your editor first — read reports and pull fix prompts without leaving the window.',
    href: '/quickstart/incident-loop',
    cmd: 'npx mushi-mushi setup --ide cursor',
  },
  {
    title: 'I have a web or mobile app',
    desc: 'Drop in the SDK, file the first report, get a plain-English read in about 10 seconds.',
    href: '/quickstart/react',
    cmd: 'npx mushi-mushi',
  },
  {
    title: 'I operate the console',
    desc: 'Create a project, connect GitHub, and walk through the onboarding checklist.',
    // Absolute URL (not `/admin/onboarding`) so the apex-redirect CloudFront
    // Function — which treats `/admin/*` as a docs-nested prefix — never gets
    // a chance to send this to the *documentation* page instead of the app.
    href: `${ADMIN_DEMO_BASE}/onboarding`,
    cmd: 'mushi login && mushi status',
  },
] as const

export const LANDING_QUICKSTART_INTRO =
  'Classification lands in about 10 seconds today; we are chasing sub-10. Pick a starting point:'

export interface LandingPlatformCard {
  title: string
  icon: string
  href: string
  cmd: string
  desc: string
  badge?: string
}

/** Shared brand mark path (served from apps/docs/public). */
export const LANDING_BRAND_MARK = '/brand/logo-mark.svg'

export const LANDING_QUICKSTART_PLATFORMS: readonly LandingPlatformCard[] = [
  {
    title: 'Incident loop',
    icon: LANDING_BRAND_MARK,
    href: '/quickstart/incident-loop',
    cmd: 'npx mushi-mushi',
    desc: 'Broken prod → plain-English read → paste-ready fix prompt in Cursor.',
    badge: 'Start here',
  },
  {
    title: 'MCP server',
    icon: LANDING_BRAND_MARK,
    href: '/quickstart/mcp',
    cmd: 'npx mushi-mushi setup --ide cursor',
    desc: 'Ask your editor what broke — fix briefs from Claude, Cursor, or Codex. No second LLM key.',
    badge: 'Editor-first',
  },
  {
    title: 'React',
    icon: LANDING_BRAND_MARK,
    href: '/quickstart/react',
    cmd: 'npx mushi-mushi',
    desc: 'Wizard installs the SDK, writes env vars, optional test report.',
  },
  {
    title: 'iOS · Android · Flutter',
    icon: LANDING_BRAND_MARK,
    href: '/quickstart/mobile',
    cmd: 'npx mushi-mushi',
    desc: 'Native shake, offline queue, and a Sentry bridge already wired up.',
    badge: 'Native',
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
    foil: 'Errors your code throws',
    mushi: 'Friction your users feel',
  },
  {
    label: 'What lands in your queue',
    foil: 'A stack trace',
    mushi: 'A short user note plus the screenshot they were looking at',
  },
  {
    label: 'Repeat bugs',
    foil: 'Each one shows up as a new issue',
    mushi: 'The same broken button collapses to one row',
  },
  {
    label: 'What you learn from fixes',
    foil: 'None — the next dev repeats the mistake',
    mushi: 'Past fixes become rules your editor sees on the next PR (.mushi/lessons.json)',
  },
  {
    label: 'Closing the loop',
    foil: 'Assign a ticket and remember to update',
    mushi: 'An optional draft PR you can merge or ignore, once GitHub is connected',
  },
  {
    label: 'Reporter attribution',
    foil: 'Anonymous',
    mushi: '"Fixed by Kenji" in the changelog and an SDK toast, once Releases is enabled',
  },
  {
    label: 'From your IDE',
    foil: 'Copy the issue ID into Cursor',
    mushi: 'Cursor reads the report + relevant lessons and proposes the diff',
  },
  {
    label: 'Where it runs',
    foil: 'Their cloud',
    mushi: 'Yours, ours, or both',
  },
] as const

export interface LandingPillar {
  step: string
  name: string
  role: string
}

export const LANDING_PILLARS: readonly LandingPillar[] = [
  {
    step: 'Step 1',
    name: 'User reports',
    role: 'On glot.it, a learner shakes the phone instead of emailing support. Mushi keeps the screen and what they were doing.',
  },
  {
    step: 'Step 2',
    name: 'Plain read',
    role: 'Severity and cause in English you already use — not a raw stack trace.',
  },
  {
    step: 'Step 3',
    name: 'One row',
    role: 'Twenty reports about the same broken checkout button collapse to one issue.',
  },
  {
    step: 'Step 4',
    name: 'Draft PR',
    role: 'Optional: an agent opens a PR on your repo. You merge, edit, or ignore it.',
  },
] as const

export const LANDING_ARCHITECTURE_LINK =
  'See **[Concepts → Architecture](/concepts/architecture)** for the wire-level sequence diagram and component-by-component spec.'

export const LANDING_OPERATOR = {
  question: 'Ready to try it?',
  soloCta: 'Know why. Fix fast. →',
  soloHref: '/quickstart/incident-loop',
  teamLead:
    'Need SSO, audit trails, or adapters for a team? Setup notes live in the operators docs on GitHub.',
  teamCta: 'Operators docs →',
  teamHref: `${MUSHI_CANONICAL_URLS.repo}/tree/master/docs/operators`,
} as const

export const LANDING_MEDIA_CAPTIONS = {
  adminTour: {
    alt: 'Animated guided tour through the Mushi admin console — reports, fixes, and integrations',
    captionStrong: 'Console triage',
    captionRest: '· for operators who need the queue, not another IDE tab',
  },
  glotit: {
    alt: 'glot.it dogfood — user taps the Mushi feedback widget, submits a bug report',
    captionStrong: 'Real users',
    captionRest: '· shake / tap report on glot.it, a Thai-learning app we run in prod',
  },
  dashboard: {
    alt: 'Mushi admin dashboard — PDCA cockpit',
    captionStrong: 'Dashboard',
    captionRest: '· light and dark stills of the same cockpit',
  },
  reportDetail: {
    alt: 'Report detail — screenshot, classification, and fix timeline',
    captionStrong: 'One report',
    captionRest: '· screenshot + plain read + fix timeline',
  },
} as const

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
] as const
