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
import { motion, type Variants } from 'motion/react'
import { LANDING_HERO, LANDING_INSTALL_LEAD } from '@/lib/landing-copy'
import { LandingCheckBox } from './LandingCheckBox'
import { LandingInstallStrip } from './LandingInstallStrip'
import { usePrefersReducedMotion } from './use-prefers-reduced-motion'
import brandMark from '../../assets/brand/kenji-mark.webp'
import magnify from '../../assets/mascot/mascot-magnify.webp'
import magnifySm from '../../assets/mascot/mascot-magnify-sm.webp'

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

/** A small settle, not the old stamp's spin: it is a face now. */
const landingMarkVariants: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: STAMP_EASE } },
}

/** The brand mark: Kenji's face with Mushi-chan under his magnifier. */
const MARK_PROPS = {
  src: brandMark.src,
  alt: '',
  'aria-hidden': true,
  width: 22,
  height: 22,
  className: 'landing-hero-mark',
  draggable: false,
} as const

/**
 * The figures beside the hero copy, left to right. The slot holds one or two:
 * with two, globals.css (`[data-guides="2"]`) sets them side by side,
 * overlapping a little, on one paper spot. Each pose shows the job: Kenji
 * with his magnifier and Mushi-chan on his shoulder.
 */
interface HeroGuide {
  id: string
  /** 600 px and 300 px renders, square, feet on one baseline. */
  full: string
  small: string
}

const HERO_GUIDES: readonly HeroGuide[] = [{ id: 'kenji', full: magnify.src, small: magnifySm.src }]

/** 1×1 transparent GIF: the hero figure's fallback below 1024px. */
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

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

      {/* Field Kenji, magnifier in hand, beside the copy on a desktop.
          Decorative and not clickable, so the hero keeps its two actions.
          Phones get no figure: the <source> only matches at 1024px+, and the
          fallback is a blank pixel, so a phone downloads nothing and the
          address box stays above the fold. Motion is CSS (globals.css),
          still under reduced motion. */}
      <div className="landing-hero-guide" data-guides={HERO_GUIDES.length} aria-hidden="true">
        {HERO_GUIDES.map((guide) => (
          <picture key={guide.id} className="landing-hero-guide__figure" data-guide={guide.id}>
            <source
              media="(min-width: 1024px)"
              srcSet={`${guide.small} 300w, ${guide.full} 600w`}
              sizes={HERO_GUIDES.length > 1 ? '16rem' : '21rem'}
            />
            <img src={BLANK_PIXEL} alt="" width={336} height={336} decoding="async" draggable={false} />
          </picture>
        ))}
      </div>

      <div className="landing-cinematic-hero__content">
        {eyebrow ? (
          <p className="docs-editorial-hero__eyebrow">
            {/* The brand mark, where the vermillion dot stamp was. */}
            {skipEnter ? (
              <img {...MARK_PROPS} />
            ) : (
              <motion.img
                {...MARK_PROPS}
                variants={landingMarkVariants}
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
