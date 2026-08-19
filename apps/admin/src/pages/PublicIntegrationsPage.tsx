/**
 * FILE: apps/admin/src/pages/PublicIntegrationsPage.tsx
 * PURPOSE: Public marketing page at `/integrations` — lists all inbound
 *          adapters and outbound plugins with category filtering, install
 *          copy, and docs links. Publicly accessible (no auth gate).
 *
 * VISUAL SYSTEM: matches PublicHomePage — same MarketingProvider wrapper,
 *   same sticky nav header, same editorial bridge token usage, same MarketingFooter.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, type LinkProps } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Btn } from '../components/ui'
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconGithub,
  IconSliders,
} from '../components/icons'
import {
  MarketingFooter,
  MarketingProvider,
  type MarketingLink,
  type MarketingLinkProps,
  type MarketingTheme,
} from '@mushi-mushi/marketing-ui'

const DOCS_BASE = 'https://kensaur.us/mushi-mushi/docs'
const REPO_BASE = 'https://github.com/kensaurus/mushi-mushi'
const CONTACT_EMAIL = 'kensaurus@gmail.com'

// ─── Link adapter ─────────────────────────────────────────────────────────

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

// ─── Integration data ──────────────────────────────────────────────────────

type Category =
  | 'All'
  | 'Error Monitoring'
  | 'APM & Telemetry'
  | 'Analytics'
  | 'Chat & Notifications'
  | 'Project Management'
  | 'Mobile'

interface Integration {
  name: string
  /**
   * Simple Icons slug for the brand mark, bundled at
   * `public/brand/platforms/<mark>.svg`. Omit for first-party entries
   * (Plugin SDK) and for brands with no CC0 mark (Honeycomb) — those render
   * the Mushi mark rather than a letter block.
   *
   * Bundled rather than fetched: the admin CSP allows `https://www.google.com`
   * but the favicon endpoint 301s to `t{0..3}.gstatic.com`, which CSP
   * re-checks and blocks — so the CDN approach silently rendered nothing but
   * fallbacks in production. Local assets also keep visitor IPs off a third
   * party on a public, unauthenticated marketing page.
   */
  mark?: string
  pkg: string
  direction: 'inbound' | 'outbound' | 'sdk'
  category: Exclude<Category, 'All'>
  description: string
}

