'use client'

/**
 * Inline screenshot / GIF block for docs pages.
 * Images live under public/screenshots/ (synced from docs/screenshots/).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { publicAssetPath } from '../lib/public-asset-path'

export type DocScreenshotVariant = 'preview' | 'showcase'

export interface DocScreenshotProps {
  /** Filename only — e.g. "dashboard-dark.png" */
  src: string
  alt: string
  caption?: ReactNode
  /** Optional light-mode sibling for theme-aware swap. */
  lightSrc?: string
  /** Link target — usually the live admin demo route. */
  href?: string
  /** When true, src is treated as an animated GIF. */
  animated?: boolean
  /** preview = capped admin-doc peek; showcase = full-width landing strip */
  variant?: DocScreenshotVariant
  /** Click preview to open a full-size lightbox. */
  expandable?: boolean
}

export function DocScreenshot({
  src,
  alt,
  caption,
  lightSrc,
  href,
  animated = false,
  variant = 'preview',
  expandable = true,
}: DocScreenshotProps) {
  const [expanded, setExpanded] = useState(false)
  const darkUrl = publicAssetPath(`/screenshots/${src}`)
  const lightUrl = lightSrc ? publicAssetPath(`/screenshots/${lightSrc}`) : darkUrl
  const expandUrl = animated || !lightSrc ? darkUrl : darkUrl

  const closeLightbox = useCallback(() => setExpanded(false), [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLightbox()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [closeLightbox, expanded])

  const img =
    !animated && lightSrc ? (
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={darkUrl} />
        <source media="(prefers-color-scheme: light)" srcSet={lightUrl} />
        <img
          src={darkUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="docs-screenshot__img"
        />
      </picture>
    ) : (
      <img
        src={darkUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="docs-screenshot__img"
      />
    )

  const canExpand = expandable && variant === 'preview'
  const isPreview = variant === 'preview'

  const media = canExpand ? (
    <button
      type="button"
      className="docs-screenshot__expand-trigger"
      onClick={() => setExpanded(true)}
      aria-label={`Expand ${alt}`}
      title="Click to expand"
    >
      {img}
      <span className="docs-screenshot__expand-hint" aria-hidden="true">
        Click to expand
      </span>
    </button>
  ) : href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in the live demo"
      className="docs-screenshot__link"
    >
      {img}
    </a>
  ) : (
    img
  )

  return (
    <>
      <figure
        className={[
          'docs-screenshot not-prose',
          animated ? 'docs-screenshot--animated' : '',
          isPreview ? 'docs-screenshot--preview' : 'docs-screenshot--showcase',
          canExpand ? 'docs-screenshot--expandable' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isPreview ? (
          <div className="docs-screenshot__frame">
            <div className="docs-screenshot__chrome" aria-hidden="true">
              <span className="docs-screenshot__dot" />
              <span className="docs-screenshot__dot" />
              <span className="docs-screenshot__dot" />
              <span className="docs-screenshot__chrome-label">
                {animated ? 'Admin console · animated' : 'Live admin preview'}
              </span>
            </div>
            <div className="docs-screenshot__viewport">{media}</div>
          </div>
        ) : (
          media
        )}
        {caption ? (
          <figcaption className="docs-screenshot__caption">
            {caption}
            {canExpand ? (
              <>
                {' '}
                ·{' '}
                <button
                  type="button"
                  className="docs-screenshot__caption-button"
                  onClick={() => setExpanded(true)}
                >
                  expand preview
                </button>
              </>
            ) : null}
            {href ? (
              <>
                {' '}
                ·{' '}
                <a href={href} target="_blank" rel="noopener noreferrer">
                  open live demo ↗
                </a>
              </>
            ) : null}
          </figcaption>
        ) : null}
      </figure>

      {expanded && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="docs-screenshot-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={alt}
              onClick={closeLightbox}
            >
              <div
                className="docs-screenshot-lightbox__panel"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="docs-screenshot-lightbox__toolbar">
                  <p className="docs-screenshot-lightbox__title">{alt}</p>
                  <button
                    type="button"
                    className="docs-screenshot-lightbox__close"
                    onClick={closeLightbox}
                  >
                    Close <span aria-hidden="true">✕</span>
                  </button>
                </div>
                <div className="docs-screenshot-lightbox__body">
                  <img
                    src={expandUrl}
                    alt={alt}
                    className="docs-screenshot-lightbox__img"
                  />
                </div>
                {href ? (
                  <div className="docs-screenshot-lightbox__footer">
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      Open in live admin console ↗
                    </a>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
