import { useMemo, useState } from 'react'
import { getWidgetPreviewTokens, getLocale } from '@mushi-mushi/web'
import type { SdkPreviewConfig, WidgetPosition } from '../../lib/sdkSnippets'
import type { AssistantPreviewState } from './sdk-install-types'

/**
 * A mock browser viewport that renders the bug-capture trigger button at
 * the chosen corner with the chosen theme and trigger text. We deliberately
 * do NOT instantiate the real `@mushi-mushi/web` SDK because it mounts a
 * shadow-root widget on `document.body` (would fight any real widget the
 * admin app already has, and pollute every other admin page once mounted).
 *
 * Visual styling mirrors `packages/web/src/styles.ts` — the "Mushi Mushi
 * Editorial" design language: paper background, sumi ink type, vermillion
 * stamp accent, rounded-square trigger card with a vermillion bottom edge
 * and a pulsing 朱 dot. Updating those tokens here in lockstep with the
 * widget keeps the preview honest; if the visual drifts, users will report
 * "the actual widget doesn't look like the preview".
 */
export function SdkInstallPreview({
  config,
  assistant,
}: {
  config: SdkPreviewConfig
  assistant: AssistantPreviewState
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [moreNavOpen, setMoreNavOpen] = useState(false)
  const t = useMemo(() => getLocale('en'), [])
  const moreNavCount = 2 + (assistant.enabled ? 1 : 0)
  const moreNavToggle = `${t.step1.moreNavLabel} (${moreNavCount})`
  // mushi-mushi-allowlist: mirrors packages/web widget tokens — hex must match shipped SDK preview
  const isDark =
    config.theme === 'dark' ||
    (config.theme === 'auto' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  // Single source: @mushi-mushi/core palette via web build-widget-theme helper.
  const tokens = getWidgetPreviewTokens(isDark ? 'dark' : 'light')

  const cornerPos: Record<WidgetPosition, React.CSSProperties> = {
    'top-left': { top: 10, left: 10 },
    'top-right': { top: 10, right: 10 },
    'bottom-left': { bottom: 10, left: 10 },
    'bottom-right': { bottom: 10, right: 10 },
  }

  return (
    <div
      className="relative h-44 w-full rounded-md border overflow-hidden"
      style={{
        background: tokens.paper,
        borderColor: tokens.rule,
        // Subtle paper-grain via two stacked radial gradients — costs nothing
        // and breaks the digital-flat look the previous gradient bg had.
        backgroundImage: isDark
          ? 'radial-gradient(circle at 20% 10%, rgba(255,255,255,0.02) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.015) 0%, transparent 40%)'
          : 'radial-gradient(circle at 20% 10%, rgba(0,0,0,0.015) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(0,0,0,0.02) 0%, transparent 40%)',
      }}
      aria-label="Live preview of the issue-report widget in your app"
    >
      {/* Faux browser chrome — kept minimal so the eye lands on the widget */}
      {/* mushi-mushi-allowlist: macOS traffic-light mock chrome in SDK widget preview */}
      <div
        className="flex items-center gap-1 px-2 py-1 border-b"
        style={{
          background: isDark ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.55)',
          borderColor: tokens.rule,
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-preview-traffic-red)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-preview-traffic-yellow)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-preview-traffic-green)]" />
        <span
          className="ml-2 text-2xs"
          style={{ color: tokens.inkMuted, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}
        >
          your-app.com
        </span>
      </div>

      {/* Faux page content — type sample lines, slight variation in width */}
      <div className="px-3 pt-3 space-y-1.5">
        <div className="h-2 w-2/3 rounded-sm" style={{ background: tokens.rule }} />
        <div className="h-2 w-1/2 rounded-sm" style={{ background: tokens.rule, opacity: 0.7 }} />
        <div className="h-2 w-3/4 rounded-sm" style={{ background: tokens.rule, opacity: 0.7 }} />
      </div>

      {config.trigger === 'banner' ? (
        /* Banner strip preview — mushi-mushi-allowlist: yen-yen widget banner variant colours in live preview */
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            ...(config.bannerPosition === 'bottom' ? { bottom: 0 } : { top: 22 }),
            minHeight: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: config.bannerMessage.trim() ? 'space-between' : 'center',
            gap: 6,
            paddingLeft: 8,
            paddingRight: 8,
            fontSize: 11,
            fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
            background: config.bannerVariant === 'neon'
              ? tokens.neonBannerBg
              : config.bannerVariant === 'subtle'
                ? tokens.accentWash
                : tokens.vermillion,
            color: config.bannerVariant === 'neon' ? tokens.neonBannerFg : config.bannerVariant === 'subtle' ? tokens.inkMuted : tokens.onAccent,
            borderBottom: config.bannerPosition !== 'bottom' ? `1px solid ${config.bannerVariant === 'neon' ? tokens.neonBannerBorder : config.bannerVariant === 'subtle' ? tokens.rule : tokens.brandBannerBorder}` : 'none',
            borderTop: config.bannerPosition === 'bottom' ? `1px solid ${config.bannerVariant === 'neon' ? tokens.neonBannerBorder : config.bannerVariant === 'subtle' ? tokens.rule : tokens.brandBannerBorder}` : 'none',
          }}
        >
          {config.bannerMessage.trim() ? (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>
                {(config.bannerLabel.trim() || 'Beta') && (
                  <span style={{ flexShrink: 0, padding: '0 4px', borderRadius: 2, border: '1px solid currentColor', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    {config.bannerLabel.trim() || 'Beta'}
                  </span>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>
                  {config.bannerMessage.trim()}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, fontSize: 11 }}>
                <span
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer', opacity: 0.9 }}
                  onClick={(e) => {
                    e.preventDefault()
                    setPanelOpen(true)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setPanelOpen(true)
                    }
                  }}
                >
                  {config.bannerBugCta.trim() || '🐛 Report a bug'}
                </span>
                {config.bannerFeatureCta && (
                  <>
                    <span style={{ opacity: 0.25 }}>|</span>
                    <span style={{ cursor: 'pointer', opacity: 0.75 }}>Feature</span>
                  </>
                )}
                <span style={{ opacity: 0.55, marginLeft: 2, cursor: 'pointer' }}>✕</span>
              </span>
            </>
          ) : (
            <>
              <span
                role="button"
                tabIndex={0}
                style={{ padding: '1px 6px', borderRadius: 2, background: 'rgba(0,0,0,0.14)', cursor: 'pointer' }}
                onClick={(e) => {
                  e.preventDefault()
                  setPanelOpen(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setPanelOpen(true)
                  }
                }}
              >
                {config.bannerBugCta.trim() || '🐛 Report a bug'}
              </span>
              {config.bannerFeatureCta && (
                <span style={{ padding: '1px 6px', borderRadius: 2, background: 'rgba(0,0,0,0.10)', cursor: 'pointer' }}>
                  Feature
                </span>
              )}
              <span style={{ opacity: 0.55, marginLeft: 'auto', cursor: 'pointer' }}>✕</span>
            </>
          )}
        </div>
      ) : (config.trigger === 'manual' || config.trigger === 'hidden' || config.trigger === 'attach') ? (
        <div
          className="absolute rounded-sm border px-2 py-1 text-2xs"
          style={{
            ...cornerPos[config.position],
            color: tokens.inkMuted,
            borderColor: tokens.rule,
            fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          }}
        >
          {config.trigger === 'attach' ? 'HOST BUTTON' : 'NO DEFAULT UI'}
        </div>
      ) : (
        <button
          type="button"
          className="absolute flex items-center justify-center transition-transform hover:-translate-y-0.5"
          style={{
            ...cornerPos[config.position],
            height: config.trigger === 'edge-tab' ? 70 : 44,
            width: config.trigger === 'edge-tab' ? 24 : 44,
            background: tokens.paper,
            color: tokens.ink,
            border: `1px solid ${tokens.rule}`,
            borderRadius: config.trigger === 'edge-tab' ? '4px 0 0 4px' : 4,
            fontSize: config.trigger === 'edge-tab' ? 14 : 18,
            lineHeight: 1,
            writingMode: config.trigger === 'edge-tab' ? 'vertical-rl' : undefined,
            fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
            // Two-layer shadow + inset vermillion bar = the "stamp face" look
            boxShadow: config.trigger === 'edge-tab'
              ? `0 1px 0 ${tokens.rule}, 0 6px 12px -6px rgba(14,13,11,0.30), inset -3px 0 0 ${tokens.vermillion}`
              : `0 1px 0 ${tokens.rule}, 0 6px 12px -6px rgba(14,13,11,0.30), inset 0 -3px 0 ${tokens.vermillion}`,
          }}
          aria-label="Mock bug-capture trigger button — click to preview panel"
          onClick={(e) => {
            e.preventDefault()
            setPanelOpen((open) => !open)
          }}
        >
        {/* Trim BEFORE falling back, not after. Bare `||` would treat `"   "`
            as truthy and render three invisible spaces — a blank trigger button
            visually identical to the regression we just patched in widget.ts.
            The snippet generator (sdkSnippets.ts widgetLines) already trims
            before deciding whether to emit `triggerText`; this keeps the
            preview's "is this empty?" semantics IDENTICAL to the snippet's.

            Render the *original* (untrimmed) string when non-empty after trim
            — the snippet emits `JSON.stringify(cfg.triggerText)` which
            preserves leading/trailing whitespace verbatim, so a deliberate
            ` Report ` should look the same in the preview. */}
        <span aria-hidden="true">{config.triggerText.trim() ? config.triggerText : '\u{1F41B}'}</span>
        {/* Pulsing 朱 indicator dot */}
        <span
          aria-hidden="true"
          className="absolute"
          style={{
            top: 5,
            right: 5,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: tokens.vermillion,
            boxShadow: `0 0 0 0 ${tokens.vermillion}`,
            // Inline animation name — defined in the global stylesheet via
            // a CSS string would be cleaner, but Tailwind's animate-pulse
            // is close enough and avoids a second style injection.
            animation: 'pulse 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
          }}
        />
        </button>
      )}

      {panelOpen && config.trigger !== 'manual' && config.trigger !== 'hidden' && config.trigger !== 'attach' && (
        <div
          className="absolute rounded-sm border shadow-lg overflow-hidden"
          style={{
            bottom: 8,
            right: 8,
            width: '62%',
            maxHeight: '72%',
            background: tokens.paperRaised,
            borderColor: tokens.rule,
            color: tokens.ink,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontSize: 11,
            zIndex: 2,
          }}
          role="presentation"
        >
          <div
            className="px-2 py-1 border-b text-2xs font-medium flex items-center justify-between gap-1"
            style={{ borderColor: tokens.rule, color: tokens.inkMuted }}
          >
            <span>{t.step1.heading}</span>
            <button
              type="button"
              className="text-2xs"
              style={{ color: tokens.inkMuted, cursor: 'pointer' }}
              aria-label={t.widget.close}
              onClick={() => setPanelOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="p-2 space-y-1">
            <p
              className="text-2xs font-medium"
              style={{
                color: tokens.inkMuted,
                fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                margin: 0,
              }}
            >
              {t.step1.reportSectionLabel}
            </p>
            <div
              className="rounded-sm px-2 py-1 border"
              style={{ borderColor: tokens.rule, background: tokens.paper }}
            >
              <span style={{ color: tokens.vermillion }} aria-hidden="true">🐛</span>{' '}
              {t.step1.categoryDescriptions.bug}
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1 border text-left flex items-center justify-between gap-1"
                style={{ borderColor: tokens.rule, background: tokens.paper, color: tokens.inkMuted, cursor: 'pointer' }}
                aria-expanded={moreNavOpen}
                onClick={() => setMoreNavOpen((open) => !open)}
              >
                <span>{moreNavToggle}</span>
                <span aria-hidden="true">{moreNavOpen ? '▾' : '▸'}</span>
              </button>
              {moreNavOpen && (
                <div className="space-y-0.5 pl-1">
                  <div
                    className="rounded-sm px-2 py-0.5 border text-2xs"
                    style={{ borderColor: tokens.rule, background: tokens.paper, color: tokens.inkMuted }}
                  >
                    📬 {t.step1.moreNav.yourReports}
                  </div>
                  {assistant.enabled && (
                    <div
                      className="rounded-sm px-2 py-0.5 border text-2xs"
                      style={{ borderColor: tokens.rule, background: tokens.paper, color: tokens.inkMuted }}
                    >
                      💬 {assistant.label || t.assistant.defaultLabel}
                    </div>
                  )}
                  <div
                    className="rounded-sm px-2 py-0.5 text-2xs"
                    style={{ color: tokens.inkMuted }}
                  >
                    🌐 {t.step1.moreNav.joinCommunity.split(' · ')[0]}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
