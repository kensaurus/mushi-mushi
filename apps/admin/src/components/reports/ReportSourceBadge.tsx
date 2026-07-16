/**
 * FILE: apps/admin/src/components/reports/ReportSourceBadge.tsx
 * PURPOSE: Single inline "where did this come from?" attribution chip.
 *          Compresses three answers — SDK family, reporter identity,
 *          and capture mode (user-felt vs auto-captured) — into one
 *          glanceable cluster so triagers don't have to drill into
 *          the report to answer the first three questions every PM
 *          asks ("who, where, how?").
 *
 *          Pure presentation; the row provides the data via the
 *          new `sdk_package`, `reporter_user_id`, `reporter_token_hash`,
 *          `proactive_trigger`, and `environment` fields surfaced by
 *          the 2026-05-26 source-attribution boost on
 *          /v1/admin/reports.
 */

import { Tooltip } from '../ui'
import { ReportCodeText } from './ReportCodeText'
import type { ReportRow } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

interface Props {
  row: ReportRow
}

/** Compact glyph that says "this came from the web SDK" vs node vs react.
 *  We lean on emoji-as-icon here because the row is dense and a real icon
 *  font would push the cell wider. The glyph is decorative — the label
 *  next to it conveys the same info to screen readers. */
function sdkGlyph(pkg: string | null | undefined): string {
  if (!pkg) return '\u25CB' // bare ring → "unknown SDK"
  if (pkg.includes('node')) return '\u26A1' // ⚡ server-side
  if (pkg.includes('react-native')) return '\uD83D\uDCF1' // 📱 mobile
  if (pkg.includes('react')) return '\u269B\uFE0F' // ⚛ react component tree
  if (pkg.includes('web')) return '\uD83C\uDF10' // 🌐 browser
  if (pkg.includes('cli')) return '\u25B8' // ▸ dev tool
  return '\u25CB'
}

/** Short label for the SDK family — "web", "node", "react" … strips
 *  the `@mushi-mushi/` prefix so the cell stays narrow. */
function sdkShortName(pkg: string | null | undefined): string {
  if (!pkg) return 'unknown'
  const trimmed = pkg.replace(/^@mushi-mushi\//, '')
  return trimmed || 'unknown'
}

/** Human-readable capture mode. `proactive_trigger` is set by the SDK
 *  when the report was prompted automatically (window.onerror,
 *  unhandledrejection, captureException), and NULL when the user
 *  opened the widget on their own. We always tell the triager which
 *  it was — auto-captures need different scrutiny ("did this actually
 *  block the user?") than user-felt reports. */
function captureLabel(trigger: string | null | undefined): { label: string; tone: string; tooltip: string } {
  if (!trigger) {
    return {
      label: 'user',
      tone: 'bg-brand/12 text-brand border border-brand/28',
      tooltip:
        'A real person opened the widget and described what they felt. These are the highest-signal reports — somebody actually noticed the bug.',
    }
  }
  if (trigger === 'window-error' || trigger === 'unhandled-rejection') {
    return {
      label: 'auto',
      tone: CHIP_TONE.infoSubtle,
      tooltip: `Captured automatically when ${trigger === 'window-error' ? 'a JS error was thrown' : 'a promise rejection went unhandled'}. Check whether it actually broke a user flow — these can be benign third-party noise.`,
    }
  }
  if (trigger === 'captureException' || trigger === 'captureMessage' || trigger.startsWith('node-')) {
    return {
      label: 'server',
      tone: CHIP_TONE.warnSubtle,
      tooltip:
        'Forwarded from a backend service via @mushi-mushi/node (Express/Hono/Fastify middleware or direct captureException call). The user may never have seen this surface.',
    }
  }
  if (trigger === 'shake') {
    return {
      label: 'shake',
      tone: 'bg-accent-muted/60 text-accent-foreground border-accent/35',
      tooltip:
        'User shook their device to file a report — strong "I really feel something is off" signal from mobile testers.',
    }
  }
  return {
    label: trigger.slice(0, 14),
    tone: 'bg-surface-overlay text-fg-muted border-edge-subtle',
    tooltip: `Custom proactive trigger: "${trigger}". Set by the host app via the SDK.`,
  }
}

/** Stable 6-char monogram for the anonymous "device" when the reporter
 *  didn't identify themselves. Two reports from the same device share
 *  the same monogram so the triager can spot "this same anonymous
 *  user filed 4 of these today" without an account lookup. */
function reporterMonogram(row: ReportRow): { label: string; tooltip: string } {
  if (row.reporter_user_id) {
    const id = row.reporter_user_id
    const short = id.length > 20 ? `${id.slice(0, 8)}\u2026${id.slice(-6)}` : id
    return {
      label: short,
      tooltip: `Logged-in user identified via Mushi.identify(). Full id: ${id}`,
    }
  }
  if (row.reporter_token_hash) {
    const hex = row.reporter_token_hash.slice(0, 6)
    return {
      label: `anon\u00B7${hex}`,
      tooltip: `Anonymous reporter — stable device fingerprint hash starts with ${hex}. Two reports with the same monogram are the same device.`,
    }
  }
  return { label: 'anon', tooltip: 'Anonymous reporter, no device fingerprint available.' }
}

/** Pulls a humane "where" string out of the report environment. Prefers
 *  the SDK-supplied `route` (cleaner — usually the React Router pattern
 *  rather than the live URL with ids in it), falls back to the URL
 *  pathname, then to the bare origin. */
function locationLabel(env: ReportRow['environment']): string | null {
  if (!env) return null
  if (env.route) return env.route
  if (env.url) {
    try {
      const u = new URL(env.url)
      return u.pathname || u.hostname
    } catch {
      return env.url.slice(0, 60)
    }
  }
  return null
}

export function ReportSourceBadge({ row }: Props) {
  const pkg = row.sdk_package
  const glyph = sdkGlyph(pkg)
  const sdkName = sdkShortName(pkg)
  const capture = captureLabel(row.proactive_trigger)
  const reporter = reporterMonogram(row)
  const where = locationLabel(row.environment)

  const sdkTooltip = pkg
    ? `Source: ${pkg}${row.sdk_version ? `@${row.sdk_version}` : ''}${row.app_version ? ` · app v${row.app_version}` : ''}`
    : 'Source SDK was not reported. Likely a pre-2026 SDK or a custom direct ingest.'

  return (
    <div
      className="mt-1 flex items-center gap-1 flex-wrap"
      aria-label="Report source attribution"
    >
      <Tooltip content={sdkTooltip}>
        <span className="inline-flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-surface-overlay border border-edge-subtle text-fg-secondary cursor-help">
          <span aria-hidden="true">{glyph}</span>
          <span>{sdkName}</span>
        </span>
      </Tooltip>
      <Tooltip content={capture.tooltip}>
        <span className={`inline-flex items-center text-2xs font-mono px-1.5 py-0.5 rounded-sm cursor-help border ${capture.tone}`}>
          {capture.label}
        </span>
      </Tooltip>
      <Tooltip content={reporter.tooltip}>
        <span className="inline-flex items-center text-2xs font-mono px-1.5 py-0.5 rounded-sm bg-surface-overlay border border-edge-subtle text-fg-muted cursor-help max-w-48 truncate">
          {reporter.label}
        </span>
      </Tooltip>
      {where && (
        <Tooltip content={row.environment?.url ?? where}>
          <span className="cursor-help">
            <ReportCodeText title={row.environment?.url ?? where} className="max-w-72">
              {where}
            </ReportCodeText>
          </span>
        </Tooltip>
      )}
    </div>
  )
}
