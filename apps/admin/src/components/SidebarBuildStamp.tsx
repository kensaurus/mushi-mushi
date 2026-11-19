/**
 * FILE: apps/admin/src/components/SidebarBuildStamp.tsx
 * PURPOSE: One dense line in the sidebar footer: which Mushi Mushi this is,
 *          when the console was built (to the minute, viewer's zone) and
 *          whether it runs on Mushi Cloud or a self-hosted backend
 *          (owner, 2026-11-19).
 *
 *          ■ Hosted   v0.1.687 · 11-19 14:32
 *
 *          The mode is what the server's GET /health says (lib/buildInfo.ts);
 *          until it answers, the console's build-time guess is shown dimmed.
 *          Hover: console build (commit, full stamp) and server deploy
 *          (commit, deploy time). The rail variant is the mark alone.
 */

import { Tooltip } from './ui'
import { NavRailFlyout } from './sidebar/NavRailFlyout'
import { buildTimeMode, consoleBuild, formatStamp, modeLabel, useServerInstance, type DeploymentMode } from '../lib/buildInfo'

const MODE_MARK: Record<DeploymentMode, { glyph: string; ink: string }> = {
  // Shape + colour, never colour alone (console status language, 2026-11-18).
  hosted: { glyph: '■', ink: 'text-info' },
  'self-hosted': { glyph: '◆', ink: 'text-accent' },
}

export function SidebarBuildStamp({ compact = false }: { compact?: boolean }) {
  const build = consoleBuild()
  const server = useServerInstance()
  const mode = server?.mode ?? buildTimeMode()
  const confirmed = server != null
  const mark = MODE_MARK[mode]
  const builtFull = formatStamp(build.builtAt)
  // "11-19 14:32": the year and zone live in the tooltip; the line stays short.
  const builtShort = builtFull ? builtFull.slice(5, 16) : null
  const serverDeployed = formatStamp(server?.deployedAt)
  const serverVersion = server?.version && server.version !== 'dev' ? server.version.slice(0, 7) : server?.version ?? null

  const detail = (
    <div className="space-y-1 text-2xs leading-snug">
      <p>
        <span className="font-semibold">{modeLabel(mode)}</span>
        {mode === 'hosted' ? ' — Mushi Cloud runs the server.' : ' — your own Supabase backend runs the server.'}
        {confirmed ? '' : ' (guessed from this build; the server has not answered yet)'}
      </p>
      <p className="font-mono tabular-nums">
        Console v{build.version} · {build.sha}
        {builtFull ? ` · built ${builtFull}` : ''}
      </p>
      {server ? (
        <p className="font-mono tabular-nums">
          Server {serverVersion ?? 'unknown'}
          {serverDeployed ? ` · deployed ${serverDeployed}` : serverVersion === 'dev' ? ' · deploy not stamped' : ''}
        </p>
      ) : null}
      {confirmed && mode === 'self-hosted' ? <p>Setup checklist: Settings → SDK &amp; connection.</p> : null}
    </div>
  )

  if (compact) {
    const railText = [
      `${modeLabel(mode)}${confirmed ? '' : ' (guessed)'}.`,
      `Console ${build.sha}${builtFull ? `, built ${builtFull}` : ''}.`,
      server ? `Server ${serverVersion ?? 'unknown'}${serverDeployed ? `, deployed ${serverDeployed}` : ''}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <Tooltip
        side="right"
        portal
        content={<NavRailFlyout title={`Mushi Mushi v${build.version}`} description={railText} />}
      >
        <span className="nav-rail-item" role="img" aria-label={`${modeLabel(mode)}, console v${build.version}${builtFull ? `, built ${builtFull}` : ''}`}>
          <span aria-hidden className={`text-xs leading-none ${mark.ink}`}>{mark.glyph}</span>
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip content={detail} side="right" portal>
      <div
        className="flex min-w-0 items-center gap-1.5 px-2 text-2xs leading-none text-fg-muted"
        data-testid="sidebar-build-stamp"
        aria-label={`${modeLabel(mode)}. Mushi Mushi console v${build.version}${builtFull ? `, built ${builtFull}` : ''}`}
      >
        <span aria-hidden className={`${mark.ink} ${confirmed ? '' : 'opacity-60'}`}>{mark.glyph}</span>
        <span className={`font-semibold uppercase tracking-wider ${confirmed ? 'text-fg-secondary' : 'text-fg-muted'}`}>
          {modeLabel(mode)}
        </span>
        <span aria-hidden className="text-fg-faint">·</span>
        <span className="truncate font-mono tabular-nums text-fg-secondary">v{build.version}</span>
        {builtShort ? (
          <>
            <span aria-hidden className="text-fg-faint">·</span>
            <span className="shrink-0 font-mono tabular-nums">{builtShort}</span>
          </>
        ) : null}
      </div>
    </Tooltip>
  )
}
