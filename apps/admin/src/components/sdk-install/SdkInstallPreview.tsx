import { useMemo, useState, type CSSProperties } from 'react'
import { getWidgetPreviewTokens, getLocale } from '@mushi-mushi/web'
import { reporterCopy, type ReporterCategory } from '@mushi-mushi/core/reporter-ui'
import type { SdkPreviewConfig, WidgetPosition } from '../../lib/sdkSnippets'
import type { AssistantPreviewState } from './sdk-install-types'

/**
 * A mock browser viewport showing the widget as the host's users get it. We
 * deliberately do NOT mount the real `@mushi-mushi/web` SDK: it attaches a
 * shadow-root widget to `document.body`, which would fight any real widget in
 * the admin app and leak onto every other admin page.
 *
 * Mirrors the one-screen report (Plan 018 §1): the text box first, optional
 * type chips (Bug, Slow, Looks wrong, Confusing, Idea), one attachments row,
 * the privacy line and a pinned Send. Copy comes from the same tables the
 * widget uses (`getLocale` + core `reporterCopy`), and colours are the
 * widget's neutral defaults: system Canvas / CanvasText under the chosen
 * colour scheme, with hairlines mixed from the ink. If the widget changes,
 * change this in lockstep, or hosts will see a preview that lies.
 */

/** The widget's chips, in its order; Idea follows `featureRequestCard`, which the card doesn't edit. */
const CHIPS: readonly ReporterCategory[] = ['bug', 'slow', 'visual', 'confusing', 'idea']
const MIN_LENGTH = 8

const ink = 'CanvasText'
const paper = 'Canvas'
const muted = 'color-mix(in oklab, CanvasText 64%, transparent)'
const surface = 'color-mix(in oklab, Canvas 94%, CanvasText)'
const hairline = 'color-mix(in oklab, CanvasText 16%, transparent)'

