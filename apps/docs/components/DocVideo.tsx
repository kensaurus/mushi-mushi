'use client'

/**
 * Looping, muted demo clip for docs pages (it replaced the 2–8 MB demo GIFs).
 *
 * Files live under public/screenshots/ (synced from docs/screenshots/), made by
 * scripts/marketing/demo-video.mjs: `{name}.webm`, `{name}.mp4` and
 * `{name}-poster.webp`. Nothing downloads until the clip scrolls into view
 * (preload="none"); it plays only while visible, and under
 * prefers-reduced-motion it stays on the poster.
 */

import { useEffect, useRef } from 'react'
import { publicAssetPath } from '../lib/public-asset-path'
import { usePrefersReducedMotion } from './landing/use-prefers-reduced-motion'

interface DocVideoProps {
  /** File stem under public/screenshots/ — e.g. "dashboard-demo". */
  name: string
  /** Accessible description (the old GIF's alt text). */
  label: string
  className?: string
  /**
   * Lightbox mode: native controls, and it starts at once (the reader asked
   * for it by expanding) unless reduced motion is on.
   */
  controls?: boolean
}

function demoVideoSources(name: string) {
  const base = publicAssetPath(`/screenshots/${name}`)
  return { webm: `${base}.webm`, mp4: `${base}.mp4`, poster: `${base}-poster.webp` }
}

export function DocVideo({ name, label, className, controls = false }: DocVideoProps) {
  const ref = useRef<HTMLVideoElement>(null)
  // Starts true until mounted, so nothing plays before the preference is known.
  const reducedMotion = usePrefersReducedMotion()
  const { webm, mp4, poster } = demoVideoSources(name)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    // React does not write `muted` into server HTML, and browsers only allow
    // play() without a gesture on a muted element. Set the property here.
    video.muted = true
    if (reducedMotion) {
      video.pause()
      return
    }
    const play = () => {
      video.play().catch(() => {
        // Autoplay refused (data saver, low power): the poster stays up.
      })
    }
    if (controls) {
      play()
      return () => video.pause()
    }
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) play()
        else video.pause()
      },
      { threshold: 0.25 },
    )
    observer.observe(video)
    return () => {
      observer.disconnect()
      video.pause()
    }
  }, [controls, reducedMotion])

  return (
    <video
      ref={ref}
      className={className}
      aria-label={label}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      controls={controls}
    >
      <source src={webm} type="video/webm" />
      <source src={mp4} type="video/mp4" />
    </video>
  )
}
