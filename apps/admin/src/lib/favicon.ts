/**
 * FILE: apps/admin/src/lib/favicon.ts
 * PURPOSE: Draw a red badge dot on the favicon when the current
 *          `pageContext` reports `criticalCount > 0`. Gives operators
 *          an at-a-glance signal from another browser tab that something
 *          needs attention, matching the pattern Linear / Sentry /
 *          Vercel use.
 *
 *          No dependency — raster path is a bare 32×32 canvas:
 *
 *            load /favicon.svg as an HTMLImageElement
 *            drawImage → canvas
 *            optional red dot in the top-right quadrant
 *            canvas.toDataURL('image/png') → <link rel=icon>.href
 *
 *          Implementation notes:
 *
 *            - We swap the favicon link's `type` to `image/png` when
 *              drawing the badge because Safari refuses to accept a PNG
 *              data URL on an `image/svg+xml` link.
 *            - We cache the rasterised base image in an in-memory
 *              `HTMLImageElement` so state toggles don't re-fetch the
 *              SVG. The element is decoded once per page load.
 *            - `useFaviconBadge()` is a tiny React hook that subscribes
 *              to `pageContext` and calls `updateFaviconBadge` whenever
 *              `criticalCount` changes.
 */

import { useEffect } from 'react'
import { usePageContext } from './pageContext'

const FAVICON_SIZE = 32
/** Size of the badge pip in canvas pixels. */
const DOT_RADIUS = 6
/**
 * Badge colours, tuned for the vermillion 朱印 hanko favicon.
 *
 * The previous palette was Tailwind red-500 with a near-black ring — that
 * works on any *neutral* favicon, but the new mark is itself vermillion,
 * so a red-on-red badge would vanish into the stamp. Inverting it (paper
 * cream pip + sumi ink ring) gives maximum contrast on vermillion *and*
 * keeps the on-brand "stamp + paper notification pip" visual metaphor.
 *
 * If the favicon is ever recoloured back to a neutral surface, swap these
 * back to a warning red — there's nothing in the API that needs to change.
 */
const DOT_COLOR = '#F8F4ED' // paper cream — same token as packages/web/src/styles.ts
const DOT_RING_COLOR = '#0E0D0B' // sumi ink — gives the pip a crisp edge on vermillion
const BASE_SRC = '/favicon.svg'

let baseImage: HTMLImageElement | null = null
let baseImageReady: Promise<HTMLImageElement> | null = null
/** The last badge count we rendered. Used to skip redundant paints. */
let lastRenderedCount: number | null = null

/**
 * Load `/favicon.svg` as an `HTMLImageElement` that's actually rasterizable.
 *
 * The SVG in `public/favicon.svg` carries only a `viewBox` — no explicit
 * `width` / `height`. Chromium's `Image` element refuses to decode a
 * viewBox-only SVG (EncodingError), so we fetch the text, inject
 * `width="32" height="32"` if missing, and load from a blob URL. That
 * produces a dimensioned image the canvas can `drawImage()` cleanly.
 */
function ensureBaseImage(): Promise<HTMLImageElement> {
  if (baseImage) return Promise.resolve(baseImage)
  if (baseImageReady) return baseImageReady
  baseImageReady = (async () => {
    const res = await fetch(BASE_SRC, { cache: 'force-cache' })
    if (!res.ok) throw new Error(`favicon fetch failed: ${res.status}`)
    let svg = await res.text()
    // Inject explicit dimensions when the author shipped a viewBox-only
    // SVG. Regex is deliberately narrow — we only touch the first
    // `<svg` tag and only when neither dimension is present.
    if (!/\bwidth\s*=/.test(svg) || !/\bheight\s*=/.test(svg)) {
      svg = svg.replace(/<svg\b/i, `<svg width="${FAVICON_SIZE}" height="${FAVICON_SIZE}"`)
    }
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.decoding = 'async'
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('favicon image failed to decode'))
        el.src = url
      })
      baseImage = img
      return img
    } finally {
      // Keep the blob URL alive for the image's lifetime — revoke the
      // temporary reference now that the `Image` has resolved. Chromium
      // retains the decoded bitmap independently of the blob URL.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  })().catch((err) => {
    baseImageReady = null
    throw err
  })
  return baseImageReady
}

function findIconLink(): HTMLLinkElement | null {
  return document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null
}

/**
 * Paint the favicon with an optional red badge and commit it to the
 * `<link rel="icon">` href. Safe to call from any component; it short-
 * circuits when the count hasn't changed since the previous paint.
 */
export async function updateFaviconBadge(count: number): Promise<void> {
  if (typeof document === 'undefined') return
  const safeCount = Math.max(0, Math.floor(count))
  if (lastRenderedCount === safeCount) return

  try {
    const img = await ensureBaseImage()
    const link = findIconLink()
    if (!link) return

    // When there's nothing to badge, revert to the raw SVG for the
    // sharpest appearance on high-DPI displays. Skipping the canvas
    // path entirely also means we don't pay a paint cost on every
    // navigation when counts drop to zero.
    if (safeCount === 0) {
      if (link.href !== new URL(BASE_SRC, window.location.origin).href) {
        link.type = 'image/svg+xml'
        link.href = BASE_SRC
      }
      lastRenderedCount = 0
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = FAVICON_SIZE
    canvas.height = FAVICON_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE)
    ctx.drawImage(img, 0, 0, FAVICON_SIZE, FAVICON_SIZE)

    // Notification pip with a thin contrasting ring so it reads as a
    // badge at 16 px even on top of the vermillion hanko mark. Ring is
    // drawn first as a slightly larger filled circle so the pip cleanly
    // overpaints the centre — saves us from stroke-width quirks at this
    // tiny canvas resolution.
    const cx = FAVICON_SIZE - DOT_RADIUS - 1
    const cy = DOT_RADIUS + 1
    ctx.beginPath()
    ctx.arc(cx, cy, DOT_RADIUS + 1, 0, Math.PI * 2)
    ctx.fillStyle = DOT_RING_COLOR
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = DOT_COLOR
    ctx.fill()

    link.type = 'image/png'
    link.href = canvas.toDataURL('image/png')
    lastRenderedCount = safeCount
  } catch {
    // Favicon failures are never fatal — quietly abort and leave the
    // default SVG in place. We deliberately don't Sentry-log this
    // because the hook runs on every navigation and a throwing image
    // decode would spam the error tracker.
  }
}

/**
 * Reset the favicon to its SVG default. Used by the Layout cleanup
 * effect so a "danger" badge never lingers after sign-out.
 */
export function resetFaviconBadge(): void {
  void updateFaviconBadge(0)
}

/**
 * Subscribe to the current `pageContext` and paint a red badge when the
 * published `criticalCount` is non-zero. Call once, from `<Layout>`.
 */
export function useFaviconBadge(): void {
  const ctx = usePageContext()
  const count = ctx?.criticalCount ?? 0

  useEffect(() => {
    void updateFaviconBadge(count)
  }, [count])

  useEffect(() => {
    return () => {
      resetFaviconBadge()
    }
  }, [])
}
