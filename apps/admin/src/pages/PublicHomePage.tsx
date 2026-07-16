/**
 * FILE: apps/admin/src/pages/PublicHomePage.tsx
 * PURPOSE: Public landing rendered at `/` (becomes `/mushi-mushi/admin/` in
 *          production). Uses the same editorial Hero / MushiCanvas /
 *          ClosingCta / MarketingFooter components that apps/cloud renders at
 *          kensaur.us/mushi-mushi/, via the shared @mushi-mushi/marketing-ui
 *          package — so visitors who hit either surface see the same brand
 *          presentation, just routed through their respective frameworks
 *          (Next.js for cloud, react-router for admin).
 *
 * ROUTING:
 *   - "Open dashboard" / "Sign in" CTAs use react-router <Link>.
 *   - In production, the cloud Next.js app at /mushi-mushi/ already serves
 *     a richer pricing / signup flow; this admin landing is the
 *     local-dev + admin-domain fallback so localhost:6464 isn't a bare
 *     redirect-to-login on first contact.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import {
  ClosingCta,
  Hero,
  MarketingFooter,
  MarketingProvider,
  MushiCanvas,
  SwitchingFromStrip,
  type MarketingLink,
  type MarketingLinkProps,
  type MarketingTheme,
} from '@mushi-mushi/marketing-ui'
import type { User } from '@supabase/supabase-js'
import { useAuth } from '../lib/auth'
import { Btn } from '../components/ui'

const DOCS_BASE = 'https://kensaur.us/mushi-mushi/docs'
const REPO_BASE = 'https://github.com/kensaurus/mushi-mushi'
const CONTACT_EMAIL = 'kensaurus@gmail.com'

/**
 * Adapter — react-router's <Link> uses `to` instead of `href`, and we need
 * to fall back to a plain <a> for hash anchors (#loop) and any
 * external/mailto link. The MarketingLinkProps interface includes `target`
 * and `rel` so the marketing components can request that outbound links
 * (docs / GitHub / migration guides / pricing) open in a new tab without
 * losing the landing context. The plain <a> branch already forwards them
 * via `...rest`; the SPA <Link> branch ignores them since react-router
 * never crosses origins, but `rest` is still spread so future props work.
 */
const ReactRouterLinkAdapter: MarketingLink = ({
  href,
  children,
  ...rest
}: MarketingLinkProps): ReactNode => {
  const isExternal =
    href.startsWith('http') ||
    href.startsWith('mailto:') ||
    href.startsWith('//')
  const isAnchor = href.startsWith('#')
  if (isExternal || isAnchor) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link to={href} {...(rest as Omit<LinkProps, 'to'>)}>
      {children}
    </Link>
  )
}

