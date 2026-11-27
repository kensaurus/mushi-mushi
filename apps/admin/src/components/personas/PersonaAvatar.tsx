/**
 * FILE: apps/admin/src/components/personas/PersonaAvatar.tsx
 * PURPOSE: A persona's picture (ADR 0073), drawn from what the persona is: a
 *          tile in a hue picked from its name (never a state colour), its
 *          initials, the device it holds (laptop, tablet or phone outline), a
 *          small badge for each need (sound waves for a screen reader, a
 *          magnifier for low vision, a key for keyboard only, pause for reduced
 *          motion …) and a two-letter language tag when it does not read
 *          English. No images, no emoji: one inline SVG on token colours.
 *
 *   <PersonaAvatar persona={p} size="lg" />           announced: "Japanese visitor: phone, reads Japanese"
 *   <PersonaAvatar persona={p} size="sm" decorative /> beside the printed name: hidden from screen readers
 *
 * Motion: it settles in once (ci-pop) and lifts 1 px on hover of its group;
 * both are off under prefers-reduced-motion (components.css turns ci-pop off,
 * the lift is motion-safe only). CSS only, so it renders the same in tests.
 */

import { CHIP_TONE } from '../../lib/chipTone'
import { avatarAccent, avatarInitials, avatarLabel, sortNeeds, type AvatarAccent, type PersonaDevice, type PersonaFields, type PersonaNeed } from '../../lib/personas'

type AvatarPersona = Pick<PersonaFields, 'name' | 'device' | 'locale' | 'accessibility'>

/** Tile ground + ink for each hue: the design system's AA chip recipes (CHIP_TONE) only. */
const ACCENT_TONE: Record<AvatarAccent, string> = {
  accent: CHIP_TONE.accent,
  info: CHIP_TONE.info,
  lime: CHIP_TONE.ok,
  brand: CHIP_TONE.brand,
}

const SIZE = {
  sm: { box: 'h-6 w-6 rounded-sm', px: 24, badges: false },
  md: { box: 'h-10 w-10 rounded-md', px: 40, badges: true },
  lg: { box: 'h-14 w-14 rounded-lg', px: 56, badges: true },
} as const

/** Device outlines in a 12×12 box. */
function DeviceGlyph({ device }: { device: PersonaDevice }) {
  if (device === 'desktop') {
    return (
      <>
        <rect x="2" y="2.5" width="8" height="5.5" rx="0.8" />
        <path d="M0.6 10H11.4" />
      </>
    )
  }
  if (device === 'tablet') {
    return (
      <>
        <rect x="2.2" y="1" width="7.6" height="10" rx="1.2" />
        <path d="M5.4 9.2H6.6" />
      </>
    )
  }
  return (
    <>
      <rect x="3.4" y="0.6" width="5.2" height="10.8" rx="1.2" />
      <path d="M5.3 9.6H6.7" />
    </>
  )
}

/** Need glyphs in a 10×10 box. */
function NeedGlyph({ need }: { need: PersonaNeed }) {
  switch (need) {
    case 'screen_reader':
      return (
        <>
          <path d="M1.5 4H3.4L5.6 2.2V7.8L3.4 6H1.5Z" />
          <path d="M7 3.6Q7.9 5 7 6.4" />
          <path d="M8.2 2.6Q9.6 5 8.2 7.4" />
        </>
      )
    case 'low_vision':
      return (
        <>
          <circle cx="4.2" cy="4.2" r="2.7" />
          <path d="M6.2 6.2L8.8 8.8" />
        </>
      )
    case 'keyboard_only':
      return (
        <>
          <rect x="1" y="2.4" width="8" height="5.2" rx="1" />
          <path d="M3 4.3H3.01M5 4.3H5.01M7 4.3H7.01M3.4 6H6.6" />
        </>
      )
    case 'reduced_motion':
      return <path d="M3.6 2.4V7.6M6.4 2.4V7.6" />
    case 'color_blind':
      return (
        <>
          <circle cx="5" cy="5" r="3.4" />
          <path d="M5 1.6A3.4 3.4 0 0 1 5 8.4Z" fill="currentColor" />
        </>
      )
    case 'motor':
      return (
        <>
          <circle cx="5" cy="5" r="3.4" />
          <circle cx="5" cy="5" r="0.9" fill="currentColor" />
        </>
      )
    case 'plain_language':
      return <path d="M2 3H8M2 5H8M2 7H5.5" />
  }
}

