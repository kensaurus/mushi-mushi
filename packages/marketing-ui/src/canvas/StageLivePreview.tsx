'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMarketing } from '../context'
import type { MushiStage } from './data'
import { stageMedia, loopOverviewMedia } from './stageMedia'

interface StageLivePreviewProps {
  stage: MushiStage
  /** compact = drawer column; panel = always-visible side rail */
  layout?: 'compact' | 'panel'
  className?: string
  /** Bumps animated GIF remounts when the canvas auto-cycle revisits a stage. */
  remountKey?: string | number
}

export function StageLivePreview({
  stage,
  layout = 'panel',
  className = '',
  remountKey,
}: StageLivePreviewProps) {
  const { urls } = useMarketing()
  const reducedMotion = useReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const media = stageMedia[stage.id]
  const src = urls.screenshots(media.file)
  const demoHref = resolveDemoHref(media.demoHref, urls.signup)
  const closeLightbox = useCallback(() => setExpanded(false), [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLightbox()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [closeLightbox, expanded])

  return (
    <div
      className={[
        'mushi-stage-preview',
        layout === 'compact' ? 'mushi-stage-preview--compact' : 'mushi-stage-preview--panel',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-live="polite"
      aria-label={`Live demo for stage ${stage.index + 1}: ${stage.title}`}
    >
      <div className="mushi-stage-preview__header">
        <p className="mushi-stage-preview__eyebrow">
          <span className="mushi-stage-preview__stage-badge">
            {String(stage.index + 1).padStart(2, '0')}
          </span>
          {media.previewEyebrow}
        </p>
        <h3 className="mushi-stage-preview__title">{media.previewTitle}</h3>
      </div>

      <div className="mushi-stage-preview__frame">
        <div className="mushi-stage-preview__chrome" aria-hidden="true">
          <span className="mushi-stage-preview__dot" />
          <span className="mushi-stage-preview__dot" />
          <span className="mushi-stage-preview__dot" />
          <span className="mushi-stage-preview__chrome-label">{media.chromeLabel}</span>
        </div>

        <div className="mushi-stage-preview__viewport">
          <button
            type="button"
            className="mushi-stage-preview__expand-trigger"
            onClick={() => setExpanded(true)}
            aria-label={`Expand demo: ${media.lightboxTitle}`}
            title="Expand demo"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={stage.id}
                className="mushi-stage-preview__media-wrap"
                initial={reducedMotion ? false : { opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0, scale: 0.99 }}
                transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <img
                  key={media.animated ? `${stage.id}-${remountKey ?? 'static'}` : stage.id}
                  src={src}
                  alt={media.alt}
                  loading="lazy"
                  decoding="async"
                  className={[
                    'mushi-stage-preview__img',
                    media.animated ? 'mushi-stage-preview__img--animated' : 'mushi-stage-preview__img--still',
                    media.surface === 'sdk' ? 'mushi-stage-preview__img--sdk' : '',
                  ].join(' ')}
                />
              </motion.div>
            </AnimatePresence>
            <span className="mushi-stage-preview__expand-hint" aria-hidden="true">
              Expand demo
            </span>
          </button>
        </div>
      </div>

      <p className="mushi-stage-preview__caption">{media.caption}</p>

      {demoHref ? (
        <a
          href={demoHref}
          target={demoHref.startsWith('http') ? '_blank' : undefined}
          rel={demoHref.startsWith('http') ? 'noreferrer' : undefined}
          className="mushi-stage-preview__link"
        >
          {media.linkLabel}
          <span aria-hidden="true">→</span>
        </a>
      ) : null}

      {expanded && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="mushi-stage-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={media.lightboxTitle}
              onClick={closeLightbox}
            >
              <div className="mushi-stage-lightbox__panel" onClick={(e) => e.stopPropagation()}>
                <div className="mushi-stage-lightbox__toolbar">
                  <div>
                    <p className="mushi-stage-lightbox__eyebrow">{media.previewEyebrow}</p>
                    <p className="mushi-stage-lightbox__title">{media.lightboxTitle}</p>
                  </div>
                  <button type="button" className="mushi-stage-lightbox__close" onClick={closeLightbox}>
                    Close
                  </button>
                </div>
                <img
                  src={src}
                  alt={media.alt}
                  className={[
                    'mushi-stage-lightbox__img',
                    media.surface === 'sdk' ? 'mushi-stage-preview__img--sdk' : '',
                  ].join(' ')}
                />
                {demoHref ? (
                  <div className="mushi-stage-lightbox__footer">
                    <a
                      href={demoHref}
                      target={demoHref.startsWith('http') ? '_blank' : undefined}
                      rel={demoHref.startsWith('http') ? 'noreferrer' : undefined}
                    >
                      {media.linkLabel} ↗
                    </a>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function resolveDemoHref(href: string | undefined, consoleHref: string): string | undefined {
  if (!href) return undefined
  if (href.startsWith('http') || href.startsWith('mailto:')) return href
  if (href.startsWith('/')) {
    try {
      const base = consoleHref.startsWith('http')
        ? new URL(consoleHref).origin
        : typeof window !== 'undefined'
          ? window.location.origin
          : ''
      return base ? `${base}${href}` : href
    } catch {
      return href
    }
  }
  return href
}

export function LoopOverviewPreview({ className = '' }: { className?: string }) {
  const { urls } = useMarketing()
  const media = loopOverviewMedia
  const src = urls.screenshots(media.file)

  return (
    <figure className={['mushi-loop-overview', className].filter(Boolean).join(' ')}>
      <div className="mushi-stage-preview__frame mushi-loop-overview__frame">
        <div className="mushi-stage-preview__chrome" aria-hidden="true">
          <span className="mushi-stage-preview__dot" />
          <span className="mushi-stage-preview__dot" />
          <span className="mushi-stage-preview__dot" />
          <span className="mushi-stage-preview__chrome-label">Full loop · animated</span>
        </div>
        <div className="mushi-stage-preview__viewport mushi-loop-overview__viewport">
          <img
            src={src}
            alt={media.alt}
            loading="lazy"
            decoding="async"
            className="mushi-stage-preview__img mushi-stage-preview__img--animated"
          />
        </div>
      </div>
      <figcaption className="mushi-stage-preview__caption">{media.caption}</figcaption>
    </figure>
  )
}