export function PublicHomePage() {
  const { session, user, loading } = useAuth()
  const consoleHref = session ? '/dashboard' : '/login?next=%2Fdashboard'

  const theme = useMemo<MarketingTheme>(
    () => {
      // Trailing-slash quirk of the docs deploy:
      //   - The site is `next build && next export` with `trailingSlash: false`.
      //   - That emits `out/index.html` (so `/docs/` 200s and `/docs` 404s on
      //     CloudFront) and per-page flat HTML for subpages (so
      //     `/docs/concepts/judge-loop` 200s and the trailing-slash variant
      //     404s). The previous helper returned a bare `/docs` URL for the
      //     no-arg case, which is exactly the one path CloudFront rejects.
      // Therefore: index URL gets an explicit trailing slash; subpage URLs
      // must NOT. Hash-only inputs (e.g. `'#plans'`) are appended directly
      // so callers can compose links like `urls.docs('/cloud#plans')` too.
      const docs = (path = '') => {
        if (!path) return `${DOCS_BASE}/`
        if (path.startsWith('#')) return `${DOCS_BASE}/${path}`
        return `${DOCS_BASE}${path.startsWith('/') ? '' : '/'}${path}`
      }
      const repo = (path = '') =>
        path ? `${REPO_BASE}${path.startsWith('/') ? '' : '/'}${path}` : REPO_BASE
      return {
        Link: ReactRouterLinkAdapter,
        urls: {
          // In the admin SPA we don't have a separate signup form; deep-link
          // straight into the auth-gated dashboard so the existing login page
          // collects credentials. The "next" param keeps the user-intent.
          signup: consoleHref,
          login: '/login',
          loopAnchor: '#loop',
          // Pricing lives on the docs site at /cloud (Free + Cloud + Enterprise
          // table). The previous `'#pricing'` anchor pointed at a section that
          // does not exist on this landing — a dead footer link. The hash
          // jumps the visitor to the "Plans" heading inside the cloud doc.
          pricing: docs('/cloud#plans'),
          docs,
          repo,
          contact: (subject) =>
            subject
              ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
              : `mailto:${CONTACT_EMAIL}`,
          screenshots: (filename) => `${import.meta.env.BASE_URL}screenshots/${filename}`,
        },
      }
    },
    [consoleHref],
  )

  return (
    <MarketingProvider value={theme}>
      <main className="mushi-marketing-surface min-h-full overflow-y-auto">
        {/* Authenticated bar — non-sticky strip above the sticky-nav that
            tells a returning visitor "yes, you're still signed in" before
            they even read the H1. Two reasons we keep this AND the sticky-
            nav identity pill below:
              1. Above-the-fold visibility. The sticky-nav pill collapses to
                 an avatar dot at narrow widths; this strip stays full-width
                 so the email is always readable on first paint.
              2. Reassurance for the user-bypass-bookmarks-the-landing path.
                 An operator who left `localhost:6464/` open in a tab and
                 re-focuses it tomorrow needs to know they don't have to
                 sign in again. The sticky-nav identity pill answers the
                 same question, but only after they look up there. */}
        {!loading && session && user && (
          <SignedInBanner
            user={user}
            consoleHref={consoleHref}
          />
        )}
        <div className="mx-auto max-w-6xl space-y-12 px-6 pb-10 pt-4">
          {/* Top nav — small, sticky, mirrors the cloud landing's silhouette
              but routes to the admin's auth surface (no signup form here). */}
          <header className="sticky top-3 z-30 flex items-center justify-between rounded-full border border-editorial-rule bg-editorial-paper-raised px-4 py-2 shadow-[0_18px_40px_-32px_rgba(14,13,11,0.5)] backdrop-blur sm:px-5">
            <Link
              to="/"
              className="flex items-center gap-2 font-serif text-base font-semibold text-editorial-ink"
              aria-label="Mushi Mushi home"
            >
              <span
                aria-hidden
                className="grid h-7 w-7 place-items-center rounded-sm bg-editorial-vermillion font-mono text-xs text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]"
              >
                虫
              </span>
              <span>Mushi Mushi</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-1 text-sm sm:gap-2">
              {/* "Loop" header link removed — it duplicated the Hero's
                  "Watch the loop" secondary CTA (which scrolls to the same
                  #loop anchor) and added a third semantic destination next
                  to Docs / Sign in / Get started without telling the
                  visitor anything new. The MushiCanvas section the anchor
                  pointed at is in the natural reading flow below the Hero,
                  so the redundant nav item was just chrome. */}
              <a
                /* Trailing slash matters: see the docs() helper below — the
                 * static export's `out/index.html` is only reachable via
                 * `/docs/`, never `/docs`. */
                href={`${DOCS_BASE}/`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.18em] text-editorial-ink-muted transition hover:bg-editorial-vermillion-wash hover:text-editorial-vermillion focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-vermillion"
              >
                Docs
              </a>
              {/* Right cluster swaps based on auth state.
                  - signed in: identity pill (avatar + email) + "Open
                    console" CTA + a subtle sign-out affordance — so a
                    visitor who already has an active session sees their
                    own face on the landing page (answering the implicit
                    "is this me?" question) instead of being asked to
                    "Sign in" again.
                  - signed out / loading: original Sign-in + Get-started
                    chrome. We render the same anonymous shell while
                    `loading` is true so we never *flash* a wrong identity
                    or the wrong CTA before supabase-js resolves the
                    cached session — the rare opposite flash (anonymous →
                    authenticated) is the safe direction. */}
              {!loading && session && user ? (
                <SignedInChrome user={user} consoleHref={consoleHref} />
              ) : (
                <SignedOutChrome consoleHref={consoleHref} />
              )}
            </nav>
          </header>

          <Hero />
          <MushiCanvas />
          <SwitchingFromStrip />
          <DogfoodProofSection />
          <SynthesisLayerSection />
          <ClosingCta />
          {/* No public health endpoint reachable from the admin SPA, so the
              StatusPill stays in its muted "unknown" state — matches the
              cloud behaviour when NEXT_PUBLIC_API_BASE_URL isn't set. */}
          <MarketingFooter />
        </div>
      </main>
    </MarketingProvider>
  )
}

