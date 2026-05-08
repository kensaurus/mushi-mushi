/**
 * FILE: apps/admin/src/components/VersionBadge.tsx
 * PURPOSE: Replaces the cryptic ✦ "What's new" icon in the desktop header
 *          with a tangible version pill (`SDK 0.9.0 · Admin 0.1.0`) that
 *          reveals a rich popover on hover/focus showing:
 *            - All package versions + build SHA + build date
 *            - The latest changelog entry inline (top 3 highlights)
 *            - Direct links to the admin / edge-function / SDK CI/CD
 *              workflows and the GitHub release feed.
 *
 *          Why a hover popover (not a modal): the version + last release
 *          line is glanceable info an operator should read without leaving
 *          the page they're on. The full changelog modal stays one click
 *          away via the "Read full changelog" footer link, preserving the
 *          existing flow.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { useWhatsNew } from './WhatsNew'
import { Badge } from './ui'

interface VersionBadgeProps {
  whatsNew: ReturnType<typeof useWhatsNew>
}

const REPO_URL = 'https://github.com/kensaurus/mushi-mushi'

interface PipelineLink {
  label: string
  href: string
  hint: string
}

const PIPELINE_LINKS: PipelineLink[] = [
  {
    label: 'Admin CI/CD',
    href: `${REPO_URL}/actions/workflows/deploy-admin.yml`,
    hint: 'Builds and deploys this console to S3 + CloudFront on every push to master.',
  },
  {
    label: 'Edge Functions CI/CD',
    href: `${REPO_URL}/actions/workflows/deploy-edge-functions.yml`,
    hint: 'Deploys the Supabase Edge Functions that back /v1/* — the backend + DB pipeline.',
  },
  {
    label: 'SDK Release',
    href: `${REPO_URL}/actions/workflows/release.yml`,
    hint: 'Publishes @mushi-mushi/web, /react, etc. to npm via Changesets.',
  },
  {
    label: 'All releases',
    href: `${REPO_URL}/releases`,
    hint: 'Versioned tags and per-release notes on GitHub.',
  },
]

const TONE_BADGE: Record<'feature' | 'fix' | 'breaking' | 'note', string> = {
  feature:  'bg-brand/15 text-brand border border-brand/30',
  fix:      'bg-ok-muted text-ok border border-ok/30',
  breaking: 'bg-danger/15 text-danger border border-danger/30',
  note:     'bg-surface-overlay text-fg-secondary border border-edge/60',
}
const TONE_LABEL: Record<'feature' | 'fix' | 'breaking' | 'note', string> = {
  feature: 'New', fix: 'Fix', breaking: 'Breaking', note: 'Note',
}

// Small grace period so the popover stays open while the cursor is in
// transit between the trigger pill and the panel itself. 120ms is the
// shortest interval that survives a slow-flick across the viewport without
// feeling sticky on accidental hover-outs.
const CLOSE_DELAY_MS = 120

/** Neon text treatment — SDK = published `@mushi-mushi/web` on npm; ADMIN = this SPA. */
const NEON_SDK_LABEL =
  'text-cyan-200 [text-shadow:0_0_10px_oklch(0.82_0.14_205),0_0_22px_oklch(0.55_0.08_205)]'
const NEON_SDK_VER =
  'text-cyan-100 [text-shadow:0_0_8px_oklch(0.88_0.12_205),0_0_18px_oklch(0.62_0.09_205)] tabular-nums'
const NEON_ADMIN_LABEL =
  'text-fuchsia-200 [text-shadow:0_0_10px_oklch(0.78_0.20_320),0_0_22px_oklch(0.52_0.12_320)]'
const NEON_ADMIN_VER =
  'text-fuchsia-100 [text-shadow:0_0_8px_oklch(0.84_0.16_320),0_0_18px_oklch(0.58_0.10_320)] tabular-nums'

