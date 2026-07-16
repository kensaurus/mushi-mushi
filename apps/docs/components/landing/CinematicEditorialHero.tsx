'use client'

/**
 * Cinematic landing hero — H1 + lead + primary CTAs, Motion stamp / line stagger, lazy R3F ink.
 * No scroll timelines (docs/MOTION.md).
 */
import { useEffect, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { motion, useReducedMotion } from 'motion/react'
import { LANDING_HERO, LANDING_HERO_CTAS } from '@/lib/landing-copy'
import { usePrefersReducedMotion } from './use-prefers-reduced-motion'
import { landingStampVariants } from './landing-stagger'

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
  const motionReduced = useReducedMotion()
  const showCanvas = useShowDesktopCanvas(reducedMotion)
  const skipEnter = reducedMotion || motionReduced

  return (
    <header className="docs-editorial-hero landing-cinematic-hero not-prose">
      {showCanvas ? (
        <InkMothCanvas reducedMotion={reducedMotion} />
      ) : (
        <div className="landing-ink-poster" aria-hidden="true" />
      )}

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
        <p className="landing-hero-proof">{LANDING_HERO.proofLine}</p>

        <div className="landing-hero-ctas" role="group" aria-label="Get started">
          {LANDING_HERO_CTAS.map((cta) => {
            const className = `landing-hero-cta landing-hero-cta--${cta.kind}`
            if (cta.external) {
              return (
                <a
                  key={cta.href}
                  className={className}
                  href={cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {cta.label}
                </a>
              )
            }
            return (
              <Link key={cta.href} className={className} href={cta.href}>
                {cta.label}
              </Link>
            )
          })}
        </div>
      </div>
    </header>
  )
}
