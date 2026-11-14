'use client'

/**
 * The hero's right half on a desktop: a real product visual with the guide
 * beside it (owner, 2026-11-14: the right half was an empty blur).
 *
 * - The visual is the poster of the real-bug walkthrough (`bug-to-fix`: a
 *   report becoming a merged fix in Mushi Mushi's own console). Clicking play
 *   swaps in the clip, muted with controls. Nothing autoplays, so reduced
 *   motion needs no special case, and the 3 MB video loads only on that click.
 * - The guide slot (`HERO_GUIDES`) holds Field Kenji with his magnifier,
 *   peering at the screen, and takes a second character later: with two
 *   entries, globals.css (`[data-guides="2"]`) sets them side by side.
 * - Below 1024px none of it renders a pixel: the poster and the figures are
 *   `<source media>` with a blank-pixel fallback, and the block is
 *   display: none, so a phone downloads nothing and stays address-box-first.
 */
import { useState } from 'react'
import walkthroughs from '../../data/walkthroughs.generated.json'
import { publicAssetPath } from '../../lib/public-asset-path'
import magnify from '../../assets/mascot/mascot-magnify.webp'
import magnifySm from '../../assets/mascot/mascot-magnify-sm.webp'

const DESKTOP = '(min-width: 1024px)'

/** 1×1 transparent GIF: the fallback below 1024px, so phones fetch nothing. */
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

interface HeroGuide {
  id: string
  /** 600 px and 300 px renders, square, feet on one baseline (docs/mascot/README.md). */
  full: string
  small: string
}

/** Left to right. Each pose shows the job; a second character joins here. */
const HERO_GUIDES: readonly HeroGuide[] = [{ id: 'kenji', full: magnify.src, small: magnifySm.src }]

interface WalkthroughClip {
  id: string
  title: string
  video: string
  poster: string
  width: number
  height: number
  duration: number
}

const CLIP: WalkthroughClip | undefined = (walkthroughs as Record<string, WalkthroughClip>)['bug-to-fix']

export function LandingHeroVisual() {
  const [playing, setPlaying] = useState(false)

  return (
    <div className="landing-hero-visual" data-playing={playing ? 'true' : undefined}>
      {CLIP ? (
        <div className="landing-hero-visual__frame">
          {playing ? (
            <video
              className="landing-hero-visual__media"
              src={publicAssetPath(CLIP.video)}
              poster={publicAssetPath(CLIP.poster)}
              width={CLIP.width}
              height={CLIP.height}
              autoPlay
              muted
              playsInline
              controls
              aria-label={CLIP.title}
            />
          ) : (
            <>
              <picture>
                <source media={DESKTOP} srcSet={publicAssetPath(CLIP.poster)} />
                <img
                  className="landing-hero-visual__media"
                  src={BLANK_PIXEL}
                  alt=""
                  width={CLIP.width}
                  height={CLIP.height}
                  decoding="async"
                  draggable={false}
                />
              </picture>
              {/* The visible label shortens below 1280px, where the frame is
                  small; the accessible name stays whole. */}
              <button
                type="button"
                className="landing-hero-visual__play"
                aria-label={`Watch a real bug get fixed, a ${Math.round(CLIP.duration / 60)} minute video`}
                onClick={() => setPlaying(true)}
              >
                <span aria-hidden="true" className="landing-hero-visual__play-icon" />
                <span aria-hidden="true">
                  Watch<span className="landing-hero-visual__play-long"> a real bug get fixed</span> ·{' '}
                  {Math.round(CLIP.duration / 60)} min
                </span>
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="landing-hero-guide" data-guides={HERO_GUIDES.length} aria-hidden="true">
        {HERO_GUIDES.map((guide) => (
          <picture key={guide.id} className="landing-hero-guide__figure" data-guide={guide.id}>
            <source
              media={DESKTOP}
              srcSet={`${guide.small} 300w, ${guide.full} 600w`}
              sizes={HERO_GUIDES.length > 1 ? '9rem' : '14rem'}
            />
            <img src={BLANK_PIXEL} alt="" width={224} height={224} decoding="async" draggable={false} />
          </picture>
        ))}
      </div>
    </div>
  )
}
