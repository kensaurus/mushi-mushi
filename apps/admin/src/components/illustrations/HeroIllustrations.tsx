/**
 * FILE: apps/admin/src/components/illustrations/HeroIllustrations.tsx
 * PURPOSE: Lightweight, theme-aware SVG hero illustrations for empty states.
 *          Each one is a 64×64 outline glyph rendered with the current text
 *          color so it inherits dark/light mode without extra work. Goal is
 *          to give beginner-mode pages a friendly visual anchor instead of a
 *          blank "no data yet" wall — see audit Wave I §6 (NN/G empty-state
 *          guidelines) and the Phase 5 follow-up tasks in
 *          docs/audit-2026-04-20/REPORT.md.
 *
 *          Illustrations are intentionally simple (one accent color, light
 *          stroke weight) so they read as decoration — not as required UI
 *          chrome. Pair every one with a clear title + next-action button.
 */

import type { JSX } from 'react'

interface IllustrationProps {
  className?: string
  /** Optional accent color class (text-*). Defaults to brand. */
  accent?: string
  /** Pixel size of the rendered SVG. Defaults to 56 — comfortable in our
   *  EmptyState card without dominating the copy below. */
  size?: number
}

const wrap = (children: JSX.Element, { className, size = 56, accent = 'text-brand' }: IllustrationProps) => (
  <span
    aria-hidden="true"
    className={`mx-auto inline-flex items-center justify-center ${accent} ${className ?? ''}`}
    style={{ width: size, height: size }}
  >
    {children}
  </span>
)

export function HeroBugFunnel(props: IllustrationProps = {}) {
  return wrap(
    (
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 12h48l-16 22v18l-16-6V34L8 12Z" className="opacity-50" />
        <circle cx="32" cy="44" r="2" fill="currentColor" />
        <circle cx="32" cy="50" r="1.5" fill="currentColor" />
        <path d="M22 6l4 4M42 6l-4 4M16 22l4 0M48 22l-4 0" className="opacity-70" />
      </svg>
    ),
    props,
  )
}

export function HeroFixWrench(props: IllustrationProps = {}) {
  return wrap(
    (
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M44 12a8 8 0 0 0-10 10l-22 22a3 3 0 0 0 4 4l22-22a8 8 0 0 0 10-10l-6 6-4-4 6-6Z" className="opacity-80" />
        <circle cx="14" cy="50" r="2" fill="currentColor" className="opacity-60" />
        <path d="M50 36l8 8M50 44l8-8" className="opacity-50" />
      </svg>
    ),
    props,
  )
}

export function HeroJudgeScale(props: IllustrationProps = {}) {
  return wrap(
    (
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 8v44M16 14h32" />
        <path d="M16 14l-8 16h16l-8-16ZM48 14l-8 16h16l-8-16Z" className="opacity-70" />
        <rect x="22" y="50" width="20" height="4" rx="1" className="opacity-80" />
        <circle cx="32" cy="8" r="2" fill="currentColor" />
      </svg>
    ),
    props,
  )
}

export function HeroPulseHealth(props: IllustrationProps = {}) {
  return wrap(
    (
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="14" width="52" height="36" rx="4" className="opacity-50" />
        <path d="M10 32h10l4-10 6 20 5-14 4 6h15" />
        <circle cx="50" cy="34" r="2" fill="currentColor" />
      </svg>
    ),
    props,
  )
}

export function HeroPlugIntegration(props: IllustrationProps = {}) {
  return wrap(
    (
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 8v8M30 8v8" />
        <rect x="18" y="16" width="16" height="14" rx="2" className="opacity-80" />
        <path d="M26 30v10a8 8 0 0 0 8 8h12" />
        <rect x="44" y="42" width="14" height="14" rx="2" className="opacity-60" />
        <circle cx="51" cy="49" r="2" fill="currentColor" />
      </svg>
    ),
    props,
  )
}

export function HeroGraphNodes(props: IllustrationProps = {}) {
  return wrap(
    (
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="14" cy="20" r="4" fill="currentColor" className="opacity-80" />
        <circle cx="50" cy="20" r="4" fill="currentColor" className="opacity-50" />
        <circle cx="32" cy="44" r="4" fill="currentColor" className="opacity-80" />
        <circle cx="14" cy="50" r="3" fill="currentColor" className="opacity-50" />
        <circle cx="50" cy="50" r="3" fill="currentColor" className="opacity-50" />
        <path d="M14 20l18 24M50 20l-18 24M14 50l18-6M50 50l-18-6" className="opacity-60" />
      </svg>
    ),
    props,
  )
}

export function HeroSearch(props: IllustrationProps = {}) {
  return wrap(
    (
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="28" cy="28" r="14" className="opacity-70" />
        <path d="M40 40l14 14" />
        <path d="M22 28h12M28 22v12" className="opacity-50" />
      </svg>
    ),
    props,
  )
}
