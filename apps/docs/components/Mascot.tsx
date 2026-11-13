/**
 * <Mascot pose line /> — the field guide on a docs page.
 *
 * Kenji, a bug naturalist drawn in pen and watercolour (Mushi-chan the
 * ladybug rides along), stands beside one short first-person line where a
 * reader needs a guide: the quickstart, connecting an editor, a missing page.
 * The console uses the same character and voice (apps/admin/src/lib/fieldGuide.ts,
 * docs/mascot/README.md).
 *
 * - The image is decorative (empty alt, aria-hidden). The line is real text.
 * - `line` is a prop, not children, so the llms-full / llm-md mirrors keep
 *   only the page's own content (scripts/lib/strip-markup.mjs drops the tag).
 * - Static imports give hashed, basePath-aware URLs, so the long CDN cache
 *   never serves an old pose.
 * - CSS motion only (globals.css, "docs-guide"); still under reduced motion.
 * - At most one per page.
 */
import type { StaticImageData } from 'next/image'
import laptop from '../assets/mascot/mascot-laptop.webp'
import laptopSm from '../assets/mascot/mascot-laptop-sm.webp'
import think from '../assets/mascot/mascot-think.webp'
import thinkSm from '../assets/mascot/mascot-think-sm.webp'
import wave from '../assets/mascot/mascot-wave.webp'
import waveSm from '../assets/mascot/mascot-wave-sm.webp'

const POSES = {
  wave: { full: wave, small: waveSm },
  laptop: { full: laptop, small: laptopSm },
  think: { full: think, small: thinkSm },
} satisfies Record<string, { full: StaticImageData; small: StaticImageData }>

export function Mascot({ pose, line }: { pose: keyof typeof POSES; line: string }) {
  const art = POSES[pose]
  return (
    <div className="docs-guide" data-mascot-pose={pose}>
      <span className="docs-guide__figure" aria-hidden="true">
        <img
          src={art.full.src}
          srcSet={`${art.small.src} 300w, ${art.full.src} 600w`}
          sizes="112px"
          width={112}
          height={112}
          alt=""
          decoding="async"
          loading="lazy"
          draggable={false}
        />
      </span>
      <div className="docs-guide__body">
        <p className="docs-guide__name">Kenji</p>
        <p className="docs-guide__line">{line}</p>
      </div>
    </div>
  )
}
