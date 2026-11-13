/**
 * FILE: apps/admin/src/components/mascot/Mascot.tsx
 * PURPOSE: The field guide: Kenji, a bug naturalist drawn in pen and
 *          watercolour, with Mushi-chan the ladybug as his companion. He
 *          stands beside one short first-person line at a journey state
 *          (first run, diagnosing, diagnosis ready, all clear, errors).
 *
 *          - Pose and line come from `lib/fieldGuide.ts`; spread a GuideLine
 *            straight in: `<Mascot {...firstDiagnosisGuide(state)} />`.
 *          - The image is decorative (empty alt, hidden from assistive tech).
 *            The line is real text, read in place.
 *          - Motion is CSS only (components.css, "MASCOT"): a short entrance
 *            and an idle sway that stops after three cycles. Under reduced
 *            motion it is a still image. No framer-motion, so the crash
 *            fallback can render it safely.
 *          - If the image fails to load, the figure is dropped and the line
 *            stays, so an error screen never shows a broken image.
 *          - At most one Mascot per screen (docs/mascot/README.md).
 *
 *          Art: fal nano-banana 2.1 + birefnet cut-outs, reviewed 2026-11-13
 *          (pipeline in glot.it scripts/kensaurus-mascot/). Never ship this in
 *          the SDK widget or the "powered by" footer: customers' apps are not
 *          our canvas.
 */

import { useState } from 'react'
import type { MascotPose } from '../../lib/fieldGuide'
import allclear from '../../assets/mascot/mascot-allclear.webp'
import allclearSm from '../../assets/mascot/mascot-allclear-sm.webp'
import found from '../../assets/mascot/mascot-found.webp'
import foundSm from '../../assets/mascot/mascot-found-sm.webp'
import laptop from '../../assets/mascot/mascot-laptop.webp'
import laptopSm from '../../assets/mascot/mascot-laptop-sm.webp'
import magnify from '../../assets/mascot/mascot-magnify.webp'
import magnifySm from '../../assets/mascot/mascot-magnify-sm.webp'
import oops from '../../assets/mascot/mascot-oops.webp'
import oopsSm from '../../assets/mascot/mascot-oops-sm.webp'
import point from '../../assets/mascot/mascot-point.webp'
import pointSm from '../../assets/mascot/mascot-point-sm.webp'
import think from '../../assets/mascot/mascot-think.webp'
import thinkSm from '../../assets/mascot/mascot-think-sm.webp'
import wave from '../../assets/mascot/mascot-wave.webp'
import waveSm from '../../assets/mascot/mascot-wave-sm.webp'

/** 600 px and 300 px renders of each pose; both square, feet on one baseline. */
const POSE_ART: Record<MascotPose, { full: string; small: string }> = {
  wave: { full: wave, small: waveSm },
  point: { full: point, small: pointSm },
  magnify: { full: magnify, small: magnifySm },
  found: { full: found, small: foundSm },
  think: { full: think, small: thinkSm },
  allclear: { full: allclear, small: allclearSm },
  oops: { full: oops, small: oopsSm },
  laptop: { full: laptop, small: laptopSm },
}

type MascotSize = 'sm' | 'md' | 'lg'

const SIZE: Record<MascotSize, { box: string; px: number }> = {
  sm: { box: 'size-16', px: 64 },
  md: { box: 'size-24', px: 96 },
  lg: { box: 'size-36', px: 144 },
}

interface MascotProps {
  pose: MascotPose
  /** One first-person line, at most 90 characters (lib/fieldGuide.ts). */
  line?: string
  size?: MascotSize
  /**
   * `console`: the operator theme. A paper spot sits behind the figure so the
   * watercolour reads on both the light and the dark console.
   * `paper`: an editorial (washi) surface that is already paper, such as the
   * 404 and crash screens; no spot, editorial ink for the line.
   */
  surface?: 'console' | 'paper'
  /** `row`: figure beside the line. `stack`: figure above a centred line. */
  layout?: 'row' | 'stack'
  className?: string
  'data-testid'?: string
}

export function Mascot({
  pose,
  line,
  size = 'md',
  surface = 'console',
  layout = 'row',
  className = '',
  'data-testid': testId,
}: MascotProps) {
  const [broken, setBroken] = useState(false)
  const art = POSE_ART[pose]
  const { box, px } = SIZE[size]
  const paper = surface === 'paper'
  const stack = layout === 'stack'

  return (
    <div
      className={`flex ${stack ? 'flex-col items-center text-center' : 'items-end'} gap-3 ${className}`}
      data-mascot-pose={pose}
      data-testid={testId}
    >
      {!broken && (
        // `key` replays the entrance when the pose changes (diagnosing → found).
        <span key={pose} aria-hidden="true" className={`mushi-mascot-figure relative shrink-0 ${box}`}>
          {!paper && (
            <span className="absolute bottom-0 left-1/2 aspect-square w-5/6 -translate-x-1/2 rounded-full bg-editorial-paper ring-1 ring-editorial-rule/60" />
          )}
          <img
            src={px > 100 ? art.full : art.small}
            srcSet={`${art.small} 300w, ${art.full} 600w`}
            sizes={`${px}px`}
            width={px}
            height={px}
            alt=""
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            className="relative h-full w-full select-none object-contain"
          />
        </span>
      )}
      {line && (
        <div
          className={`min-w-0 ${stack ? 'max-w-xs' : `max-w-prose border-l-2 pl-3 ${paper ? 'border-editorial-vermillion' : 'border-brand/50'}`} ${stack ? '' : 'pb-1'}`}
        >
          <p
            className={`text-2xs font-semibold uppercase tracking-wider ${paper ? 'text-editorial-ink-faint' : 'text-fg-faint'}`}
          >
            Kenji
          </p>
          <p
            className={`mt-0.5 text-sm leading-snug text-pretty ${paper ? 'text-editorial-ink-muted' : 'text-fg-secondary'}`}
          >
            {line}
          </p>
        </div>
      )}
    </div>
  )
}
