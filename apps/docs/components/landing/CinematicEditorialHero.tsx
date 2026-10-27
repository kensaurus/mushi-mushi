'use client'

/**
 * Cinematic landing hero — H1, one-line lead, one-click start (console, Cursor, npx), Motion stamp / line stagger, lazy R3F ink.
 * No scroll timelines (docs/MOTION.md).
 */
import { useEffect, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { motion } from 'motion/react'
import { MUSHI_CANONICAL_URLS } from '@mushi-mushi/brand'
import { ConnectClientIcon } from '@mushi-mushi/marketing-ui'
import { buildOAuthInstall } from '@mushi-mushi/mcp/clients'
import { LANDING_HERO, LANDING_HERO_START } from '@/lib/landing-copy'
import { CopyCommand } from '../CopyCommand'
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

// URL-only install, so Cursor runs the Mushi sign-in on first use (no key).
const cursorInstall = buildOAuthInstall('cursor', { mcpOAuthUrl: MUSHI_CANONICAL_URLS.hostedMcp })
const CURSOR_DEEPLINK = cursorInstall.kind === 'deeplink' ? cursorInstall.url : '/connect'

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
        <div className="landing-hero-start" role="group" aria-label="Get started">
          <div className="landing-hero-ctas">
            <a
              className="landing-hero-cta landing-hero-cta--primary"
              href={LANDING_HERO_START.console.href}
              data-mushi-cta={LANDING_HERO_START.console.id}
              data-mushi-location="hero"
            >
              {LANDING_HERO_START.console.label}
            </a>
            <a
              className="landing-hero-cta landing-hero-cta--secondary"
              href={CURSOR_DEEPLINK}
              data-mushi-cta={LANDING_HERO_START.cursor.id}
              data-mushi-location="hero"
            >
              <span className="landing-hero-cta__icon" aria-hidden="true">
                <ConnectClientIcon id="cursor" size={16} />
              </span>
              {LANDING_HERO_START.cursor.label}
            </a>
          </div>
          <div className="landing-hero-npx">
            <CopyCommand
              label={LANDING_HERO_START.npx.label}
              cmd={LANDING_HERO_START.npx.cmd}
              ctaId={LANDING_HERO_START.npx.id}
              location="hero"
            />
          </div>
        </div>
        <p className="landing-hero-reassure">
          {LANDING_HERO.reassure}{' '}
          <Link
            href={LANDING_HERO_START.more.href}
            data-mushi-cta={LANDING_HERO_START.more.id}
            data-mushi-location="hero"
          >
            {LANDING_HERO_START.more.label}
          </Link>
          {' · '}
          <a
            href={LANDING_HERO.star.href}
            target="_blank"
            rel="noopener noreferrer"
            data-mushi-cta={LANDING_HERO.star.ctaId}
            data-mushi-location="hero"
          >
            {LANDING_HERO.star.label}
          </a>
        </p>
      </div>
    </header>
  )
}
