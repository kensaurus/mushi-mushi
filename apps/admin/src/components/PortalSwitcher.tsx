/**
 * FILE: apps/admin/src/components/PortalSwitcher.tsx
 * PURPOSE: Minimal Admin ↔ Tester portal switch — icon cues with type-on-hover labels.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { checkEnv } from '../lib/env'
import { IconEye, IconShield } from './icons'
import { Tooltip } from './ui'

function isTesterPath(pathname: string) {
  return pathname === '/tester' || pathname.startsWith('/tester/')
}

const PORTALS = [
  {
    id: 'admin' as const,
    to: '/dashboard',
    label: 'Admin',
    hint: 'Admin console — triage bugs, dispatch fixes, run QA',
    Icon: IconShield,
  },
  {
    id: 'tester' as const,
    to: '/tester',
    label: 'Tester',
    hint: 'Tester portal — earn points testing apps',
    Icon: IconEye,
  },
]

function useFloatingAnchorStyle(
  anchorRef: RefObject<HTMLElement | null>,
  show: boolean,
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!show || !anchorRef.current) {
      setStyle(null)
      return
    }
    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const pad = 12
      const estW = 88
      const estH = 24
      let left = r.right + 6
      if (left + estW > vw - pad) {
        left = Math.max(pad, r.left - estW - 6)
      }
      let top = r.top + r.height / 2
      top = Math.min(Math.max(pad + estH / 2, top), vh - pad - estH / 2)
      setStyle({
        position: 'fixed',
        left,
        top,
        transform: 'translateY(-50%)',
        zIndex: 10_001,
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [show, anchorRef])

  return style
}

/** Types label beside the anchor via portal — avoids sidebar overflow clip. */
export function FloatingHoverTypeLabel({
  anchorRef,
  text,
  show,
  reducedMotion,
}: {
  anchorRef: RefObject<HTMLElement | null>
  text: string
  show: boolean
  reducedMotion: boolean
}) {
  const style = useFloatingAnchorStyle(anchorRef, show)
  const [typed, setTyped] = useState('')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (!show) {
      setTyped('')
      return
    }
    if (reducedMotion) {
      setTyped(text)
      return
    }
    let i = 0
    setTyped('')
    timerRef.current = window.setInterval(() => {
      i += 1
      setTyped(text.slice(0, i))
      if (i >= text.length && timerRef.current != null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }, 42)
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
    }
  }, [show, text, reducedMotion])

  if (!show || !style || typeof document === 'undefined') return null

  return createPortal(
    <span
      style={style}
      aria-hidden
      className="pointer-events-none max-w-[min(8rem,calc(100vw-24px))] truncate rounded-[3px] border border-edge bg-surface-raised px-1.5 py-0.5 text-3xs font-medium text-fg shadow-md whitespace-nowrap"
    >
      {typed}
      {typed.length < text.length && !reducedMotion ? (
        <span className="portal-toggle__caret ml-px text-brand/80">|</span>
      ) : null}
    </span>,
    document.body,
  )
}

function PortalSegment({
  portal,
  active,
  compact,
}: {
  portal: (typeof PORTALS)[number]
  active: boolean
  compact: boolean
}) {
  const anchorRef = useRef<HTMLAnchorElement>(null)
  const [hover, setHover] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const { Icon, label, hint, to } = portal

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const showFloatingLabel = !compact && hover

  return (
    <div className="relative z-[1] min-w-0 flex-1">
      <Tooltip content={hint} side="auto" nowrap={false} className="flex min-w-0 w-full">
        <Link
          ref={anchorRef}
          to={to}
          role="radio"
          aria-checked={active}
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          className={[
            'portal-toggle__seg group relative flex h-7 w-full min-w-0 items-center justify-center',
            'rounded px-1 py-0',
            'motion-safe:transition-[color] motion-safe:duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
            active ? 'text-brand' : 'text-fg-muted hover:text-fg-secondary',
          ].join(' ')}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
        </Link>
      </Tooltip>
      <FloatingHoverTypeLabel
        anchorRef={anchorRef}
        text={label}
        show={showFloatingLabel}
        reducedMotion={reducedMotion}
      />
    </div>
  )
}

/** Sidebar Admin | Tester toggle — lives under the mushimushi wordmark. */
export function PortalToggle({ compact = false }: { compact?: boolean }) {
  const { pathname } = useLocation()
  const onTester = isTesterPath(pathname)
  const env = checkEnv()

  if (env.mode === 'self-hosted') {
    return (
      <p className="mt-1 text-2xs uppercase tracking-wide text-fg-muted">
        {onTester ? 'Tester' : 'Admin'}
      </p>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="Portal"
      data-active-portal={onTester ? 'tester' : 'admin'}
      className={[
        'portal-toggle relative mt-1 flex w-full min-w-0 items-stretch overflow-visible',
        'rounded-md bg-surface-overlay/50 p-px',
        compact ? 'gap-0' : 'gap-px',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'portal-toggle__thumb pointer-events-none absolute inset-y-px left-px',
          'w-[calc(50%-1px)] rounded-[3px]',
          'bg-brand/12 ring-1 ring-brand/20',
          'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
          onTester ? 'translate-x-[calc(100%+1px)]' : 'translate-x-0',
        ].join(' ')}
      />
      {PORTALS.map((portal) => (
        <PortalSegment
          key={portal.id}
          portal={portal}
          active={portal.id === 'tester' ? onTester : !onTester}
          compact={compact}
        />
      ))}
    </div>
  )
}