// ─── Auth-state chrome ────────────────────────────────────────────────────

/**
 * Pick the best human-readable label for an authenticated user. We prefer
 * `user_metadata.full_name` (set by OAuth providers like Google) over the
 * raw email so the landing page reads as personal ("Welcome back, Alex")
 * rather than transactional ("Welcome back, alex.smith@megacorp.example").
 * Falls back through name → email → "your account" so we never render an
 * empty string even if the session somehow has no email (anonymous auth
 * via JWT, custom SAML claim).
 */
function getDisplayName(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | null | undefined
  const fullName = typeof meta?.full_name === 'string' ? meta.full_name.trim() : ''
  if (fullName) return fullName
  const name = typeof meta?.name === 'string' ? meta.name.trim() : ''
  if (name) return name
  if (user.email) return user.email
  return 'your account'
}

/**
 * One-character avatar glyph. Falls back to "?" when neither name nor
 * email is parseable so the circle never renders an empty string (which
 * would make the round chip look broken). All-caps for visual consistency.
 */
function getInitial(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | null | undefined
  const fullName = typeof meta?.full_name === 'string' ? meta.full_name.trim() : ''
  if (fullName) return fullName.charAt(0).toUpperCase()
  if (user.email) return user.email.charAt(0).toUpperCase()
  return '?'
}

/**
 * Right-side cluster of the sticky nav, shown when the visitor is signed
 * in. Replaces the anonymous `Sign in / Get started` pair with an
 * identity pill + "Open console" CTA + small sign-out affordance.
 *
 * Layout note: at narrow viewports (< sm) we collapse the email pill to
 * just the avatar circle to avoid the nav wrapping to two lines (the
 * sticky pill is full-width minus 24px page padding, which is tight).
 * The "Open console" pill stays prominent because that's the action
 * 95 % of returning visitors want to take from this page.
 */
function SignedInChrome({ user, consoleHref }: { user: User; consoleHref: string }) {
  const { signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const displayName = getDisplayName(user)
  const initial = getInitial(user)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      // The auth provider broadcasts SIGNED_OUT and the session goes to
      // null; this component will re-render as `<SignedOutChrome>` so we
      // don't strictly need to clear the loading state, but doing so is
      // cheap and protects against the (unlikely) signOut-throws path.
      setSigningOut(false)
    }
  }

  return (
    <>
      <Link
        to="/dashboard"
        className="group inline-flex items-center gap-2 rounded-full border border-editorial-rule bg-editorial-paper-card py-1 pl-1 pr-3 transition hover:border-editorial-ink-rule hover:bg-editorial-paper-sink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editorial-vermillion/55"
        title={`Signed in as ${displayName}`}
        aria-label={`Signed in as ${displayName} — open console`}
      >
        <span
          aria-hidden
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-editorial-vermillion font-mono text-2xs font-semibold text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.22)]"
        >
          {initial}
        </span>
        {/* Hide the email at narrow widths so the sticky pill doesn't
            wrap. The avatar + the "Open console" CTA still convey the
            signed-in state on mobile. */}
        <span className="hidden max-w-48 truncate font-mono text-2xs uppercase tracking-[0.16em] text-editorial-ink md:inline">
          {user.email ?? displayName}
        </span>
      </Link>
      <Link
        to={consoleHref}
        className="ml-1 rounded-full bg-editorial-ink px-3 py-1.5 font-mono text-2xs font-medium uppercase tracking-[0.18em] text-editorial-paper shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-editorial-ink-emphasis"
      >
        Open console
      </Link>
      <Btn
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleSignOut}
        disabled={signingOut}
        loading={signingOut}
        className="rounded-full px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.18em] text-editorial-ink-muted hover:bg-editorial-vermillion-wash hover:text-editorial-vermillion !border-transparent shadow-none"
      >
        Sign out
      </Btn>
    </>
  )
}

/**
 * Right-side cluster of the sticky nav, shown when the visitor is
 * signed out OR while the auth provider is still resolving the
 * persisted session (`loading=true`). Identical to the original
 * pre-auth-aware chrome.
 */