export function VersionBadge({ whatsNew }: VersionBadgeProps) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }, [cancelClose])
  useEffect(() => () => cancelClose(), [cancelClose])

  // Click-outside + Escape handlers for keyboard / touch users. Hover
  // alone wouldn't dismiss for a focus-driven open, so we mirror the
  // dropdown pattern used by Org/Project switchers.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const latest = whatsNew.entries[0]
  const topHighlights = (latest?.highlights ?? []).slice(0, 3)

  const handleReadFull = () => {
    setOpen(false)
    whatsNew.openPanel()
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-flex"
      onMouseEnter={() => { cancelClose(); setOpen(true) }}
      onMouseLeave={scheduleClose}
      onBlurCapture={(e) => {
        // Tab out of the whole popover region → close. Focus moving from the
        // button into a link inside the popover keeps it open because
        // `e.relatedTarget` is still contained in `containerRef`. We don't
        // open on focus — the button is a real button, so the user must
        // click/Enter to activate, matching the WAI-ARIA `dialog` pattern
        // for buttons that toggle visibility (vs a tooltip-only role).
        if (!containerRef.current?.contains(e.relatedTarget as Node | null)) scheduleClose()
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Versions — SDK (@mushi-mushi/web) ${__SDK_WEB_VERSION__}, Admin console ${__APP_VERSION__}${whatsNew.hasUnread ? ', new updates available' : ''}`}
        title={`npm @mushi-mushi/web ${__SDK_WEB_VERSION__} · Admin app ${__APP_VERSION__} · ${__BUILD_SHA__}`}
        className={`group relative inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-cyan-500/35 bg-gradient-to-r from-cyan-500/10 via-surface-raised/50 to-fuchsia-500/10 shadow-[0_0_18px_oklch(0.55_0.12_260/0.28)] hover:shadow-[0_0_22px_oklch(0.55_0.14_260/0.38)] hover:border-cyan-400/45 motion-safe:transition-[box-shadow,border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
          open ? 'bg-surface-overlay border-fuchsia-400/40' : ''
        }`}
      >
        {/* Compact (md..lg): SDK version only — the figure embedders watch. */}
        <span
          aria-hidden
          className="lg:hidden font-mono text-2xs leading-none"
          title="@mushi-mushi/web (browser SDK on npm)"
        >
          <span className={NEON_SDK_LABEL}>SDK </span>
          <span className={NEON_SDK_VER}>{__SDK_WEB_VERSION__}</span>
        </span>
        <span
          aria-hidden
          className="hidden lg:inline text-3xs font-semibold uppercase tracking-wider leading-none"
          title="@mushi-mushi/web — browser SDK published to npm"
        >
          <span className={NEON_SDK_LABEL}>SDK</span>
        </span>
        <span
          className="hidden lg:inline font-mono text-2xs leading-none"
          title="@mushi-mushi/web"
        >
          <span className={NEON_SDK_VER}>{__SDK_WEB_VERSION__}</span>
        </span>
        <span aria-hidden className="hidden lg:inline text-fg-faint/80 text-2xs leading-none">
          ·
        </span>
        <span
          aria-hidden
          className="hidden lg:inline text-3xs font-semibold uppercase tracking-wider leading-none"
          title="This admin console (Vite SPA) — not the customer-facing SDK"
        >
          <span className={NEON_ADMIN_LABEL}>Admin</span>
        </span>
        <span
          className="hidden lg:inline font-mono text-2xs leading-none"
          title="Admin console build"
        >
          <span className={NEON_ADMIN_VER}>{__APP_VERSION__}</span>
        </span>
        {whatsNew.hasUnread && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse"
            title="New release notes"
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Version details and release notes"
          className="absolute right-0 top-full mt-1.5 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-md border border-edge bg-surface-raised shadow-raised overflow-hidden tooltip-enter"
        >
          <div className="px-3 py-2.5 border-b border-edge-subtle/60 flex items-baseline justify-between gap-2">
            <div>
              <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint leading-none">Running</p>
              <p className="mt-1 text-sm font-semibold text-fg leading-none">
                <span className="text-brand">mushi</span><span className="text-fg-secondary">mushi</span>
                <span className="ml-1.5 font-mono text-xs tabular-nums text-fg-secondary">v{__APP_VERSION__}</span>
              </p>
              <p className="mt-1.5 text-2xs text-fg-muted leading-snug max-w-[16rem]">
                <span className="text-cyan-300 font-medium">SDK</span> = <code className="font-mono text-fg-secondary">@mushi-mushi/web</code> on npm (what you embed).
                {' '}
                <span className="text-fuchsia-300 font-medium">Admin</span> = this dashboard SPA (operator console).
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xs font-mono text-fg-muted leading-none">{__BUILD_SHA__}</p>
              <p className="mt-1 text-3xs text-fg-faint leading-none">{__BUILD_DATE__}</p>
            </div>
          </div>

          {/* Package versions — gives operators an at-a-glance check that
              the SDK on the page matches the one their own apps embed.
              Each row links to npmjs so the user can copy install snippets,
              read READMEs, or audit the published tarball without leaving
              the badge flow. */}
          <div className="px-3 py-2.5 border-b border-edge-subtle/60">
            <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Packages</p>
            <dl className="mt-1.5 space-y-0.5 text-2xs">
              <PackageRow
                name="@mushi-mushi/web"
                version={__SDK_WEB_VERSION__}
                hint="Browser SDK (Shadow DOM widget) — open on npmjs"
                npmName="@mushi-mushi/web"
              />
              <PackageRow
                name="@mushi-mushi/react"
                version={__SDK_REACT_VERSION__}
                hint="React bindings — open on npmjs"
                npmName="@mushi-mushi/react"
              />
              <PackageRow
                name="@mushi-mushi/server"
                version={__SERVER_VERSION__}
                hint="Edge Functions backend (private — links to repo source)"
                // server is private (version 0.0.0). No npm page exists; link
                // to the directory on GitHub so operators land somewhere real.
                githubPath="packages/server"
              />
            </dl>
          </div>

          {/* Latest changelog entry — keeps the user from having to open the
              modal for the most common case ("what shipped most recently?"). */}
          <div className="px-3 py-2.5 border-b border-edge-subtle/60">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">
                Latest release
              </p>
              {whatsNew.hasUnread && (
                <span className="text-3xs font-medium text-brand">• Unread</span>
              )}
            </div>
            {latest ? (
              <div className="mt-1.5">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-xs font-semibold text-fg leading-snug truncate">{latest.title}</h3>
                  <span className="text-3xs font-mono tabular-nums text-fg-faint shrink-0">{latest.date}</span>
                </div>
                {topHighlights.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {topHighlights.map((h, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <Badge className={`${TONE_BADGE[h.tone]} shrink-0 text-3xs`}>{TONE_LABEL[h.tone]}</Badge>
                        <span className="text-2xs text-fg-secondary leading-snug line-clamp-2">{h.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={handleReadFull}
                  className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-brand hover:text-brand-hover motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
                >
                  Read full changelog
                  <span aria-hidden>→</span>
                </button>
              </div>
            ) : (
              <p className="mt-1.5 text-2xs text-fg-muted">No release notes yet.</p>
            )}
          </div>

          {/* Pipelines — the "where do versions come from?" answer for any
              operator clicking the badge to investigate a deploy concern. */}
          <div className="px-3 py-2.5">
            <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Pipelines</p>
            <ul className="mt-1.5 grid grid-cols-2 gap-1">
              {PIPELINE_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={link.hint}
                    className="group flex items-center justify-between gap-1 rounded-sm px-1.5 py-1 text-2xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  >
                    <span className="truncate">{link.label}</span>
                    <span aria-hidden className="text-fg-faint group-hover:text-fg-muted shrink-0">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function PackageRow({
  name,
  version,
  hint,
  npmName,
  githubPath,
}: {
  name: string
  version: string
  hint: string
  /** When set, the row becomes a link to https://www.npmjs.com/package/<npmName>. */
  npmName?: string
  /** Fallback for private/non-published packages — links to the GitHub source dir. */
  githubPath?: string
}) {
  // npm wins over github so the public-facing page is the default destination.
  const href = npmName
    ? `https://www.npmjs.com/package/${npmName}`
    : githubPath
      ? `${REPO_URL}/tree/master/${githubPath}`
      : null
  const Tag = href ? 'a' : 'div'
  return (
    <Tag
      {...(href ? { href, target: '_blank', rel: 'noreferrer noopener' } : {})}
      className={`group flex items-baseline justify-between gap-2 rounded-sm px-1 -mx-1 py-0.5 ${
        href ? 'hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50' : ''
      }`}
      title={hint}
    >
      <dt className="font-mono text-2xs text-fg-muted truncate flex items-baseline gap-1">
        {name}
        {href && (
          <span aria-hidden className="text-fg-faint group-hover:text-fg-muted shrink-0 leading-none">↗</span>
        )}
      </dt>
      <dd className="font-mono text-2xs tabular-nums text-fg-secondary shrink-0">{version}</dd>
    </Tag>
  )
}