const INTEGRATIONS: Integration[] = [
  // ── Inbound adapters ──────────────────────────────────────────────────
  {
    name: 'Datadog',
    mark: 'datadog',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Forward APM alerts and metric spikes as Mushi reports.',
  },
  {
    name: 'New Relic',
    mark: 'newrelic',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Route New Relic incident alerts to the Mushi report feed.',
  },
  {
    name: 'Honeycomb',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Pipe Honeycomb query triggers in for user-felt correlation.',
  },
  {
    name: 'Grafana Loki',
    mark: 'grafana',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Forward Loki log alerts as enriched Mushi reports.',
  },
  {
    name: 'CloudWatch',
    mark: 'amazonwebservices',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Import AWS CloudWatch alarms directly into Mushi.',
  },
  {
    name: 'Sentry',
    mark: 'sentry',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Import Sentry issue webhooks with stack traces intact.',
  },
  {
    name: 'Bugsnag',
    mark: 'bugsnag',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Receive Bugsnag error alerts and map them to user reports.',
  },
  {
    name: 'Rollbar',
    mark: 'rollbar',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Send Rollbar occurrences into your Mushi reports inbox.',
  },
  {
    name: 'Crashlytics',
    mark: 'firebase',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Mobile',
    description: 'Pull Firebase Crashlytics crashes into the report feed.',
  },
  {
    name: 'Firebase Analytics',
    mark: 'firebase',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Analytics',
    description: 'Correlate funnel-drop events with user-felt friction.',
  },
  {
    name: 'OpsGenie',
    mark: 'opsgenie',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Project Management',
    description: 'Convert OpsGenie alerts into triaged Mushi reports.',
  },
  // ── Outbound plugins ──────────────────────────────────────────────────
  {
    name: 'Sentry',
    mark: 'sentry',
    pkg: '@mushi-mushi/plugin-sentry',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Resolve Sentry issues when Mushi fixes land in production.',
  },
  {
    name: 'Bugsnag',
    mark: 'bugsnag',
    pkg: '@mushi-mushi/plugin-bugsnag',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Close Bugsnag errors when Mushi confirms the fix is live.',
  },
  {
    name: 'Rollbar',
    mark: 'rollbar',
    pkg: '@mushi-mushi/plugin-rollbar',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Mark Rollbar items resolved when Mushi deploys a fix.',
  },
  {
    name: 'Crashlytics',
    mark: 'firebase',
    pkg: '@mushi-mushi/plugin-crashlytics',
    direction: 'outbound',
    category: 'Mobile',
    description: 'Sync crash resolution status back to Firebase Crashlytics.',
  },
  {
    name: 'Slack',
    mark: 'slack',
    pkg: '@mushi-mushi/plugin-slack-app',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Post report digests and plain-English read summaries to Slack.',
  },
  {
    name: 'Discord',
    mark: 'discord',
    pkg: '@mushi-mushi/plugin-discord',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Deliver report alerts and fix summaries to Discord channels.',
  },
  {
    name: 'MS Teams',
    mark: 'microsoftteams',
    pkg: '@mushi-mushi/plugin-msteams',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Route Mushi alerts to Microsoft Teams channels.',
  },
  {
    name: 'Jira',
    mark: 'jira',
    pkg: '@mushi-mushi/plugin-jira',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Create Jira tickets automatically from triaged reports.',
  },
  {
    name: 'Linear',
    mark: 'linear',
    pkg: '@mushi-mushi/plugin-linear',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Push triaged bugs and fix tasks to Linear cycles.',
  },
  {
    name: 'PagerDuty',
    mark: 'pagerduty',
    pkg: '@mushi-mushi/plugin-pagerduty',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Trigger PagerDuty incidents for critical user-reported issues.',
  },
  {
    name: 'GitHub Issues',
    mark: 'github',
    pkg: '@mushi-mushi/plugin-github-issues',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Open GitHub Issues for triaged bugs with full AI context.',
  },
  {
    name: 'Zapier',
    mark: 'zapier',
    pkg: '@mushi-mushi/plugin-zapier',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Connect Mushi to 6 000+ apps via Zapier webhooks.',
  },
  {
    name: 'Plugin SDK',
    pkg: '@mushi-mushi/plugin-sdk',
    direction: 'sdk',
    category: 'APM & Telemetry',
    description: 'Build custom inbound or outbound integrations with the Mushi plugin SDK.',
  },
]

const CATEGORIES: Category[] = [
  'All',
  'Error Monitoring',
  'APM & Telemetry',
  'Analytics',
  'Chat & Notifications',
  'Project Management',
  'Mobile',
]

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Real brand logo for an integration, from the same favicon CDN the console's
 * `ServiceFavicon` already uses. Previously this page rendered a coloured
 * square containing the service's first letter — so Datadog was a red "D",
 * Sentry a red "S", Bugsnag a red "B". Twenty-three identical squares reads as
 * placeholder art and made a page whose entire job is to prove "we really do
 * integrate with these" look mocked-up.
 *
 * Falls back to the Mushi mark (never a letter) when a logo can't load or the
 * entry is first-party, so an offline viewer sees a deliberate brand element
 * rather than a broken image.
 */