function SignedOutChrome({ consoleHref }: { consoleHref: string }) {
  return (
    <>
      <Link
        to="/login"
        className="rounded-full px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.18em] text-editorial-ink-muted transition hover:bg-editorial-vermillion-wash hover:text-editorial-vermillion"
      >
        Sign in
      </Link>
      {/* The sticky-nav CTA is small chrome, not a hero button —
          the longer "Start free, no card" label used by the Hero
          and ClosingCta wraps to three lines inside this pill-sized
          container at 360px. We keep "Get started" here for
          ergonomics; the Hero and ClosingCta below carry the
          longer, no-card promise where they have the room to
          render it cleanly. */}
      <Link
        to={consoleHref}
        className="ml-1 rounded-full bg-editorial-ink px-3 py-1.5 font-mono text-2xs font-medium uppercase tracking-[0.18em] text-editorial-paper shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-editorial-ink-emphasis"
      >
        Get started
      </Link>
    </>
  )
}

// ─── Dogfood proof ────────────────────────────────────────────────────────

/**
 * "Mushi runs on Mushi" — real before/after captures from the hosted project
 * (dxptnwrhwsqckaftyymj), the Langfuse "it observes its own LLM calls" move.
 * Every row links to the public PR it produced; numbers are pulled from
 * `docs/dogfood.md`, not invented. If a capture is retired, update both.
 */
interface DogfoodCase {
  user: string
  diagnosis: string
  meta: string
  prHref: string
  prLabel: string
}

const DOGFOOD_CASES: DogfoodCase[] = [
  {
    user: '"The balance shows the old converted value until I restart the app."',
    diagnosis:
      'Wallet balance does not refresh after a currency swap until the app is fully restarted.',
    meta: 'yen-yen · high · 0.95',
    prHref: 'https://github.com/kensaurus/yen-yen/pull/69',
    prLabel: 'yen-yen #69',
  },
  {
    user: '"The fixed header covers the first transaction row when I scroll."',
    diagnosis:
      'Sticky header clips the first Transactions row on both iOS and Android.',
    meta: 'yen-yen · high · 0.95',
    prHref: 'https://github.com/kensaurus/yen-yen/pull/68',
    prLabel: 'yen-yen #68',
  },
  {
    user: '(inbox renders empty despite data)',
    diagnosis:
      'FeedbackInboxScreen renders an empty list despite the API returning data — state not updated after async load.',
    meta: 'yen-yen · high · 0.82',
    prHref: 'https://github.com/kensaurus/yen-yen/pull/67',
    prLabel: 'yen-yen #67',
  },
]