export function SdkInstallPreview({
  config,
  assistant,
}: {
  config: SdkPreviewConfig
  assistant: AssistantPreviewState
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [chip, setChip] = useState<ReporterCategory | null>(null)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const t = useMemo(() => getLocale('en'), [])
  const rc = useMemo(() => reporterCopy('en'), [])
  const isDark =
    config.theme === 'dark' ||
    (config.theme === 'auto' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)

  // The banner's brand / neon variants keep the Mushi palette (single source:
  // @mushi-mushi/core via the web build-widget-theme helper).
  const tokens = getWidgetPreviewTokens(isDark ? 'dark' : 'light')
  const canSend = text.trim().length >= MIN_LENGTH
  const shotOn = config.capture.screenshot !== 'off'
  const autoShot = config.capture.screenshot === 'auto'
  const shotHint =
    config.screenshotSensitiveHint === false
      ? null
      : typeof config.screenshotSensitiveHint === 'string' && config.screenshotSensitiveHint.trim()
        ? config.screenshotSensitiveHint
        : t.step3.screenshotSensitiveHint

  const cornerPos: Record<WidgetPosition, CSSProperties> = {
    'top-left': { top: 30, left: 10 },
    'top-right': { top: 30, right: 10 },
    'bottom-left': { bottom: 10, left: 10 },
    'bottom-right': { bottom: 10, right: 10 },
  }

  const open = () => {
    setPanelOpen(true)
    setSent(false)
  }
  const close = () => {
    setPanelOpen(false)
    setSent(false)
    setText('')
    setChip(null)
  }
  const pill: CSSProperties = { border: `1px solid ${hairline}`, borderRadius: 999, background: 'none', color: ink, cursor: 'pointer' }

  return (
    <div
      className="relative h-80 w-full rounded-md border overflow-hidden"
      style={{ colorScheme: isDark ? 'dark' : 'light', background: surface, color: ink, borderColor: hairline }}
      aria-label="Live preview of the issue-report widget in your app"
      data-testid="sdk-install-preview"
    >
      {/* Faux browser chrome — kept minimal so the eye lands on the widget */}
      <div className="flex items-center gap-1 px-2 py-1 border-b" style={{ background: paper, borderColor: hairline }}>
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-preview-traffic-red)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-preview-traffic-yellow)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-preview-traffic-green)]" />
        <span className="ml-2 text-2xs" style={{ color: muted, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>
          your-app.com
        </span>
      </div>

      {/* Faux page content */}
      <div className="px-3 pt-3 space-y-1.5">
        <div className="h-2 w-2/3 rounded-sm" style={{ background: hairline }} />
        <div className="h-2 w-1/2 rounded-sm" style={{ background: hairline, opacity: 0.7 }} />
        <div className="h-2 w-3/4 rounded-sm" style={{ background: hairline, opacity: 0.7 }} />
      </div>

      {config.trigger === 'banner' ? (
        <div
          data-testid="preview-banner"
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
            // `subtle` (the default) is frosted paper + ink; `brand` / `neon` are opt-in.
            background: config.bannerVariant === 'neon' ? tokens.neonBannerBg : config.bannerVariant === 'subtle' ? paper : tokens.vermillion,
            color: config.bannerVariant === 'neon' ? tokens.neonBannerFg : config.bannerVariant === 'subtle' ? ink : tokens.onAccent,
            [config.bannerPosition === 'bottom' ? 'borderTop' : 'borderBottom']: `1px solid ${config.bannerVariant === 'neon' ? tokens.neonBannerBorder : config.bannerVariant === 'subtle' ? hairline : tokens.brandBannerBorder}`,
          }}
        >
          {config.bannerMessage.trim() ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>
              {(config.bannerLabel.trim() || 'Beta') && (
                <span style={{ flexShrink: 0, padding: '0 4px', borderRadius: 2, border: '1px solid currentColor', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  {config.bannerLabel.trim() || 'Beta'}
                </span>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>{config.bannerMessage.trim()}</span>
            </span>
          ) : null}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {/* The widget's banner "Report a bug" opens the report with Bug picked. */}
            <button
              type="button"
              style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', font: 'inherit' }}
              onClick={() => {
                open()
                setChip('bug')
              }}
            >
              {config.bannerBugCta.trim() || '🐛 Report a bug'}
            </button>
            {config.bannerFeatureCta && (
              <button
                type="button"
                style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', font: 'inherit', opacity: 0.8 }}
                onClick={() => {
                  open()
                  setChip('idea')
                }}
              >
                Feature
              </button>
            )}
          </span>
        </div>
      ) : config.trigger === 'manual' || config.trigger === 'hidden' || config.trigger === 'attach' ? (
        <div
          className="absolute rounded-sm border px-2 py-1 text-2xs"
          style={{ ...cornerPos[config.position], color: muted, borderColor: hairline, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}
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
            background: paper,
            color: ink,
            border: `1px solid ${hairline}`,
            borderRadius: config.trigger === 'edge-tab' ? '4px 0 0 4px' : 4,
            fontSize: config.trigger === 'edge-tab' ? 14 : 18,
            lineHeight: 1,
            writingMode: config.trigger === 'edge-tab' ? 'vertical-rl' : undefined,
            boxShadow: config.trigger === 'edge-tab' ? `inset -3px 0 0 ${ink}` : `inset 0 -3px 0 ${ink}`,
          }}
          aria-label="Mock bug-capture trigger button — click to preview panel"
          onClick={() => (panelOpen ? close() : open())}
        >
          {/* Trim BEFORE falling back, exactly like the snippet generator: a
              whitespace-only triggerText would otherwise render a blank button. */}
          <span aria-hidden="true">{config.triggerText.trim() ? config.triggerText : '\u{1F41B}'}</span>
        </button>
      )}

      {panelOpen && config.trigger !== 'manual' && config.trigger !== 'hidden' && config.trigger !== 'attach' && (
        <div
          className="absolute flex flex-col overflow-hidden"
          data-testid="preview-panel"
          style={{
            bottom: 8,
            right: 8,
            width: '72%',
            maxHeight: 'calc(100% - 32px)',
            background: paper,
            color: ink,
            border: `1px solid ${hairline}`,
            borderRadius: 12,
            boxShadow: '0 12px 40px rgb(0 0 0 / .18)',
            fontSize: 11,
            zIndex: 2,
          }}
          role="dialog"
          aria-label={t.panel.title}
        >
          <div className="flex items-center gap-2 border-b px-2 py-1" style={{ borderColor: hairline }}>
            <span className="flex-1 font-semibold" style={{ fontSize: 12 }}>
              {sent ? rc.ui.sent : t.panel.title}
            </span>
            <span className="px-2 py-0.5" style={{ ...pill, fontSize: 11 }}>
              {t.panel.yourReports}
            </span>
            {/* The overflow menu (Community ideas, plus Ask when the assistant is on). */}
            <span
              title={assistant.enabled ? `${assistant.label || t.assistant.defaultLabel} · ${t.step1.moreNav.communityIdeas}` : t.step1.moreNav.communityIdeas}
              aria-label={t.panel.moreOptions}
              style={{ color: muted }}
            >
              ⋯
            </span>
            <button type="button" aria-label={t.widget.close} style={{ background: 'none', border: 0, color: muted, cursor: 'pointer' }} onClick={close}>
              ✕
            </button>
          </div>

          {sent ? (
            <div className="flex flex-col items-center gap-1 px-2 py-3 text-center">
              <span aria-hidden="true" style={{ fontSize: 16 }}>受</span>
              <p style={{ margin: 0 }}>{t.flows.success.slaDefault}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 overflow-hidden px-2 py-1.5">
              <textarea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={chip === 'idea' ? t.step3.featurePlaceholder : t.step3.descriptionPlaceholder}
                aria-label={t.panel.title}
                style={{ resize: 'none', border: `1px solid ${hairline}`, borderRadius: 8, background: paper, color: ink, padding: 6, font: 'inherit' }}
              />
              <div role="radiogroup" aria-label={t.panel.title} className="flex flex-wrap gap-1">
                {CHIPS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={chip === id}
                    data-category={id}
                    className="px-2 py-0.5"
                    style={{ ...pill, fontSize: 11, ...(chip === id ? { background: ink, color: paper, borderColor: ink } : {}) }}
                    onClick={() => setChip(chip === id ? null : id)}
                  >
                    {rc.categories[id]}
                  </button>
                ))}
              </div>
              {(shotOn || config.capture.elementSelector) && (
                <div className="flex flex-wrap items-center gap-1" data-testid="preview-attachments">
                  {shotOn && (
                    <span className="px-2 py-0.5" style={{ border: `1px solid ${hairline}`, borderRadius: 6, background: surface, fontSize: 11 }}>
                      📷 {autoShot ? t.step3.screenshotAttached : t.step3.screenshotButton}
                    </span>
                  )}
                  {config.capture.elementSelector && (
                    <span className="px-2 py-0.5" style={{ border: `1px solid ${hairline}`, borderRadius: 6, background: surface, fontSize: 11 }}>
                      ⌖ {t.panel.pointAt}
                    </span>
                  )}
                </div>
              )}
              {autoShot && shotHint && (
                <p style={{ margin: 0, color: muted, fontSize: 11 }} data-testid="preview-shot-hint">
                  {shotHint}
                </p>
              )}
              <p style={{ margin: 0, color: muted, fontSize: 11 }}>🔒 {t.panel.privacy}</p>
            </div>
          )}

          {/* Pinned footer: the one accent action per view. */}
          <div className="mt-auto flex items-center justify-between gap-2 border-t px-2 py-1" style={{ borderColor: hairline }}>
            <span style={{ color: muted, fontSize: 11 }}>{sent ? '' : canSend ? t.step3.submitHint.replace('{key}', 'Ctrl') : rc.ui.addWords}</span>
            <button
              type="button"
              aria-disabled={!sent && !canSend}
              title={!sent && !canSend ? rc.ui.addWords : undefined}
              style={{ border: 0, borderRadius: 8, background: ink, color: paper, padding: '3px 12px', fontWeight: 600, cursor: 'pointer', opacity: !sent && !canSend ? 0.45 : 1 }}
              onClick={() => (sent ? close() : canSend && setSent(true))}
            >
              {sent ? t.flows.success.done : t.panel.send}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
