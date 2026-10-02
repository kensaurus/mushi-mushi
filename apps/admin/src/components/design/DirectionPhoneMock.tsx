/**
 * FILE: apps/admin/src/components/design/DirectionPhoneMock.tsx
 * PURPOSE: One key lesson screen, drawn only from a direction's tokens, so
 *          directions can be compared on the same moment: HUD (44 px exit,
 *          progress strip, streak), the prompt word, a short question, a 2×2
 *          choice grid (first choice marked correct), a feedback line and
 *          exactly ONE filled full-width call to action.
 *
 *          It is a picture, not UI: the whole frame is role="img" with a label,
 *          and nothing inside is focusable or clickable. Every colour, radius
 *          and family comes from `resolveDirectionRoles` (token data or a CSS
 *          keyword default). The frame is `w-full max-w-75`, i.e.
 *          min(300px, 100%), so it never forces a horizontal scroll.
 */

import type { CSSProperties } from 'react'
import { mockChoices, type DirectionRoles } from './directionMock'

const PROGRESS = ['done', 'done', 'done', 'now', 'todo', 'todo', 'todo', 'todo'] as const

interface DirectionPhoneMockProps {
  label: string
  roles: DirectionRoles
  word: string
  sample: string
}

export function DirectionPhoneMock({ label, roles, word, sample }: DirectionPhoneMockProps) {
  const r = roles.radiusPx
  const choices = mockChoices(word, sample)
  const screen: CSSProperties = { background: roles.canvas, color: roles.text, fontFamily: roles.fontBody }
  const choice: CSSProperties = {
    background: roles.choiceBg,
    color: roles.choiceFg,
    borderRadius: r,
    border: `2px solid ${roles.line}`,
  }

  return (
    <figure
      role="img"
      aria-label={`Preview: a lesson screen in ${label}`}
      data-testid="phone-mock"
      className="mx-auto my-3 w-full max-w-75 rounded-3xl border-8 border-fg bg-fg"
    >
      <div aria-hidden="true" className="flex h-155 flex-col overflow-hidden rounded-2xl" style={screen}>
        {/* HUD */}
        <div className="flex h-13 shrink-0 items-center gap-2 px-2">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center text-lg"
            style={{ color: roles.text }}
            data-mock="exit"
          >
            ✕
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1">
            {PROGRESS.map((p, i) => (
              <span
                key={i}
                className="h-2.5 min-w-0 flex-1"
                style={{
                  borderRadius: Math.min(r, 4),
                  border: `${p === 'now' ? 2 : 1}px solid ${p === 'now' ? roles.action : roles.line}`,
                  background: p === 'done' ? roles.text : 'transparent',
                }}
              />
            ))}
          </span>
          <span
            className="flex h-8 min-w-11 shrink-0 items-center justify-center px-1 text-sm font-bold"
            style={{ background: roles.reward, color: roles.canvas, borderRadius: Math.min(r, 8), fontFamily: roles.fontLabel }}
          >
            3
          </span>
        </div>

        {/* Stage */}
        <div className="flex min-h-0 flex-1 flex-col px-3.5 pt-1.5">
          <div className="flex flex-col items-center gap-2 py-3">
            <span
              className="flex h-14 w-14 items-center justify-center text-lg"
              style={{ background: roles.choiceBg, color: roles.choiceFg, borderRadius: '50%' }}
            >
              ▶
            </span>
            <span
              className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ fontFamily: roles.fontDisplay, fontSize: 52, lineHeight: 1.45 }}
              data-mock="word"
            >
              {word}
            </span>
          </div>
          <p className="mb-2 text-center text-sm" style={{ color: roles.textMuted }}>
            Which one did you hear?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {choices.map((c, i) => (
              <span
                key={`${c}-${i}`}
                className="flex min-h-14 items-center justify-center overflow-hidden px-1 text-center"
                style={{
                  ...choice,
                  fontFamily: roles.fontDisplay,
                  fontSize: 20,
                  outline: i === 0 ? `4px solid ${roles.reward}` : undefined,
                  outlineOffset: i === 0 ? -4 : undefined,
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Feedback */}
        <p
          className="mx-3.5 mb-2 mt-2.5 px-3 py-2.5 text-sm"
          style={{
            background: roles.raised,
            color: roles.textOnRaised,
            borderLeft: `4px solid ${roles.reward}`,
            borderRadius: Math.min(r, 10),
          }}
        >
          <b>✓ Correct.</b> {word}
        </p>

        {/* The one filled CTA */}
        <div className="shrink-0 px-3.5 pb-4">
          <span
            data-mock="cta"
            className="flex min-h-14 w-full items-center justify-center font-bold"
            style={{ background: roles.action, color: roles.onAction, borderRadius: r, fontFamily: roles.fontBody, fontSize: 17 }}
          >
            Continue
          </span>
        </div>
      </div>
    </figure>
  )
}
