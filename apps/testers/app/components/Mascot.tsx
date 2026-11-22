/**
 * FILE: apps/testers/app/components/Mascot.tsx
 * PURPOSE: The field guide on the Bounties pages: Kenji, a bug naturalist in
 *          pen and watercolour with Mushi-chan on his shoulder, beside one
 *          short first-person line. Same character and voice as the console
 *          (apps/admin/src/lib/fieldGuide.ts) and the docs; rules in
 *          docs/mascot/README.md.
 *
 *          - Decorative image (empty alt, aria-hidden); the line is real text.
 *          - Static imports give hashed, basePath-aware URLs.
 *          - CSS motion only (globals.css "testers-guide"); a still image
 *            under reduced motion. At most one per page.
 */
import type { StaticImageData } from 'next/image'
import point from '../assets/mascot/mascot-point.webp'
import pointSm from '../assets/mascot/mascot-point-sm.webp'
import wave from '../assets/mascot/mascot-wave.webp'
import waveSm from '../assets/mascot/mascot-wave-sm.webp'

const POSES = {
  wave: { full: wave, small: waveSm },
  point: { full: point, small: pointSm },
} satisfies Record<string, { full: StaticImageData; small: StaticImageData }>

interface MascotProps {
  pose: keyof typeof POSES
  line: string
  /** `stack`: figure above a centred line (page heads). `row`: beside it. */
  layout?: 'row' | 'stack'
}

export function Mascot({ pose, line, layout = 'row' }: MascotProps) {
  const art = POSES[pose]
  return (
    <div className={`testers-guide testers-guide--${layout}`} data-mascot-pose={pose}>
      <span className="testers-guide__figure" aria-hidden="true">
        <img
          src={art.full.src}
          srcSet={`${art.small.src} 300w, ${art.full.src} 600w`}
          sizes="112px"
          width={112}
          height={112}
          alt=""
          decoding="async"
          draggable={false}
        />
      </span>
      <div className="testers-guide__body">
        <p className="testers-guide__name">Kenji</p>
        <p className="testers-guide__line">{line}</p>
      </div>
    </div>
  )
}