/** Where up to three need badges sit along the top edge (viewBox 64). */
const NEED_SLOTS = [52, 38, 24] as const

export function PersonaAvatar({
  persona,
  size = 'md',
  decorative = false,
  className = '',
}: {
  persona: AvatarPersona
  size?: keyof typeof SIZE
  /** True when the name is printed beside it: the picture adds nothing for a screen reader. */
  decorative?: boolean
  className?: string
}) {
  const s = SIZE[size]
  const initials = avatarInitials(persona.name)
  const needs = sortNeeds(persona.accessibility)
  const shown = needs.slice(0, NEED_SLOTS.length)
  const more = needs.length - shown.length
  const lang = persona.locale.toLowerCase().startsWith('en') ? null : persona.locale.split('-')[0]!.slice(0, 2).toUpperCase()
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': avatarLabel(persona) }

  return (
    <span
      {...a11y}
      className={`ci-pop relative inline-flex shrink-0 select-none items-center justify-center ${s.box} ${ACCENT_TONE[avatarAccent(persona.name)]} motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:-translate-y-px ${className}`}
      data-testid="persona-avatar"
    >
      <svg viewBox="0 0 64 64" width={s.px} height={s.px} aria-hidden="true" focusable="false" className="block">
        <text
          x="32"
          y={s.badges ? 35 : 33}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={initials.length > 1 ? 24 : 28}
          fontWeight={700}
          fill="currentColor"
          letterSpacing={initials.length > 1 ? -0.5 : 0}
        >
          {initials}
        </text>
        {s.badges && (
          <>
            {/* The device it holds, bottom right. */}
            <g transform="translate(50 50)">
              <circle r="11" className="fill-surface-raised" stroke="currentColor" strokeWidth="1.5" />
              <g transform="translate(-6 -6)" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <DeviceGlyph device={persona.device} />
              </g>
            </g>
            {/* What it needs, along the top. */}
            {shown.map((n, i) => (
              <g key={n} transform={`translate(${NEED_SLOTS[i]} 11)`}>
                <circle r="7.5" className="fill-surface-raised" stroke="currentColor" strokeWidth="1.2" />
                <g transform="translate(-5 -5)" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
                  <NeedGlyph need={n} />
                </g>
              </g>
            ))}
            {more > 0 && (
              <text x="12" y="12" textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight={700} fill="currentColor">
                +{more}
              </text>
            )}
            {/* The language it reads, bottom left, when not English. */}
            {lang && (
              <g transform="translate(3 45)">
                <rect width="24" height="15" rx="4" className="fill-surface-raised" stroke="currentColor" strokeWidth="1.2" />
                <text x="12" y="8" textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight={700} fill="currentColor" className="font-mono">
                  {lang}
                </text>
              </g>
            )}
          </>
        )}
      </svg>
    </span>
  )
}

/** The plain first-time visitor (no persona): a hollow figure in neutral ink. */
export function PlainVisitorAvatar({ size = 'sm' }: { size?: keyof typeof SIZE }) {
  const s = SIZE[size]
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${s.box} ${CHIP_TONE.neutral}`}>
      <svg viewBox="0 0 64 64" width={s.px} height={s.px} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="block">
        <circle cx="32" cy="24" r="9" />
        <path d="M16 50C18 40 25 36 32 36C39 36 46 40 48 50" />
      </svg>
    </span>
  )
}