function DogfoodProofSection() {
  return (
    <section
      aria-labelledby="dogfood-heading"
      className="rounded-[1.5rem] border border-editorial-rule bg-editorial-paper-panel px-5 py-8 sm:px-8 sm:py-10"
    >
      <p className="font-mono text-2xs uppercase tracking-[0.32em] text-editorial-ink-muted">
        <span className="text-editorial-ink">Dogfood</span>
        <span className="mx-2 opacity-40">/</span>
        Mushi runs on Mushi
      </p>
      <h2
        id="dogfood-heading"
        className="mt-2 max-w-2xl font-serif text-2xl leading-snug tracking-[-0.02em] text-editorial-ink sm:text-3xl"
      >
        Real bugs, translated and fixed — in our own apps.
      </h2>
      <p className="mt-3 max-w-2xl text-[1.0625rem] leading-relaxed text-editorial-ink-muted">
        These aren&rsquo;t mockups. Each row is a real report from a sibling app,
        the plain-English diagnosis Mushi produced, and the public PR the
        paste-ready fix prompt opened. One incident-loop run went from{' '}
        <em className="not-italic font-medium text-editorial-vermillion">
          report to draft PR in ~18 seconds
        </em>
        .
      </p>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {DOGFOOD_CASES.map((c) => (
          <div
            key={c.prHref}
            className="flex flex-col rounded-xl border border-editorial-rule bg-editorial-paper-raised p-4"
          >
            <p className="text-xs leading-relaxed text-editorial-ink-muted">
              <span className="font-medium text-editorial-ink">User: </span>
              {c.user}
            </p>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-editorial-ink-muted">
              <span className="font-medium text-editorial-vermillion">Mushi: </span>
              {c.diagnosis}
            </p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="font-mono text-2xs uppercase tracking-[0.18em] text-editorial-ink-muted">
                {c.meta}
              </span>
              <a
                href={c.prHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-editorial-rule px-2.5 py-1 font-mono text-2xs text-editorial-ink transition hover:bg-editorial-vermillion-wash hover:text-editorial-vermillion"
              >
                {c.prLabel}
                <span aria-hidden>↗</span>
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Synthesis layer positioning ──────────────────────────────────────────

/**
 * Two-part section that reframes Mushi as the integration hub, not a
 * competitor to tools teams already run. Positioned between SwitchingFromStrip
 * and ClosingCta because visitors who've read the "coming from <competitor>?"
 * strip are primed to think about their existing stack.
 *
 * Part 1: The four-signal model — code errors, system telemetry, product
 *   analytics, user-felt friction. Only Mushi covers #4 and wires them all.
 * Part 2: Inbound (adapters) + outbound (plugins) ecosystem tiles so a
 *   visitor can see at a glance which tool they already use is supported.
 */
function SynthesisLayerSection() {
  return (
    <section
      aria-labelledby="synthesis-heading"
      className="rounded-[1.5rem] border border-editorial-rule bg-editorial-paper-panel px-5 py-8 sm:px-8 sm:py-10"
    >
      {/* Eyebrow */}
      <p className="font-mono text-2xs uppercase tracking-[0.32em] text-editorial-ink-muted">
        <span className="text-editorial-ink">Integrator</span>
        <span className="mx-2 opacity-40">/</span>
        not a replacement
      </p>

      {/* Headline */}
      <h2
        id="synthesis-heading"
        className="mt-2 max-w-2xl font-serif text-2xl leading-snug tracking-[-0.02em] text-editorial-ink sm:text-3xl"
      >
        The layer that connects what you already run.
      </h2>
      <p className="mt-3 max-w-2xl text-[1.0625rem] leading-relaxed text-editorial-ink-muted">
        Every team has Sentry for thrown errors, Datadog for infra, Firebase for events.
        Nobody has a tool for what users <em className="not-italic text-editorial-vermillion font-medium">feel</em> — the dead
        button, the slow screen, the layout that only breaks on one device. Mushi adds that
        signal and wires it to everything you already rely on.
      </p>

      {/* Four-signal grid */}
      <div
        aria-label="Four monitoring signal types"
        className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {SIGNALS.map((s) => (
          <SignalCard key={s.title} {...s} />
        ))}
      </div>

      {/* Divider */}
      <div
        aria-hidden
        className="my-8 h-px"
        style={{
          background:
            'linear-gradient(90deg, var(--color-editorial-vermillion) 0, var(--color-editorial-vermillion) 3rem, var(--color-editorial-rule) 3rem)',
        }}
      />

      {/* Integration tiles */}
      <p className="font-mono text-2xs uppercase tracking-[0.32em] text-editorial-ink-muted">
        <span className="text-editorial-ink">Ecosystem</span>
        <span className="mx-2 opacity-40">/</span>
        plug in, don&rsquo;t rip out
      </p>
      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <IntegrationGroup
          direction="inbound"
          label="Inbound — receive alerts from"
          hint="Alerts from these tools become Mushi reports, enriching the user-felt signal with system context."
          tools={INBOUND_TOOLS}
        />
        <IntegrationGroup
          direction="outbound"
          label="Outbound — notify & sync to"
          hint="Mushi reports and resolved clusters flow back to these tools so your existing workflows stay intact."
          tools={OUTBOUND_TOOLS}
        />
      </div>
    </section>
  )
}

interface Signal {
  title: string
  tools: string
  mushi: string
  highlight?: boolean
}

const SIGNALS: Signal[] = [
  {
    title: 'Code-thrown errors',
    tools: 'Sentry · Crashlytics · Bugsnag · Rollbar',
    mushi: 'Ingested via plugin — Mushi resolves the Sentry fingerprint when the fix lands.',
  },
  {
    title: 'System telemetry',
    tools: 'Datadog · New Relic · Honeycomb · Grafana',
    mushi: 'Alert webhooks become Mushi reports via @mushi-mushi/adapters — latency + user note in one row.',
  },
  {
    title: 'Product analytics',
    tools: 'Firebase · PostHog · Amplitude',
    mushi: 'Funnel drops get context: the user note attached to the moment they stopped clicking.',
  },
  {
    title: 'User-felt friction',
    tools: 'nothing → Mushi',
    mushi: 'Native signal. Shake-to-report, LLM triage, knowledge graph, optional agentic fix.',
    highlight: true,
  },
]

function SignalCard({ title, tools, mushi, highlight = false }: Signal) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? 'border-editorial-vermillion/40 bg-editorial-vermillion-wash'
          : 'border-editorial-rule bg-editorial-paper-raised'
      }`}
    >
      <p
        className={`font-mono text-2xs uppercase tracking-[0.2em] leading-none ${
          highlight ? 'text-editorial-vermillion' : 'text-editorial-ink-muted'
        }`}
      >
        {highlight ? '★ ' : ''}
        {title}
      </p>
      <p className="mt-2 text-xs text-editorial-ink-muted leading-relaxed">
        <span className="font-medium text-editorial-ink">Today: </span>
        {tools}
      </p>
      <p className="mt-1.5 text-xs text-editorial-ink-muted leading-relaxed">
        <span className="font-medium text-editorial-vermillion">+ Mushi: </span>
        {mushi}
      </p>
    </div>
  )
}

interface IntegrationTool {
  name: string
  pkg: string
}

const INBOUND_TOOLS: IntegrationTool[] = [
  { name: 'Datadog', pkg: '@mushi-mushi/adapters' },
  { name: 'New Relic', pkg: '@mushi-mushi/adapters' },
  { name: 'Honeycomb', pkg: '@mushi-mushi/adapters' },
  { name: 'Grafana', pkg: '@mushi-mushi/adapters' },
]

const OUTBOUND_TOOLS: IntegrationTool[] = [
  { name: 'Sentry', pkg: '@mushi-mushi/plugin-sentry' },
  { name: 'Slack', pkg: '@mushi-mushi/plugin-slack-app' },
  { name: 'Jira', pkg: '@mushi-mushi/plugin-jira' },
  { name: 'Linear', pkg: '@mushi-mushi/plugin-linear' },
  { name: 'PagerDuty', pkg: '@mushi-mushi/plugin-pagerduty' },
  { name: 'Zapier', pkg: '@mushi-mushi/plugin-zapier' },
]

function IntegrationGroup({
  direction,
  label,
  hint,
  tools,
}: {
  direction: 'inbound' | 'outbound'
  label: string
  hint: string
  tools: IntegrationTool[]
}) {
  const arrowColor =
    direction === 'inbound' ? 'text-editorial-vermillion-muted' : 'text-editorial-ink-muted'
  return (
    <div>
      <p className="font-mono text-2xs font-semibold uppercase tracking-[0.2em] text-editorial-ink">
        {label}
      </p>
      <p className="mt-1 text-xs text-editorial-ink-muted leading-relaxed max-w-sm">{hint}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <li key={t.name}>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-editorial-rule bg-editorial-paper-card px-2.5 py-1 font-mono text-2xs text-editorial-ink-muted"
              title={`via ${t.pkg}`}
            >
              <span className={`text-2xs ${arrowColor}`} aria-hidden>
                {direction === 'inbound' ? '→' : '←'}
              </span>
              {t.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Full-width "you're signed in" strip rendered above the sticky-nav.
 * Sits inside the marketing surface (warm paper bg) but with a slight
 * vermillion-wash tint so it reads as informational chrome — not as
 * the page's primary content.
 *
 * Why a separate banner in addition to the sticky-nav identity pill:
 * the pill's email collapses on mobile, and a returning operator who
 * hits this URL needs the unambiguous "yes you're still signed in"
 * answer above the fold without having to scan the right side of the
 * sticky bar. Two surfaces, one consistent answer.
 */
function SignedInBanner({ user, consoleHref }: { user: User; consoleHref: string }) {
  const displayName = getDisplayName(user)
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-editorial-rule bg-editorial-paper-flush"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-6 py-2">
        <p className="flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.18em] text-editorial-ink-muted">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-editorial-vermillion"
          />
          <span className="text-editorial-ink">Signed in</span>
          <span aria-hidden className="opacity-40">·</span>
          <span className="max-w-72 truncate text-editorial-ink sm:max-w-none">
            {displayName}
          </span>
        </p>
        <Link
          to={consoleHref}
          className="inline-flex items-center gap-1.5 rounded-full bg-editorial-ink px-3 py-1 font-mono text-2xs font-medium uppercase tracking-[0.18em] text-editorial-paper shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-editorial-ink-emphasis"
        >
          Open console
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
    </div>
  )
}
