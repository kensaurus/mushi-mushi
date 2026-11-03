'use client'

/**
 * A recorded walkthrough of a real Mushi Mushi screen: the video shows where
 * to click, the step list beside it says the same thing in words. Clicking a
 * step jumps the video there; the step that is playing is highlighted.
 *
 * Videos and step times come from scripts/record-docs-walkthroughs.mjs (pnpm gen:walkthroughs)
 * (data/walkthroughs.generated.json). The steps are real text in the page, so
 * readers who cannot or do not want to watch, search engines and screen
 * readers get the full instructions.
 *
 * Plays muted only while on screen. With reduced motion it never autoplays.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import walkthroughs from '../data/walkthroughs.generated.json'
import { publicAssetPath } from '../lib/public-asset-path'
import { usePrefersReducedMotion } from './landing/use-prefers-reduced-motion'

interface Chapter {
  t: number
  title: string
  detail: string
}

interface WalkthroughData {
  id: string
  title: string
  summary: string
  video: string
  poster: string
  width: number
  height: number
  duration: number
  chapters: Chapter[]
}

const ALL = walkthroughs as Record<string, WalkthroughData>

type WalkthroughId = keyof typeof walkthroughs

export interface WalkthroughProps {
  id: WalkthroughId
  /** Show only the current step under the video (for the landing page). */
  compact?: boolean
  /** Override the heading; pass `null` to hide it. */
  title?: string | null
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Walkthrough({ id, compact = false, title }: WalkthroughProps) {
  const data = ALL[id]
  const videoRef = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const reduced = usePrefersReducedMotion()
  const [active, setActive] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  // Set once the reader pauses, so scrolling back does not restart it.
  const userPaused = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    const root = rootRef.current
    if (!video || !root || reduced) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
          if (!userPaused.current) video.play().catch(() => {})
        } else {
          video.pause()
        }
      },
      { threshold: [0, 0.45, 1] },
    )
    io.observe(root)
    return () => io.disconnect()
  }, [reduced])

  const onTime = useCallback(() => {
    const video = videoRef.current
    if (!video || !data) return
    const t = video.currentTime
    let idx = -1
    data.chapters.forEach((c, i) => {
      if (t >= c.t) idx = i
    })
    setActive(idx)
    setProgress(data.duration ? Math.min(1, t / data.duration) : 0)
  }, [data])

  const seek = useCallback(
    (i: number) => {
      const video = videoRef.current
      if (!video || !data) return
      video.currentTime = data.chapters[i].t + 0.05
      userPaused.current = false
      video.play().catch(() => {})
      setActive(i)
    },
    [data],
  )

  const toggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      userPaused.current = false
      video.play().catch(() => {})
    } else {
      userPaused.current = true
      video.pause()
    }
  }, [])

  const fullscreen = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const el = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
    else el.webkitEnterFullscreen?.()
  }, [])

  if (!data) return null
  const heading = title === undefined ? data.title : title
  const current = active >= 0 ? data.chapters[active] : null

  return (
    <figure
      ref={rootRef}
      id={data.id}
      className={`docs-walkthrough not-prose${compact ? ' docs-walkthrough--compact' : ''}`}
      aria-label={`${data.title}: a ${fmt(data.duration)} walkthrough`}
    >
      {heading ? (
        <figcaption className="docs-walkthrough__head">
          <span className="docs-walkthrough__kicker">Walkthrough · {fmt(data.duration)}</span>
          <span className="docs-walkthrough__title">{heading}</span>
          <span className="docs-walkthrough__summary">{data.summary}</span>
        </figcaption>
      ) : null}

      <div className="docs-walkthrough__body">
        <div className="docs-walkthrough__stage">
          <div className="docs-walkthrough__frame">
            <video
              ref={videoRef}
              className="docs-walkthrough__video"
              src={publicAssetPath(data.video)}
              poster={publicAssetPath(data.poster)}
              width={data.width}
              height={data.height}
              muted
              loop
              playsInline
              preload="metadata"
              controls={reduced}
              aria-describedby={`wt-steps-${data.id}`}
              onTimeUpdate={onTime}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </div>
          <div className="docs-walkthrough__bar">
            <button type="button" className="docs-walkthrough__btn" onClick={toggle} aria-label={playing ? 'Pause the walkthrough' : 'Play the walkthrough'}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <div className="docs-walkthrough__track" aria-hidden="true">
              <span className="docs-walkthrough__fill" style={{ transform: `scaleX(${progress})` }} />
              {data.chapters.map((c, i) => (
                <span key={c.t} className="docs-walkthrough__tick" style={{ left: `${(c.t / data.duration) * 100}%` }} data-on={i <= active ? '' : undefined} />
              ))}
            </div>
            <button type="button" className="docs-walkthrough__btn" onClick={fullscreen}>
              Full screen
            </button>
          </div>
          {compact ? (
            <p className="docs-walkthrough__now" aria-live="off">
              {current ? (
                <>
                  <span className="docs-walkthrough__num">{active + 1}</span> {current.title}
                </>
              ) : (
                data.summary
              )}
            </p>
          ) : null}
        </div>

        <ol id={`wt-steps-${data.id}`} className={`docs-walkthrough__steps${compact ? ' sr-only' : ''}`}>
          {data.chapters.map((c, i) => (
            <li key={c.t} data-active={i === active ? '' : undefined}>
              <button type="button" className="docs-walkthrough__step" onClick={() => seek(i)}>
                <span className="docs-walkthrough__num">{i + 1}</span>
                <span className="docs-walkthrough__step-text">
                  <span className="docs-walkthrough__step-title">{c.title}</span>
                  {c.detail ? <span className="docs-walkthrough__step-detail">{c.detail}</span> : null}
                </span>
                <span className="docs-walkthrough__time">{fmt(c.t)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  )
}
