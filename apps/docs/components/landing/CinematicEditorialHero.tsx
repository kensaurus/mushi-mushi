'use client'

/**
 * Cinematic landing hero (ADR 0056) — H1, the plain subline, then exactly two
 * actions: the PRIMARY one is the free check's address box (no sign-up,
 * nothing to install), with a facts row under it; the SECOND is the install
 * box (Lovable or Bolt first, then Claude Code, Cursor, other). The sample
 * diagnosis is one scroll down, in How it works. Motion stamp / line stagger,
 * lazy R3F ink.
 * No scroll timelines (docs/MOTION.md).
 */
import { useEffect, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'motion/react'
import { LANDING_HERO, LANDING_INSTALL_LEAD } from '@/lib/landing-copy'
import { LandingCheckBox } from './LandingCheckBox'
import { LandingInstallStrip } from './LandingInstallStrip'
import { usePrefersReducedMotion } from './use-prefers-reduced-motion'
import { landingStampVariants } from './landing-stagger'
import { LandingHeroVisual } from './LandingHeroVisual'

const InkMothCanvas = dynamic(
  () => import('./InkMothCanvas').then((m) => m.InkMothCanvas),
  { ssr: false, loading: () => <div className="landing-ink-poster" aria-hidden="true" /> },
)

interface CinematicEditorialHeroProps {
  eyebrow?: string
  title: ReactNode
  lead?: ReactNode
}

function useShowDesktopCanvas(reducedMotion: boolean): boolean {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setShow(mq.matches && !reducedMotion)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [reducedMotion])

  return show
}

const STAMP_EASE = [0.22, 1, 0.36, 1] as const

export function CinematicEditorialHero({
  eyebrow,
  title,
  lead,
}: CinematicEditorialHeroProps) {
  const reducedMotion = usePrefersReducedMotion()
  const showCanvas = useShowDesktopCanvas(reducedMotion)
  // Was `reducedMotion || useReducedMotion()`. Motion's hook reads matchMedia
  // during render, so it disagrees with the server on the hydration pass; the
  // OR masked that here but left the hazard one edit away from mattering.
  const skipEnter = reducedMotion

  return (
    <header className="docs-editorial-hero landing-cinematic-hero not-prose">
      {showCanvas ? (
        <InkMothCanvas reducedMotion={reducedMotion} />
      ) : (
        <div className="landing-ink-poster" aria-hidden="true" />
      )}

      {/* Desktop only: the real-bug clip's poster (play on click) with Field
          Kenji peering at it through his magnifier. Phones download none of
          it and stay address-box-first (LandingHeroVisual). */}
      <LandingHeroVisual />

      <div className="landing-cinematic-hero__content">
        {eyebrow ? (
          <p className="docs-editorial-hero__eyebrow">
            {skipEnter ? (
              <span className="docs-editorial-hero__stamp landing-hanko" aria-hidden="true" />
            ) : (
              <motion.span
                className="docs-editorial-hero__stamp landing-hanko"
                aria-hidden="true"
                variants={landingStampVariants}
                initial="hidden"
                animate="visible"
              />
            )}
            {eyebrow}
          </p>
        ) : null}
        {skipEnter ? (
          <h1 className="docs-editorial-hero__title">{title}</h1>
        ) : (
          <motion.h1
            className="docs-editorial-hero__title"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: STAMP_EASE, delay: 0.08 }}
          >
            {title}
          </motion.h1>
        )}
        {lead ? (
          skipEnter ? (
            <p className="docs-editorial-hero__lead">{lead}</p>
          ) : (
            <motion.p
              className="docs-editorial-hero__lead"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: STAMP_EASE, delay: 0.2 }}
            >
              {lead}
            </motion.p>
          )
        ) : null}
        {/* Primary action (ADR 0056): value before trust. */}
        <LandingCheckBox />
        <ul className="landing-hero-facts" aria-label="What it takes">
          {LANDING_HERO.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
        {/* Second action: add the report button. */}
        <p className="landing-install-lead">{LANDING_INSTALL_LEAD}</p>
        <LandingInstallStrip />
      </div>
    </header>
  )
}
