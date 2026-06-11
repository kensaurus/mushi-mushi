/**
 * FILE: apps/admin/src/components/flow-primitives/FlowCanvasBackground.tsx
 * PURPOSE: Shared React Flow grid background. Hero canvases use a single
 *          cross-hatch (readable, not noisy); pipeline canvases add a
 *          second dot layer for orientation when panning/zooming.
 */
import { Background, BackgroundVariant } from '@xyflow/react'

export type FlowCanvasDensity = 'hero' | 'pipeline'

interface FlowCanvasBackgroundProps {
  density?: FlowCanvasDensity
}

export function FlowCanvasBackground({ density = 'hero' }: FlowCanvasBackgroundProps) {
  if (density === 'hero') {
    return (
      <Background
        variant={BackgroundVariant.Cross}
        gap={24}
        size={1}
        color="var(--flow-grid-line)"
        style={{ opacity: 'var(--flow-grid-line-opacity)' }}
      />
    )
  }

  return (
    <>
      <Background
        variant={BackgroundVariant.Lines}
        gap={64}
        size={1}
        color="var(--flow-grid-major)"
        style={{ opacity: 'var(--flow-grid-major-opacity)' }}
      />
      <Background
        variant={BackgroundVariant.Dots}
        gap={16}
        size={1.5}
        color="var(--flow-grid-dot)"
        style={{ opacity: 'var(--flow-grid-dot-opacity)' }}
      />
    </>
  )
}
