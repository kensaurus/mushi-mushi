/**
 * FILE: apps/admin/src/components/VersionBadge.tsx
 * PURPOSE: Replaces the cryptic "What's new" icon in the desktop header
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

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { useWhatsNew } from './WhatsNew'
import { Badge } from './ui'
import {
  IconDashboard,
  IconGauge,
  IconGithub,
  IconGlobe,
  IconIntegrations,
  IconIterate,
  IconNetwork,
  IconReleases,
  IconStorage,
  IconTerminal,
} from './icons'
import { headerDropdownPanelClass } from '../lib/appChrome'
import { CHIP_TONE } from '../lib/chipTone'

interface VersionBadgeProps {
  whatsNew: ReturnType<typeof useWhatsNew>
}

const REPO_URL = 'https://github.com/kensaurus/mushi-mushi'

type AccentTone = 'info' | 'warn' | 'ok' | 'brand' | 'accent'
type VersionPillTone = 'neutral' | 'sdk' | 'admin' | 'tool' | 'plugin' | 'runtime'

interface AccentTheme {
  chip: string
  header: string
  rail: string
  text: string
  pill: VersionPillTone
}

const ACCENT_THEMES: Record<AccentTone, AccentTheme> = {
  info: {
    chip: `${CHIP_TONE.infoSubtle} border border-info/35`,
    header: 'bg-info/10 border-info/25',
    rail: 'border-l-info/55',
    text: 'text-info-foreground',
    pill: 'sdk',
  },
  warn: {
    chip: `${CHIP_TONE.warnSubtle} border border-warn/35`,
    header: 'bg-warn/10 border-warn/25',
    rail: 'border-l-warn/55',
    text: 'text-warning-foreground',
    pill: 'tool',
  },
  ok: {
    chip: `${CHIP_TONE.okSubtle} border border-ok/35`,
    header: 'bg-ok/10 border-ok/25',
    rail: 'border-l-ok/55',
    text: 'text-ok-foreground',
    pill: 'runtime',
  },
  brand: {
    chip: `${CHIP_TONE.brandSubtle} border border-brand/35`,
    header: 'bg-brand/10 border-brand/25',
    rail: 'border-l-brand/55',
    text: 'text-brand',
    pill: 'neutral',
  },
  accent: {
    chip: `${CHIP_TONE.accentSubtle} border border-accent/35`,
    header: 'bg-accent/10 border-accent/25',
    rail: 'border-l-accent/55',
    text: 'text-accent-foreground',
    pill: 'plugin',
  },
}

type PackageGroupId = 'SDK' | 'Tooling' | 'Plugins' | 'Runtime'

const PACKAGE_GROUP_META: Record<
  PackageGroupId,
  AccentTheme & { icon: typeof IconGlobe }
> = {
  SDK: { ...ACCENT_THEMES.info, icon: IconGlobe },
  Tooling: { ...ACCENT_THEMES.warn, icon: IconTerminal },
  Plugins: { ...ACCENT_THEMES.accent, icon: IconIntegrations },
  Runtime: { ...ACCENT_THEMES.ok, icon: IconStorage },
}

interface PipelineLink {
  label: string
  href: string
  hint: string
  icon: typeof IconDashboard
  tone: AccentTone
}

const PIPELINE_LINKS: PipelineLink[] = [
  {
    label: 'Admin CI/CD',
    href: `${REPO_URL}/actions/workflows/deploy-admin.yml`,
    hint: 'Builds and deploys this console to S3 + CloudFront on every push to master.',
    icon: IconDashboard,
    tone: 'accent',
  },
  {
    label: 'Edge Functions CI/CD',
    href: `${REPO_URL}/actions/workflows/deploy-edge-functions.yml`,
    hint: 'Deploys the Supabase Edge Functions that back /v1/* — the backend + DB pipeline.',
    icon: IconNetwork,
    tone: 'info',
  },
  {
    label: 'SDK Release',
    href: `${REPO_URL}/actions/workflows/release.yml`,
    hint: 'Publishes @mushi-mushi/web, /react, etc. to npm via Changesets.',
    icon: IconReleases,
    tone: 'warn',
  },
  {
    label: 'All releases',
    href: `${REPO_URL}/releases`,
    hint: 'Versioned tags and per-release notes on GitHub.',
    icon: IconGithub,
    tone: 'ok',
  },
]

const TONE_BADGE: Record<'feature' | 'fix' | 'breaking' | 'note', string> = {
  feature:  'bg-brand/15 text-brand border border-brand/30',
  fix:      CHIP_TONE.okSubtle + ' border border-ok/30',
  breaking: CHIP_TONE.dangerSubtle + ' border border-danger/30',
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

/** Version pill label tones — SDK (info) vs Admin console (accent). */
const SDK_LABEL = 'text-info-foreground font-semibold'
const SDK_VER = 'text-info-foreground tabular-nums'
const ADMIN_LABEL = 'text-accent-foreground font-semibold'
const ADMIN_VER = 'text-accent-foreground tabular-nums'

