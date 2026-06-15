/**
 * Lightweight canvas overlay for screenshot markup (highlight / blur / arrow).
 * Blur doubles as client-side PII redaction before upload.
 */

export type AnnotationTool = 'highlight' | 'blur' | 'arrow'

export interface AnnotationStroke {
  tool: AnnotationTool
  points: Array<{ x: number; y: number }>
  color?: string
}

export interface AnnotationSession {
  canvas: HTMLCanvasElement
  getDataUrl(): string
  setTool(tool: AnnotationTool): void
  destroy(): void
}

export function createScreenshotAnnotation(
  imageDataUrl: string,
  container: HTMLElement,
): Promise<AnnotationSession> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const wrap = document.createElement('div')
      wrap.style.position = 'relative'
      wrap.style.display = 'inline-block'
      wrap.style.maxWidth = '100%'

      const base = document.createElement('canvas')
      const overlay = document.createElement('canvas')
      const scale = Math.min(1, 720 / img.width)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      for (const c of [base, overlay]) {
        c.width = w
        c.height = h
        c.style.width = '100%'
        c.style.height = 'auto'
        c.style.display = 'block'
      }
      overlay.style.position = 'absolute'
      overlay.style.left = '0'
      overlay.style.top = '0'
      overlay.style.cursor = 'crosshair'

      const bctx = base.getContext('2d')
      const octx = overlay.getContext('2d')
      if (!bctx || !octx) {
        reject(new Error('Canvas not supported'))
        return
      }
      bctx.drawImage(img, 0, 0, w, h)

      wrap.appendChild(base)
      wrap.appendChild(overlay)
      container.appendChild(wrap)

      let tool: AnnotationTool = 'highlight'
      let drawing = false
      let start: { x: number; y: number } | null = null
      const strokes: AnnotationStroke[] = []

      const toLocal = (ev: MouseEvent | TouchEvent): { x: number; y: number } => {
        const rect = overlay.getBoundingClientRect()
        // On `touchend`, `ev.touches` is empty (the finger lifted) — the final
        // coordinates live in `changedTouches`. Reading `touches[0]` there
        // would land every stroke at (0,0) on touch devices.
        const touch = 'touches' in ev ? (ev.touches[0] ?? ev.changedTouches[0]) : null
        const clientX = touch ? touch.clientX : (ev as MouseEvent).clientX
        const clientY = touch ? touch.clientY : (ev as MouseEvent).clientY
        return {
          x: ((clientX - rect.left) / rect.width) * w,
          y: ((clientY - rect.top) / rect.height) * h,
        }
      }

      // Blur is baked destructively into `base` (see onUp) so the exported
      // pixels contain no original PII — keep only highlight/arrow on the
      // re-drawable overlay here.
      const redraw = () => {
        octx.clearRect(0, 0, w, h)
        for (const s of strokes) {
          if (s.tool === 'highlight' && s.points.length >= 2) {
            const [a, b] = s.points
            octx.fillStyle = 'rgba(255, 230, 0, 0.35)'
            octx.fillRect(
              Math.min(a.x, b.x),
              Math.min(a.y, b.y),
              Math.abs(b.x - a.x),
              Math.abs(b.y - a.y),
            )
          } else if (s.tool === 'arrow' && s.points.length >= 2) {
            const [a, b] = s.points
            octx.strokeStyle = '#ef4444'
            octx.lineWidth = 3
            octx.beginPath()
            octx.moveTo(a.x, a.y)
            octx.lineTo(b.x, b.y)
            octx.stroke()
          }
        }
      }

      const onDown = (ev: MouseEvent | TouchEvent) => {
        drawing = true
        start = toLocal(ev)
      }
      const onUp = (ev: MouseEvent | TouchEvent) => {
        if (!drawing || !start) return
        drawing = false
        const end = toLocal(ev)
        if (tool === 'blur') {
          // Redaction must be irreversible in the exported image: bake an
          // opaque blurred patch into the base canvas, overwriting the
          // original pixels (the overlay's feathered alpha would otherwise
          // leak the source pixels around the region's edge).
          const x = Math.min(start.x, end.x)
          const y = Math.min(start.y, end.y)
          const bw = Math.abs(end.x - start.x)
          const bh = Math.abs(end.y - start.y)
          if (bw >= 1 && bh >= 1) {
            bctx.filter = 'blur(8px)'
            bctx.drawImage(base, x, y, bw, bh, x, y, bw, bh)
            bctx.filter = 'none'
          }
        } else {
          strokes.push({ tool, points: [start, end] })
        }
        start = null
        redraw()
      }

      overlay.addEventListener('mousedown', onDown)
      overlay.addEventListener('mouseup', onUp)
      overlay.addEventListener('touchstart', onDown, { passive: true })
      overlay.addEventListener('touchend', onUp)

      resolve({
        canvas: base,
        setTool(t: AnnotationTool) {
          tool = t
        },
        getDataUrl() {
          const out = document.createElement('canvas')
          out.width = w
          out.height = h
          const ctx = out.getContext('2d')
          if (!ctx) return imageDataUrl
          ctx.drawImage(base, 0, 0)
          ctx.drawImage(overlay, 0, 0)
          return out.toDataURL('image/jpeg', 0.85)
        },
        destroy() {
          overlay.removeEventListener('mousedown', onDown)
          overlay.removeEventListener('mouseup', onUp)
          overlay.removeEventListener('touchstart', onDown)
          overlay.removeEventListener('touchend', onUp)
          wrap.remove()
        },
      })
    }
    img.onerror = () => reject(new Error('Failed to load screenshot'))
    img.src = imageDataUrl
  })
}
