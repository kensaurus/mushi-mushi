/**
 * FILE: apps/admin/src/pages/PublicIntegrationsPage.tsx
 * PURPOSE: Public marketing page at `/integrations` — lists all inbound
 *          adapters and outbound plugins with category filtering, install
 *          copy, and docs links. Publicly accessible (no auth gate).
 *
 * VISUAL SYSTEM: matches PublicHomePage — same MarketingProvider wrapper,
 *   same sticky nav header, same --mushi-* token usage, same MarketingFooter.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
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
  pkg: string
  direction: 'inbound' | 'outbound' | 'sdk'
  category: Exclude<Category, 'All'>
  description: string
}

const INTEGRATIONS: Integration[] = [
  // ── Inbound adapters ──────────────────────────────────────────────────
  {
    name: 'Datadog',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Forward APM alerts and metric spikes as Mushi reports.',
  },
  {
    name: 'New Relic',
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
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Forward Loki log alerts as enriched Mushi reports.',
  },
  {
    name: 'CloudWatch',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Import AWS CloudWatch alarms directly into Mushi.',
  },
  {
    name: 'Sentry',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Import Sentry issue webhooks with stack traces intact.',
  },
  {
    name: 'Bugsnag',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Receive Bugsnag error alerts and map them to user reports.',
  },
  {
    name: 'Rollbar',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Ingest Rollbar occurrences into the Mushi triage queue.',
  },
  {
    name: 'Crashlytics',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Mobile',
    description: 'Pull Firebase Crashlytics crashes into the report feed.',
  },
  {
    name: 'Firebase Analytics',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Analytics',
    description: 'Correlate funnel-drop events with user-felt friction.',
  },
  {
    name: 'OpsGenie',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Project Management',
    description: 'Convert OpsGenie alerts into triaged Mushi reports.',
  },
  // ── Outbound plugins ──────────────────────────────────────────────────
  {
    name: 'Sentry',
    pkg: '@mushi-mushi/plugin-sentry',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Resolve Sentry issues when Mushi fixes land in production.',
  },
  {
    name: 'Bugsnag',
    pkg: '@mushi-mushi/plugin-bugsnag',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Close Bugsnag errors when Mushi confirms the fix is live.',
  },
  {
    name: 'Rollbar',
    pkg: '@mushi-mushi/plugin-rollbar',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Mark Rollbar items resolved when Mushi deploys a fix.',
  },
  {
    name: 'Crashlytics',
    pkg: '@mushi-mushi/plugin-crashlytics',
    direction: 'outbound',
    category: 'Mobile',
    description: 'Sync crash resolution status back to Firebase Crashlytics.',
  },
  {
    name: 'Slack',
    pkg: '@mushi-mushi/plugin-slack-app',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Post report digests and AI triage summaries to Slack.',
  },
  {
    name: 'Discord',
    pkg: '@mushi-mushi/plugin-discord',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Deliver report alerts and fix summaries to Discord channels.',
  },
  {
    name: 'MS Teams',
    pkg: '@mushi-mushi/plugin-msteams',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Route Mushi alerts to Microsoft Teams channels.',
  },
  {
    name: 'Jira',
    pkg: '@mushi-mushi/plugin-jira',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Create Jira tickets automatically from triaged reports.',
  },
  {
    name: 'Linear',
    pkg: '@mushi-mushi/plugin-linear',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Push triaged bugs and fix tasks to Linear cycles.',
  },
  {
    name: 'PagerDuty',
    pkg: '@mushi-mushi/plugin-pagerduty',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Trigger PagerDuty incidents for critical user-reported issues.',
  },
  {
    name: 'GitHub Issues',
    pkg: '@mushi-mushi/plugin-github-issues',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Open GitHub Issues for triaged bugs with full AI context.',
  },
  {
    name: 'Zapier',
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

function letterIcon(name: string): string {
  return name.charAt(0).toUpperCase()
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

  return (
    <button
      type="button"
      onClick={() => { void handleCopy() }}
      className="inline-flex items-center gap-1 rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] px-2.5 py-1 font-mono text-[10px] text-[var(--mushi-ink-muted)] transition hover:border-[var(--mushi-vermillion)]/40 hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]"
      title={`Copy: ${text}`}
      aria-label={label}
    >
      {state === 'copied' ? (
        <>
          <span aria-hidden>✓</span>
          <span>Copied</span>
        </>
      ) : state === 'error' ? (
        <>
          <span aria-hidden>!</span>
          <span>Copy failed</span>
        </>
      ) : (
        <>
          <span aria-hidden className="opacity-60">$</span>
          <span>Copy install</span>
        </>
      )}
    </button>
  )
}

function IntegrationTile({ integration }: { integration: Integration }) {
  const isInbound = integration.direction === 'inbound'
  const isSdk = integration.direction === 'sdk'
  const installCmd = `npm install ${integration.pkg}`
  const docsHref = `${DOCS_BASE}/integrations/${integration.name.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <article className="group flex flex-col gap-3 rounded-xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_96%,white)] p-4 transition hover:border-[color-mix(in_oklch,var(--mushi-ink)_25%,var(--mushi-rule))] hover:shadow-[0_4px_20px_-8px_rgba(14,13,11,0.12)]">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* Colored letter icon */}
          <div
            aria-hidden
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-serif text-sm font-semibold shadow-[inset_0_-2px_0_rgba(0,0,0,0.15)] ${
              isInbound
                ? 'bg-[var(--mushi-vermillion)] text-white'
                : isSdk
                  ? 'bg-[var(--mushi-ink)] text-[var(--mushi-paper)]'
                  : 'bg-[color-mix(in_oklch,var(--mushi-ink)_85%,white)] text-[var(--mushi-paper)]'
            }`}
          >
            {letterIcon(integration.name)}
          </div>
          <div>
            <p className="font-medium leading-none text-[var(--mushi-ink)]">
              {integration.name}
            </p>
            <p className="mt-1 font-mono text-[10px] text-[var(--mushi-ink-faint)]">
              {integration.pkg}
            </p>
          </div>
        </div>
        {/* Direction badge */}
        <span
          className={`shrink-0 self-start rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] ${
            isInbound
              ? 'border-[var(--mushi-vermillion)]/30 bg-[var(--mushi-vermillion-wash)] text-[var(--mushi-vermillion)]'
              : isSdk
                ? 'border-[var(--mushi-rule)] bg-[var(--mushi-paper-wash)] text-[var(--mushi-ink-muted)]'
                : 'border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] text-[var(--mushi-ink-muted)]'
          }`}
        >
          {isInbound ? '→ inbound' : isSdk ? 'sdk' : '← outbound'}
        </span>
      </div>

      {/* Description */}
      <p className="text-[0.8125rem] leading-relaxed text-[var(--mushi-ink-muted)]">
        {integration.description}
      </p>

      {/* Footer actions */}
      <div className="mt-auto flex items-center gap-2">
        <CopyButton text={installCmd} />
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-paper-wash)] hover:text-[var(--mushi-ink)]"
        >
          Docs
          <span aria-hidden className="text-[9px] opacity-50">↗</span>
        </a>
      </div>
    </article>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────

export function PublicIntegrationsPage() {
  const [filter, setFilter] = useState<Category>('All')

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
      <main className="mushi-marketing-surface min-h-screen">
        <div className="mx-auto max-w-6xl space-y-10 px-6 pb-16 pt-4">

          {/* ── Sticky nav (mirrors PublicHomePage) ──────────────────── */}
          <header className="sticky top-3 z-30 flex items-center justify-between rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] px-4 py-2 shadow-[0_18px_40px_-32px_rgba(14,13,11,0.5)] backdrop-blur sm:px-5">
            <Link
              to="/"
              className="flex items-center gap-2 font-serif text-base font-semibold text-[var(--mushi-ink)]"
              aria-label="Mushi Mushi home"
            >
              <span
                aria-hidden
                className="grid h-7 w-7 place-items-center rounded-sm bg-[var(--mushi-vermillion)] font-mono text-xs text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]"
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
                className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]"
              >
                Docs
              </a>
              <Link
                to="/login"
                className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:bg-[var(--mushi-vermillion-wash)] hover:text-[var(--mushi-vermillion)]"
              >
                Sign in
              </Link>
              <Link
                to="/dashboard"
                className="ml-1 rounded-full bg-[var(--mushi-ink)] px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--mushi-paper)] shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--mushi-ink)_82%,var(--mushi-vermillion))]"
              >
                Get started
              </Link>
            </nav>
          </header>

          {/* ── Hero ─────────────────────────────────────────────────── */}
          <section
            aria-labelledby="integrations-heading"
            className="rounded-[1.5rem] border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_94%,white)] px-5 py-8 sm:px-8 sm:py-10"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--mushi-ink-muted)]">
              <span className="text-[var(--mushi-ink)]">Ecosystem</span>
              <span className="mx-2 opacity-40">/</span>
              plug in, don&rsquo;t rip out
            </p>
            <h1
              id="integrations-heading"
              className="mt-2 max-w-2xl font-serif text-2xl leading-snug tracking-[-0.02em] text-[var(--mushi-ink)] sm:text-3xl"
            >
              {inboundCount} sources in. {outboundCount} destinations out.
            </h1>
            <p className="mt-3 max-w-2xl text-[1.0625rem] leading-relaxed text-[var(--mushi-ink-muted)]">
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
                  className="rounded-xl border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_88%,white)] px-4 py-3"
                >
                  <p className="font-serif text-2xl font-semibold leading-none text-[var(--mushi-ink)]">
                    {n}
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--mushi-ink-muted)]">
                    {hint ? <span className="opacity-60">{hint} </span> : null}
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Filter bar ───────────────────────────────────────────── */}
          <div
            role="group"
            aria-label="Filter integrations by category"
            className="flex flex-wrap gap-1.5"
          >
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                aria-pressed={filter === cat}
                className={`rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition ${
                  filter === cat
                    ? 'border-[var(--mushi-vermillion)]/50 bg-[var(--mushi-vermillion-wash)] text-[var(--mushi-vermillion)]'
                    : 'border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_94%,white)] text-[var(--mushi-ink-muted)] hover:border-[color-mix(in_oklch,var(--mushi-ink)_20%,var(--mushi-rule))] hover:text-[var(--mushi-ink)]'
                }`}
              >
                {cat}
                {cat !== 'All' && (
                  <span className="ml-1.5 opacity-50">
                    {INTEGRATIONS.filter((i) => i.category === cat).length}
                  </span>
                )}
              </button>
            ))}
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
            <p className="py-10 text-center text-[var(--mushi-ink-muted)]">
              No integrations in this category yet.
            </p>
          )}

          {/* ── SDK call-out ─────────────────────────────────────────── */}
          <aside
            aria-label="Build your own integration"
            className="rounded-[1.5rem] border border-[var(--mushi-rule)] px-5 py-8 sm:px-8"
            style={{
              background:
                'linear-gradient(135deg, color-mix(in oklch, var(--mushi-paper) 94%, white) 0%, var(--mushi-vermillion-wash) 100%)',
            }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--mushi-ink-muted)]">
              <span className="text-[var(--mushi-vermillion)]">Plugin SDK</span>
              <span className="mx-2 opacity-40">/</span>
              yours in minutes
            </p>
            <h2 className="mt-2 font-serif text-xl leading-snug tracking-[-0.02em] text-[var(--mushi-ink)] sm:text-2xl">
              Don&rsquo;t see your tool? Build the adapter.
            </h2>
            <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-[var(--mushi-ink-muted)]">
              <code className="rounded bg-[var(--mushi-paper-wash)] px-1.5 py-0.5 font-mono text-[0.8125rem] text-[var(--mushi-ink)]">
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
                className="rounded-full bg-[var(--mushi-ink)] px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--mushi-paper)] shadow-[inset_0_-2px_0_rgba(255,255,255,0.18)] transition hover:bg-[color-mix(in_oklch,var(--mushi-ink)_82%,var(--mushi-vermillion))]"
              >
                Read the SDK docs
              </a>
              <a
                href={`${REPO_BASE}/blob/main/packages/plugin-sdk`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:border-[color-mix(in_oklch,var(--mushi-ink)_30%,var(--mushi-rule))] hover:text-[var(--mushi-ink)]"
              >
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
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--mushi-ink)]">
        <span
          className={`mr-1.5 ${direction === 'inbound' ? 'text-[var(--mushi-vermillion)]' : 'text-[var(--mushi-ink-muted)]'}`}
          aria-hidden
        >
          {direction === 'inbound' ? '→' : '←'}
        </span>
        {direction === 'inbound' ? 'Inbound adapters' : 'Outbound plugins &amp; SDK'}
        <span className="ml-2 font-normal opacity-50">{count}</span>
      </p>
      <div
        aria-hidden
        className="h-px flex-1"
        style={{ background: 'var(--mushi-rule)' }}
      />
    </div>
  )
}