/** Monospace version chip — scannable at a glance in dense package grids. */
function VersionPill({
  version,
  tone = 'neutral',
}: {
  version: string
  tone?: VersionPillTone
}) {
  const toneClass =
    tone === 'sdk'
      ? `border-info/35 ${CHIP_TONE.infoSubtle}`
      : tone === 'admin'
        ? `border-accent/35 ${CHIP_TONE.accentSubtle}`
        : tone === 'tool'
          ? `border-warn/35 ${CHIP_TONE.warnSubtle}`
          : tone === 'plugin'
            ? `border-accent/35 ${CHIP_TONE.accentSubtle}`
            : tone === 'runtime'
              ? `border-ok/35 ${CHIP_TONE.okSubtle}`
              : 'border-edge/70 bg-surface-overlay text-fg-secondary'
  return (
    <span
      className={`inline-flex min-w-[2.75rem] items-center justify-center rounded-full border px-1.5 py-0.5 font-mono text-2xs font-medium tabular-nums leading-none shrink-0 ${toneClass}`}
    >
      {version}
    </span>
  )
}

function ThemeIconChip({
  icon: Icon,
  theme,
  size = 14,
}: {
  icon: typeof IconGlobe
  theme: AccentTheme
  size?: number
}) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-sm shrink-0 ${theme.chip}`}
      aria-hidden="true"
    >
      <Icon size={size} />
    </span>
  )
}

function SectionDivider({
  label,
  icon,
  theme,
  trailing,
}: {
  label: string
  icon?: typeof IconGlobe
  theme?: AccentTheme
  trailing?: ReactNode
}) {
  const labelClass = theme?.text ?? 'text-fg-muted'
  return (
    <div className="flex items-center gap-2">
      {icon && theme && <ThemeIconChip icon={icon} theme={theme} />}
      <p className={`text-2xs font-semibold uppercase tracking-wider shrink-0 ${labelClass}`}>{label}</p>
      <div className="h-px flex-1 bg-edge" aria-hidden="true" />
      {trailing}
    </div>
  )
}

/** Consistent section shell — full-width rule between every major block. */
function PopoverSection({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`px-3 py-2.5 border-b border-edge ${className}`.trim()}>
      {children}
    </section>
  )
}

function ChangelogHighlightRow({
  tone,
  text,
}: {
  tone: 'feature' | 'fix' | 'breaking' | 'note'
  text: string
}) {
  return (
    <li className="flex items-start gap-2 border-b border-edge-subtle/70 px-2.5 py-2 last:border-b-0">
      <Badge className={`${TONE_BADGE[tone]} shrink-0 text-2xs min-w-[3.25rem] justify-center`}>
        {TONE_LABEL[tone]}
      </Badge>
      <span className="text-2xs text-fg leading-snug">{text}</span>
    </li>
  )
}

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
        className={`group relative inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-edge bg-surface-raised hover:bg-surface-overlay motion-safe:transition-[background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
          open ? 'bg-surface-overlay border-edge-subtle' : ''
        }`}
      >
        {/* Compact (md..lg): SDK version only — the figure embedders watch. */}
        <span
          aria-hidden
          className="lg:hidden font-mono text-2xs leading-none"
          title="@mushi-mushi/web (browser SDK on npm)"
        >
          <span className={SDK_LABEL}>SDK </span>
          <span className={SDK_VER}>{__SDK_WEB_VERSION__}</span>
        </span>
        <span
          aria-hidden
          className="hidden lg:inline text-2xs font-semibold uppercase tracking-wider leading-none"
          title="@mushi-mushi/web — browser SDK published to npm"
        >
          <span className={SDK_LABEL}>SDK</span>
        </span>
        <span
          className="hidden lg:inline font-mono text-2xs leading-none"
          title="@mushi-mushi/web"
        >
          <span className={SDK_VER}>{__SDK_WEB_VERSION__}</span>
        </span>
        <span aria-hidden className="hidden lg:inline text-fg-faint/80 text-2xs leading-none">
          ·
        </span>
        <span
          aria-hidden
          className="hidden lg:inline text-2xs font-semibold uppercase tracking-wider leading-none"
          title="This admin console (Vite SPA) — not the customer-facing SDK"
        >
          <span className={ADMIN_LABEL}>Admin</span>
        </span>
        <span
          className="hidden lg:inline font-mono text-2xs leading-none"
          title="Admin console build"
        >
          <span className={ADMIN_VER}>{__APP_VERSION__}</span>
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
          className={`${headerDropdownPanelClass} mt-1.5 w-[28rem] max-w-[calc(100vw-2rem)] tooltip-enter`}
        >
          <PopoverSection className="bg-accent/5">
            <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <ThemeIconChip icon={IconGauge} theme={ACCENT_THEMES.accent} />
                <p className="text-2xs font-semibold uppercase tracking-wider text-accent leading-none">Running</p>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg leading-none">
                <span>
                  <span className="text-brand">mushi</span><span className="text-fg-secondary">mushi</span>
                </span>
                <VersionPill version={`v${__APP_VERSION__}`} tone="admin" />
              </p>
              <div className="mt-1.5 space-y-0.5">
                <p className="text-2xs text-fg-muted leading-snug max-w-[16rem]">
                  <span className="text-info font-medium">SDK</span> = <code className="font-mono text-fg-secondary">@mushi-mushi/web</code> on npm (what you embed).
                </p>
                <p className="text-2xs text-fg-muted leading-snug max-w-[16rem]">
                  <span className="text-accent font-medium">Admin</span> = this dashboard SPA (operator console).
                </p>
              </div>
            </div>
            <div className="text-right shrink-0 space-y-1">
              <VersionPill version={__BUILD_SHA__} />
              <p className="text-2xs text-fg-faint leading-none">{__BUILD_DATE__}</p>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1.5 inline-flex items-center gap-0.5 text-2xs text-fg-muted hover:text-fg motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
                title="View source on GitHub"
              >
                GitHub <span aria-hidden>↗</span>
              </a>
            </div>
            </div>
          </PopoverSection>

          {/* Package versions — gives operators an at-a-glance check that
              the SDK on the page matches the one their own apps embed.
              Each row links to npmjs so the user can copy install snippets,
              read READMEs, or audit the published tarball without leaving
              the badge flow. Grouped: SDK core, framework bindings, tooling,
              plugin ecosystem, and the private server package. */}
          <PopoverSection>
            <SectionDivider label="Packages" icon={IconGlobe} theme={ACCENT_THEMES.info} />
            <div className="mt-2 space-y-2 text-2xs max-h-[13.5rem] overflow-y-auto overscroll-contain pr-0.5">
              <PackageGroup id="SDK">
                <PackageRow name="@mushi-mushi/core"    version={__SDK_CORE_VERSION__}  hint="Core runtime"          npmName="@mushi-mushi/core" />
                <PackageRow name="web"                  version={__SDK_WEB_VERSION__}   hint="Browser widget (Shadow DOM)" npmName="@mushi-mushi/web" />
                <PackageRow name="react"                version={__SDK_REACT_VERSION__} hint="React bindings"         npmName="@mushi-mushi/react" />
                <PackageRow name="vue"                  version={__SDK_VUE_VERSION__}   hint="Vue bindings"           npmName="@mushi-mushi/vue" />
                <PackageRow name="svelte"               version={__SDK_SVELTE_VERSION__} hint="Svelte bindings"       npmName="@mushi-mushi/svelte" />
                <PackageRow name="angular"              version={__SDK_ANGULAR_VERSION__} hint="Angular bindings"    npmName="@mushi-mushi/angular" />
                <PackageRow name="react-native"         version={__SDK_RN_VERSION__}    hint="React Native bindings"  npmName="@mushi-mushi/react-native" />
              </PackageGroup>
              <PackageGroup id="Tooling">
                <PackageRow name="cli"                  version={__SDK_CLI_VERSION__}   hint="Mushi CLI"              npmName="@mushi-mushi/cli" />
                <PackageRow name="mcp"                  version={__SDK_MCP_VERSION__}   hint="MCP server"             npmName="@mushi-mushi/mcp" />
                <PackageRow name="node"                 version={__SDK_NODE_VERSION__}  hint="Node.js SDK"            npmName="@mushi-mushi/node" />
                <PackageRow name="capacitor"            version={__SDK_CAPACITOR_VERSION__} hint="Capacitor plugin"   npmName="@mushi-mushi/capacitor" />
                <PackageRow name="adapters"             version={__SDK_ADAPTERS_VERSION__}  hint="Integration adapters" npmName="@mushi-mushi/adapters" />
                <PackageRow name="create-mushi-mushi"   version={__CREATE_MUSHI_VERSION__}  hint="Project scaffold CLI" npmName="create-mushi-mushi" />
                <PackageRow name="mushi-mushi"          version={__LAUNCHER_VERSION__}  hint="Launcher / CLI entry"   npmName="mushi-mushi" />
              </PackageGroup>
              <PackageGroup id="Plugins">
                <PackageRow name="plugin-sdk"           version={__SDK_PLUGIN_SDK_VERSION__}      hint="Plugin SDK base"      npmName="@mushi-mushi/plugin-sdk" />
                <PackageRow name="plugin-jira"          version={__SDK_PLUGIN_JIRA_VERSION__}     hint="Jira routing plugin"  npmName="@mushi-mushi/plugin-jira" />
                <PackageRow name="plugin-linear"        version={__SDK_PLUGIN_LINEAR_VERSION__}   hint="Linear routing"       npmName="@mushi-mushi/plugin-linear" />
                <PackageRow name="plugin-pagerduty"     version={__SDK_PLUGIN_PAGERDUTY_VERSION__} hint="PagerDuty routing"   npmName="@mushi-mushi/plugin-pagerduty" />
                <PackageRow name="plugin-sentry"        version={__SDK_PLUGIN_SENTRY_VERSION__}   hint="Sentry enrichment"    npmName="@mushi-mushi/plugin-sentry" />
                <PackageRow name="plugin-slack-app"     version={__SDK_PLUGIN_SLACK_VERSION__}    hint="Slack app integration" npmName="@mushi-mushi/plugin-slack-app" />
                <PackageRow name="plugin-zapier"        version={__SDK_PLUGIN_ZAPIER_VERSION__}   hint="Zapier webhook bridge" npmName="@mushi-mushi/plugin-zapier" />
              </PackageGroup>
              <PackageGroup id="Runtime">
                <PackageRow name="wasm-classifier"      version={__SDK_WASM_VERSION__}  hint="WASM classifier module"  npmName="@mushi-mushi/wasm-classifier" />
                <PackageRow name="server"               version={__SERVER_VERSION__}    hint="Edge Functions (private)" githubPath="packages/server" />
              </PackageGroup>
            </div>
          </PopoverSection>

          {/* Latest changelog entry — keeps the user from having to open the
              modal for the most common case ("what shipped most recently?"). */}
          <PopoverSection>
            <SectionDivider
              label="Latest release"
              icon={IconReleases}
              theme={ACCENT_THEMES.brand}
              trailing={
                whatsNew.hasUnread ? (
                  <span className="inline-flex items-center rounded-full border border-brand/35 bg-brand/10 px-1.5 py-px text-2xs font-medium text-brand shrink-0">
                    Unread
                  </span>
                ) : undefined
              }
            />
            {latest ? (
              <div className={`mt-2 rounded-md border border-edge-subtle/80 border-l-[3px] ${ACCENT_THEMES.brand.rail} bg-surface/35 overflow-hidden`}>
                <div className="flex items-start justify-between gap-2 border-b border-edge-subtle/70 px-2.5 py-2">
                  <h3 className="text-xs font-semibold text-fg leading-snug min-w-0">{latest.title}</h3>
                  <VersionPill version={latest.date} />
                </div>
                {latest.summary && (
                  <p className="border-b border-edge-subtle/70 px-2.5 py-2 text-2xs text-fg-secondary leading-snug">
                    {latest.summary}
                  </p>
                )}
                {topHighlights.length > 0 && (
                  <ul>
                    {topHighlights.map((h, idx) => (
                      <ChangelogHighlightRow key={idx} tone={h.tone} text={h.text} />
                    ))}
                  </ul>
                )}
                <div className="border-t border-edge-subtle/70 bg-surface-overlay/30 px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={handleReadFull}
                    className="inline-flex w-full items-center justify-between gap-2 rounded-sm px-1 py-0.5 text-2xs font-medium text-brand hover:text-brand-hover hover:bg-surface-overlay/60 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  >
                    Read full changelog
                    <span aria-hidden>→</span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 rounded-md border border-edge-subtle/70 bg-surface/30 px-2.5 py-2 text-2xs text-fg-muted">
                No release notes yet.
              </p>
            )}
          </PopoverSection>

          {/* Pipelines — the "where do versions come from?" answer for any
              operator clicking the badge to investigate a deploy concern. */}
          <PopoverSection className="border-b-0">
            <SectionDivider label="Pipelines" icon={IconIterate} theme={ACCENT_THEMES.warn} />
            <ul className="mt-2 grid grid-cols-2 gap-px rounded-md border border-edge-subtle/80 bg-edge-subtle/60 overflow-hidden">
              {PIPELINE_LINKS.map((link) => {
                const theme = ACCENT_THEMES[link.tone]
                const LinkIcon = link.icon
                return (
                  <li key={link.href} className={`bg-surface-raised/80 border-l-[3px] ${theme.rail}`}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={link.hint}
                      className="group flex items-center justify-between gap-1.5 border-b border-edge-subtle/50 px-2 py-1.5 text-2xs text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 min-h-[2rem]"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <ThemeIconChip icon={LinkIcon} theme={theme} size={12} />
                        <span className="truncate">{link.label}</span>
                      </span>
                      <span aria-hidden className="text-fg-faint group-hover:text-fg-muted shrink-0">↗</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </PopoverSection>
        </div>
      )}
    </div>
  )
}

function PackageGroup({ id, children }: { id: PackageGroupId; children: ReactNode }) {
  const meta = PACKAGE_GROUP_META[id]
  const GroupIcon = meta.icon
  const rows = Children.map(children, (child) => {
    if (!isValidElement<{ pillTone?: VersionPillTone }>(child)) return child
    return cloneElement(child, { pillTone: meta.pill })
  })
  return (
    <div className={`rounded-md border border-edge-subtle/80 border-l-[3px] ${meta.rail} bg-surface/40 overflow-hidden`}>
      <div className={`flex items-center gap-1.5 border-b px-2 py-1 ${meta.header}`}>
        <ThemeIconChip icon={GroupIcon} theme={meta} size={12} />
        <p className={`text-2xs font-semibold uppercase tracking-wider ${meta.text}`}>{id}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-2 px-1 py-0.5">
        {rows}
      </div>
    </div>
  )
}

function PackageRow({
  name,
  version,
  hint,
  npmName,
  githubPath,
  pillTone = 'neutral',
}: {
  name: string
  version: string
  hint: string
  pillTone?: VersionPillTone
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
      className={`group col-span-1 flex items-center justify-between gap-2 border-b border-edge-subtle/50 px-1 -mx-1 py-1 min-h-[1.75rem] ${
        href ? 'hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50' : ''
      }`}
      title={hint}
    >
      <span className="font-mono text-2xs text-fg truncate flex items-center gap-0.5 min-w-0">
        {name}
        {href && (
          <span aria-hidden className="text-fg-faint group-hover:text-fg-muted shrink-0 leading-none">↗</span>
        )}
      </span>
      <VersionPill version={version} tone={pillTone} />
    </Tag>
  )
}
