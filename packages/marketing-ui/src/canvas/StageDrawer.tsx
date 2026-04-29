'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { useMarketing } from '../context'
import type { MushiStage, ReportSample } from './data'
import { StageScreenshot } from './StageScreenshot'

interface StageDrawerProps {
  stage: MushiStage | null
  sample: ReportSample
  onClose: () => void
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function StageDrawer({ stage, sample, onClose }: StageDrawerProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const { urls } = useMarketing()

  useEffect(() => {
    if (!stage) return
    closeRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return

      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute('disabled'))

      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, stage])

  return (
    <AnimatePresence>
      {stage && (
        <motion.aside
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`mushi-stage-drawer-${stage.id}`}
          className="absolute inset-x-4 bottom-4 z-20 max-h-[calc(100%-2rem)] overflow-y-auto rounded-[1.5rem] border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-4 shadow-[0_32px_100px_-56px_rgba(14,13,11,0.55)] backdrop-blur md:left-auto md:right-6 md:w-[min(720px,calc(100%-3rem))] lg:p-5"
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              {/* Eyebrow neutralised. The "01" badge is the single brand
                  micro-mark for the drawer (it identifies the stage); the
                  kicker text now reads as caption ink, not a second red
                  surface stacked next to the badge. */}
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
                <span className="grid h-5 w-5 place-items-center rounded-sm bg-[var(--mushi-vermillion)] font-mono text-[9px] font-semibold text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]">
                  {String(stage.index + 1).padStart(2, '0')}
                </span>
                {stage.kicker}
              </p>
              <h2
                id={`mushi-stage-drawer-${stage.id}`}
                className="mt-2 font-serif text-[1.85rem] leading-[1.05] tracking-[-0.035em] text-[var(--mushi-ink)] sm:text-[2rem]"
              >
                {stage.drawerTitle}
              </h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-sm border border-[var(--mushi-rule)] bg-white/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)] transition hover:border-[var(--mushi-ink)] hover:bg-white/70 hover:text-[var(--mushi-ink)]"
            >
              Close <span aria-hidden="true" className="ml-0.5 opacity-60">✕</span>
            </button>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_80%,white)] px-3 py-2.5">
            <DrawerPill label="Severity" value={sample.severity} tone="alert" />
            <DrawerPill label="Class" value={sample.taxonomy} tone="ink" />
            <DrawerPill label="Judge" value={sample.judgeScore} tone="pass" />
            <span className="ml-auto inline-flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--mushi-ink-muted)]">
              <span aria-hidden="true" className="opacity-50">↗</span>
              {sample.path}
            </span>
          </div>

          <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="flex flex-col justify-between gap-4">
              <div>
                <p className="text-[14px] leading-[1.6] text-[var(--mushi-ink)]">
                  {stage.drawerBody}
                </p>
                <ul className="mt-4 space-y-2">
                  {stage.bullets.map((bullet, i) => (
                    <li
                      key={bullet}
                      className="flex items-start gap-3 rounded-lg border border-[var(--mushi-rule)] bg-white/45 p-3 text-[13px] leading-[1.55] text-[var(--mushi-ink)]"
                    >
                      {/* Bullet markers were brand-tinted chips (border + bg
                          + text all vermillion). Three bullets × 5 stages = 15
                          extra vermillion micro-rectangles in the drawer
                          alone. Demoted to ink-on-paper-wash chips so the body
                          copy and the docs CTA below get the focal weight. */}
                      <span
                        aria-hidden="true"
                        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_80%,white)] font-mono text-[9px] font-semibold text-[var(--mushi-ink)]"
                      >
                        {i + 1}
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* `stage.href` is a docs-relative path (e.g. `/quickstart`,
                  `/concepts/judge-loop`) resolved through the host's docs
                  helper — every value maps to a real .mdx file in
                  apps/docs/content. Opens in a new tab so the canvas state
                  (selected stage, focus index) survives the click. */}
              <a
                href={urls.docs(stage.href)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-2 rounded-sm bg-[var(--mushi-ink)] px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--mushi-paper)] transition hover:-translate-y-0.5 hover:bg-[color-mix(in_oklch,var(--mushi-ink)_88%,var(--mushi-vermillion))]"
              >
                Learn the details
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
              </a>
            </div>
            <StageScreenshot stageId={stage.id} sample={sample} />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

type DrawerPillTone = 'alert' | 'ink' | 'pass'

const DRAWER_PILL_TONES: Record<DrawerPillTone, { bg: string; fg: string; border: string; dot: string }> = {
  alert: { bg: 'var(--mushi-vermillion)', fg: '#ffffff', border: 'var(--mushi-vermillion)', dot: '#ffffff' },
  ink: { bg: 'var(--mushi-ink)', fg: 'var(--mushi-paper)', border: 'var(--mushi-ink)', dot: 'var(--mushi-vermillion)' },
  pass: { bg: '#10b981', fg: '#ffffff', border: '#059669', dot: '#ffffff' },
}

function DrawerPill({ label, value, tone }: { label: string; value: string; tone: DrawerPillTone }) {
  const colors = DRAWER_PILL_TONES[tone]
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-md border border-[var(--mushi-rule)] bg-white/65">
      <span className="inline-flex items-center px-2 py-1 font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
        {label}
      </span>
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]"
        style={{ background: colors.bg, color: colors.fg, borderLeft: `1px solid ${colors.border}` }}
      >
        {tone === 'alert' && (
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: colors.dot }} />
        )}
        {tone === 'pass' && (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: colors.dot }} />
        )}
        {tone === 'ink' && (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: colors.dot }} />
        )}
        {value}
      </span>
    </span>
  )
}
