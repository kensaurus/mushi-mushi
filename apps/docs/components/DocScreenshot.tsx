/**
 * Inline screenshot / GIF block for docs pages.
 * Images live under public/screenshots/ (synced from docs/screenshots/).
 */

import type { ReactNode } from 'react'
import { publicAssetPath } from '../lib/public-asset-path'

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
}

export function DocScreenshot({
  src,
  alt,
  caption,
  lightSrc,
  href,
  animated = false,
}: DocScreenshotProps) {
  const darkUrl = publicAssetPath(`/screenshots/${src}`)
  const lightUrl = lightSrc ? publicAssetPath(`/screenshots/${lightSrc}`) : darkUrl

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

  const frame = (
    <figure className={`docs-screenshot not-prose${animated ? ' docs-screenshot--animated' : ''}`}>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title="Open in the live demo">
          {img}
        </a>
      ) : (
        img
      )}
      {caption ? (
        <figcaption className="docs-screenshot__caption">
          {caption}
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
  )

  return frame
}