function IntegrationLogo({ mark }: { name: string; mark?: string }) {
  const url = mark ? `/brand/platforms/${mark}.svg` : null

  return (
    <div
      aria-hidden
      className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-editorial-rule bg-editorial-paper shadow-[inset_0_-2px_0_rgba(0,0,0,0.06)]"
    >
      {url ? (
        // Masked rather than <img> so the monochrome CC0 mark inherits the
        // editorial ink colour and sits coherently with the rest of the page.
        <span
          className="bg-editorial-ink"
          style={{
            width: 20,
            height: 20,
            WebkitMaskImage: `url(${url})`,
            maskImage: `url(${url})`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
          }}
        />
      ) : (
        <span className="font-serif text-sm font-semibold leading-none text-editorial-vermillion">
          虫
        </span>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  // 'idle' | 'copied' | 'error'. We surface failure visibly because the
  // clipboard API rejects in restricted contexts (insecure HTTP, missing
  // permission, iframe sandbox) and a silent failure looks like a UI bug.
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  // Hold the timeout so we can clear it on unmount and never call setState
  // on a vanished component (React will warn in dev, leak the closure in prod).
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable')
      }
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('error')
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setState('idle'), 2000)
  }

  const label =
    state === 'copied' ? 'Copied!'
    : state === 'error' ? 'Copy failed'
    : `Copy install command for ${text}`

  // Icon, tone and label move together so each state is distinguishable
  // without reading the words. The idle glyph is action-shaped (two sheets)
  // so the swap to a checkmark parses as "that action succeeded"; a terminal
  // or `$` glyph would not. Success inverts to solid ink — the same
  // "affirmed" language the nav CTA and the active filter chip already use —
  // because a tint on warm paper is too quiet to register in a 24-card grid.
  // `!` on every colour: Btn's `ghost` variant ships `text-fg-secondary` plus a
  // `hover:bg-surface-overlay hover:text-fg` pair, and those win the cascade
  // over `text-editorial-*` regardless of the order they appear in the class
  // string. Unprefixed, the copied pill rendered dark-grey console text on
  // near-black ink. (PublicHomePage already pins a Btn the same way.)
  const { icon, tone, body } =
    state === 'copied'
      ? {
          icon: <IconCheck size={12} />,
          tone: '!border-editorial-ink !bg-editorial-ink !text-editorial-paper hover:!bg-editorial-ink hover:!text-editorial-paper hover:!border-editorial-ink',
          body: 'Copied',
        }
      : state === 'error'
        ? {
            icon: <IconAlertTriangle size={12} />,
            tone: '!border-editorial-vermillion/45 !bg-editorial-vermillion-wash !text-editorial-vermillion hover:!bg-editorial-vermillion-wash hover:!text-editorial-vermillion',
            body: 'Copy failed',
          }
        : {
            icon: <IconCopy size={12} />,
            tone: '!border-editorial-rule !bg-editorial-paper-card !text-editorial-ink hover:!border-editorial-vermillion/45 hover:!bg-editorial-vermillion-wash hover:!text-editorial-vermillion',
            body: 'Copy install',
          }

  return (
    <>
      <Btn
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => { void handleCopy() }}
        leadingIcon={icon}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-2xs ${tone}`}
        title={`Copy: ${text}`}
        aria-label={label}
      >
        {body}
      </Btn>
      {/* The button's accessible name is pinned by aria-label, so a state
          change never re-announces on its own. This out-of-flow live region
          is what actually tells a screen-reader user the copy landed. */}
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? `Copied ${text}` : state === 'error' ? 'Copy failed' : ''}
      </span>
    </>
  )
}

function IntegrationTile({ integration }: { integration: Integration }) {
  const isInbound = integration.direction === 'inbound'
  const isSdk = integration.direction === 'sdk'
  const installCmd = `npm install ${integration.pkg}`
  const docsHref = `${DOCS_BASE}/integrations/${integration.name.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <article className="group flex flex-col gap-3 rounded-xl border border-editorial-rule bg-editorial-paper p-4 transition hover:border-editorial-ink/25 hover:shadow-[0_4px_20px_-8px_rgba(14,13,11,0.12)]">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IntegrationLogo name={integration.name} mark={integration.mark} />
          <div>
            <p className="font-medium leading-none text-editorial-ink">
              {integration.name}
            </p>
            <p className="mt-1 font-mono text-2xs text-editorial-ink-faint">
              {integration.pkg}
            </p>
          </div>
        </div>
        {/* Direction badge */}
        <span
          className={`shrink-0 self-start rounded-full border px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.18em] ${
            isInbound
              ? 'border-editorial-vermillion/30 bg-editorial-vermillion/10 text-editorial-vermillion'
              : isSdk
                ? 'border-editorial-rule bg-editorial-paper-wash text-editorial-ink-muted'
                : 'border-editorial-rule bg-editorial-paper text-editorial-ink-muted'
          }`}
        >
          {isInbound ? '→ inbound' : isSdk ? 'sdk' : '← outbound'}
        </span>
      </div>

      {/* Description */}
      <p className="text-[0.8125rem] leading-relaxed text-editorial-ink-muted">
        {integration.description}
      </p>

      {/* Footer actions */}
      <div className="mt-auto flex items-center gap-2">
        <CopyButton text={installCmd} />
        {/* Deliberately borderless against CopyButton's bordered pill: two
            actions repeated 24 times down the page need a weight difference,
            not just different glyphs. Copy is the money action, Docs is the
            quiet one. Both lead with their icon so the row scans as
            icon-then-label rather than two identical grey words. */}
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-2xs text-editorial-ink-muted transition hover:bg-editorial-paper-wash hover:text-editorial-ink"
        >
          <IconExternalLink size={12} className="opacity-70" />
          Docs
        </a>
      </div>
    </article>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

export function PublicIntegrationsPage() {
  // Keep all hook calls at the top — rules of hooks require that early
  // returns don't change the call order.
  const { session, loading } = useAuth()
  const [filter, setFilter] = useState<Category>('All')

  // When a logged-in admin lands on `/integrations`, redirect them to the
  // configurable view at `/integrations/config`. We intentionally keep the
  // public marketing page route as `/integrations` for shareability + SEO,
  // so the redirect is render-time inside this component rather than a
  // route-level redirect (which would break the marketing URL for
  // anonymous visitors). `loading` gate avoids a flicker during the
  // initial supabase.getSession() handshake.
  if (!loading && session) {
    return <Navigate to="/integrations/config" replace />
  }

  const theme: MarketingTheme = {
    Link: ReactRouterLinkAdapter,
    urls: {
      signup: '/dashboard',
      login: '/login',
      loopAnchor: '#loop',
      pricing: `${DOCS_BASE}/cloud#plans`,
      docs: (path = '') => {
        if (!path) return `${DOCS_BASE}/`
        if (path.startsWith('#')) return `${DOCS_BASE}/${path}`
        return `${DOCS_BASE}${path.startsWith('/') ? '' : '/'}${path}`
      },
      repo: (path = '') =>
        path
          ? `${REPO_BASE}${path.startsWith('/') ? '' : '/'}${path}`
          : REPO_BASE,
      contact: (subject) =>
        subject
          ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
          : `mailto:${CONTACT_EMAIL}`,
      screenshots: (filename) => `${import.meta.env.BASE_URL}screenshots/${filename}`,
    },
  }

  const filtered =
    filter === 'All'
      ? INTEGRATIONS
      : INTEGRATIONS.filter((i) => i.category === filter)

  const inboundCount = INTEGRATIONS.filter((i) => i.direction === 'inbound').length
  const outboundCount = INTEGRATIONS.filter((i) => i.direction === 'outbound').length

  return (
    <MarketingProvider value={theme}>
      {/* `flex-1 min-h-0 overflow-y-auto`, not `min-h-screen`: the app shell
          (styles/base-and-density.css) makes html/body/#root `overflow:hidden`
          and expects <main> to be the single scroll owner. This page asked for
          `min-h-screen` instead, so it overflowed a clipped flex parent with
          no scroller anywhere — a visitor saw the hero and the first card row
          and could not reach the other 21 integrations, the SDK call-out, or
          the footer at any viewport width. */}
      <main className="mushi-marketing-surface min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-10 px-6 pb-16 pt-4">

          {/* ── Sticky nav (mirrors PublicHomePage) ──────────────────── */}
          <header className="sticky top-3 z-30 flex items-center justify-between rounded-full border border-editorial-rule bg-editorial-paper px-4 py-2 shadow-[0_18px_40px_-32px_rgba(14,13,11,0.5)] backdrop-blur sm:px-5">
            <Link
              to="/"
              className="flex items-center gap-2 font-serif text-base font-semibold text-editorial-ink"
              aria-label="Mushi Mushi home"
            >
              <span
                aria-hidden
                className="grid h-7 w-7 place-items-center rounded-sm bg-editorial-vermillion font-mono text-xs text-editorial-paper shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]"
              >
                虫
              </span>
              <span>Mushi Mushi</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm sm:gap-2">
              <a
                href={`${DOCS_BASE}/`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.18em] text-editorial-ink-muted transition hover:bg-editorial-vermillion/10 hover:text-editorial-vermillion focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-vermillion"
              >
                Docs
              </a>
              <Link
                to="/login"
                className="rounded-full px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.18em] text-editorial-ink-muted transition hover:bg-editorial-vermillion/10 hover:text-editorial-vermillion focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-vermillion"
              >
                Sign in
              </Link>
              <Link
                to="/dashboard"
                className="ml-1 rounded-full bg-editorial-ink px-3 py-1.5 font-mono text-2xs font-medium uppercase tracking-[0.18em] text-editorial-paper shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--color-editorial-ink)_82%,var(--color-editorial-vermillion))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-vermillion"
              >
                Get started
              </Link>
            </nav>
          </header>

          {/* ── Hero ─────────────────────────────────────────────────── */}
          <section
            aria-labelledby="integrations-heading"
            className="rounded-[1.5rem] border border-editorial-rule bg-editorial-paper px-5 py-8 sm:px-8 sm:py-10"
          >
            <p className="font-mono text-2xs uppercase tracking-[0.32em] text-editorial-ink-muted">
              <span className="text-editorial-ink">Ecosystem</span>
              <span className="mx-2 opacity-40">/</span>
              plug in, don&rsquo;t rip out
            </p>
            <h1
              id="integrations-heading"
              className="mt-2 max-w-2xl font-serif text-2xl leading-snug tracking-[-0.02em] text-editorial-ink sm:text-3xl"
            >
              {inboundCount} sources in. {outboundCount} destinations out.
            </h1>
            <p className="mt-3 max-w-2xl text-[1.0625rem] leading-relaxed text-editorial-ink-muted">
              Mushi is the layer between your existing observability stack and your
              team&rsquo;s workflow tools. Wire an inbound adapter to receive alerts from
              Datadog, Sentry, or Crashlytics — then route triaged reports out to
              Jira, Slack, or PagerDuty without changing how your team operates.
            </p>

            {/* Stats row */}
            <div className="mt-6 flex flex-wrap gap-4">
              {[
                { n: inboundCount, label: 'Inbound adapters', hint: 'receive from' },
                { n: outboundCount, label: 'Outbound plugins', hint: 'route to' },
                { n: CATEGORIES.length - 1, label: 'Categories' },
              ].map(({ n, label, hint }) => (
                <div
                  key={label}
                  className="rounded-xl border border-editorial-rule bg-editorial-paper px-4 py-3"
                >
                  <p className="font-serif text-2xl font-semibold leading-none text-editorial-ink">
                    {n}
                  </p>
                  <p className="mt-1 font-mono text-2xs uppercase tracking-[0.16em] text-editorial-ink-muted">
                    {hint ? <span className="opacity-60">{hint} </span> : null}
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Filter bar ───────────────────────────────────────────── */}
          <div className="space-y-2">
            {/* The row previously opened straight into pills with no cue that
                they were interactive. One quiet labelled glyph is cheaper than
                six category icons — six abstract marks for "Analytics" vs
                "APM & Telemetry" would need learning, whereas the words
                already discriminate. It sits on its own line (rather than
                inline) so it never steals width from the chips and forces an
                orphan onto a second row. */}
            <p
              aria-hidden
              className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-[0.16em] text-editorial-ink-faint"
            >
              <IconSliders size={12} />
              Filter by category
            </p>
            <div
              role="group"
              aria-label="Filter integrations by category"
              className="flex flex-wrap gap-1.5"
            >
              {CATEGORIES.map((cat) => (
                <Btn
                  key={cat}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilter(cat)}
                  aria-pressed={filter === cat}
                  className={`rounded-full px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.16em] ${
                    // Solid ink for the active chip rather than a vermillion
                    // wash: the wash sat only a shade off the paper card, so
                    // the row read as seven equal pills. Solid inversion is the
                    // same "you are here" signal the nav's Get started uses.
                    // `!` for the same reason as CopyButton — Btn's ghost
                    // variant otherwise paints its console fg over these.
                    filter === cat
                      ? '!border-editorial-ink !bg-editorial-ink !text-editorial-paper hover:!bg-editorial-ink hover:!text-editorial-paper hover:!border-editorial-ink'
                      : '!border-editorial-rule !bg-editorial-paper-card !text-editorial-ink-muted hover:!border-editorial-ink-rule hover:!bg-editorial-paper-sink hover:!text-editorial-ink'
                  }`}
                >
                  {cat}
                  {cat !== 'All' && (
                    <span className={filter === cat ? 'ml-1.5 opacity-70' : 'ml-1.5 opacity-50'}>
                      {INTEGRATIONS.filter((i) => i.category === cat).length}
                    </span>
                  )}
                </Btn>
              ))}
            </div>
          </div>

          {/* ── Grid ─────────────────────────────────────────────────── */}
          {filtered.length > 0 ? (
            <section aria-label={`${filter} integrations`}>
              {/* Inbound group */}
              {filter === 'All' && (
                <GroupLabel
                  direction="inbound"
                  count={INTEGRATIONS.filter((i) => i.direction === 'inbound').length}
                />
              )}
              <ul
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                aria-label={filter === 'All' ? 'Inbound adapters' : undefined}
              >
                {filtered
                  .filter((i) =>
                    filter === 'All' ? i.direction === 'inbound' : true,
                  )
                  .map((i) => (
                    <li key={`${i.direction}-${i.name}`}>
                      <IntegrationTile integration={i} />
                    </li>
                  ))}
              </ul>

              {/* Outbound + SDK group */}
              {filter === 'All' && (
                <>
                  <GroupLabel
                    direction="outbound"
                    count={
                      INTEGRATIONS.filter(
                        (i) => i.direction === 'outbound' || i.direction === 'sdk',
                      ).length
                    }
                  />
                  <ul
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    aria-label="Outbound plugins"
                  >
                    {filtered
                      .filter(
                        (i) =>
                          i.direction === 'outbound' || i.direction === 'sdk',
                      )
                      .map((i) => (
                        <li key={`${i.direction}-${i.name}`}>
                          <IntegrationTile integration={i} />
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </section>
          ) : (
            <p className="py-10 text-center text-editorial-ink-muted">
              No integrations in this category yet.
            </p>
          )}

          {/* ── SDK call-out ─────────────────────────────────────────── */}
          <aside
            aria-label="Build your own integration"
            className="rounded-[1.5rem] border border-editorial-rule px-5 py-8 sm:px-8"
            style={{
              background:
                'linear-gradient(135deg, var(--color-editorial-paper) 0%, color-mix(in oklch, var(--color-editorial-vermillion) 8%, var(--color-editorial-paper)) 100%)',
            }}
          >
            <p className="font-mono text-2xs uppercase tracking-[0.32em] text-editorial-ink-muted">
              <span className="text-editorial-vermillion">Plugin SDK</span>
              <span className="mx-2 opacity-40">/</span>
              yours in minutes
            </p>
            <h2 className="mt-2 font-serif text-xl leading-snug tracking-[-0.02em] text-editorial-ink sm:text-2xl">
              Don&rsquo;t see your tool? Build the adapter.
            </h2>
            <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-editorial-ink-muted">
              <code className="rounded bg-editorial-paper-wash px-1.5 py-0.5 font-mono text-[0.8125rem] text-editorial-ink">
                @mushi-mushi/plugin-sdk
              </code>{' '}
              exposes the same webhook-to-report and report-to-destination
              interface the built-in adapters use. Ship a custom plugin in a
              single TypeScript file.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={`${DOCS_BASE}/integrations/plugin-sdk`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-editorial-ink px-4 py-2 font-mono text-2xs font-medium uppercase tracking-[0.18em] text-editorial-paper shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--color-editorial-ink)_82%,var(--color-editorial-vermillion))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-vermillion"
              >
                <IconExternalLink size={12} />
                Read the SDK docs
              </a>
              <a
                href={`${REPO_BASE}/blob/main/packages/plugin-sdk`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-editorial-rule bg-editorial-paper px-4 py-2 font-mono text-2xs uppercase tracking-[0.18em] text-editorial-ink-muted transition hover:border-editorial-ink/30 hover:text-editorial-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-vermillion"
              >
                {/* The one place a brand mark genuinely identifies the
                    destination — "View on GitHub" and "Read the SDK docs" were
                    otherwise two same-shaped pills side by side. */}
                <IconGithub size={12} />
                View on GitHub
              </a>
            </div>
          </aside>

          <MarketingFooter />
        </div>
      </main>
    </MarketingProvider>
  )
}

// ─── Group label ──────────────────────────────────────────────────────────

function GroupLabel({
  direction,
  count,
}: {
  direction: 'inbound' | 'outbound'
  count: number
}) {
  return (
    <div className="mb-3 mt-2 flex items-center gap-3">
      <p className="font-mono text-2xs font-semibold uppercase tracking-[0.24em] text-editorial-ink">
        <span
          className={`mr-1.5 ${direction === 'inbound' ? 'text-editorial-vermillion' : 'text-editorial-ink-muted'}`}
          aria-hidden
        >
          {direction === 'inbound' ? '→' : '←'}
        </span>
        {/* Plain JS string, not JSX text — an HTML entity here renders
            literally, so this header read "OUTBOUND PLUGINS &AMP; SDK". */}
        {direction === 'inbound' ? 'Inbound adapters' : 'Outbound plugins & SDK'}
        <span className="ml-2 font-normal opacity-50">{count}</span>
      </p>
      <div
        aria-hidden
        className="h-px flex-1"
        style={{ background: 'var(--color-editorial-rule)' }}
      />
    </div>
  )
}
