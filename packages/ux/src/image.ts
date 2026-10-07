// SPDX-License-Identifier: MIT
/**
 * PNG helpers: decode, pad two captures to one size, pixel diff, and a
 * difference hash (dHash) for "is this the same screen" checks. No native
 * image library, so the package installs anywhere Node does.
 */

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

function decodePng(buf: Buffer): PNG {
  return PNG.sync.read(buf)
}

function encodePng(png: PNG): Buffer {
  return PNG.sync.write(png)
}

/** Copy `src` onto a white canvas of `width`×`height`. */
function padTo(src: PNG, width: number, height: number): PNG {
  if (src.width === width && src.height === height) return src
  const out = new PNG({ width, height })
  out.data.fill(255)
  PNG.bitblt(src, out, 0, 0, Math.min(src.width, width), Math.min(src.height, height), 0, 0)
  return out
}

export interface PixelDiff {
  /** Share of pixels that differ, 0..1, over the larger of the two sizes. */
  ratio: number
  changedPixels: number
  /**
   * Changed pixels over the "before" image's content pixels (those unlike
   * its background). A shifted paragraph on a mostly blank page is a small
   * share of the canvas but a large share of what is on it.
   */
  contentRatio: number
  width: number
  height: number
  /** Red-on-grey overlay of the changed pixels. */
  diffPng: Buffer
}

export function pixelDiff(before: Buffer, after: Buffer, threshold = 0.1): PixelDiff {
  const a = decodePng(before)
  const b = decodePng(after)
  const width = Math.max(a.width, b.width)
  const height = Math.max(a.height, b.height)
  const pa = padTo(a, width, height)
  const pb = padTo(b, width, height)
  const out = new PNG({ width, height })
  const changedPixels = pixelmatch(pa.data, pb.data, out.data, width, height, { threshold })
  const ink = contentPixels(a)
  return {
    ratio: changedPixels / (width * height),
    changedPixels,
    contentRatio: changedPixels / Math.max(ink, 1),
    width,
    height,
    diffPng: encodePng(out),
  }
}

/**
 * Keep the top `maxHeight` px of a capture. Full-page shots of long pages
 * would be downscaled by a vision model until text is unreadable; the top
 * of the page is what the judge can actually see.
 */
export function cropTop(buf: Buffer, maxHeight: number): Buffer {
  const src = decodePng(buf)
  if (src.height <= maxHeight) return buf
  const out = new PNG({ width: src.width, height: maxHeight })
  PNG.bitblt(src, out, 0, 0, src.width, maxHeight, 0, 0)
  return encodePng(out)
}

/** Pixels that differ visibly from the image's top-left (background) colour. */
function contentPixels(png: PNG): number {
  const [r0, g0, b0] = [png.data[0], png.data[1], png.data[2]]
  let n = 0
  for (let i = 0; i < png.data.length; i += 4) {
    if (Math.abs(png.data[i] - r0) + Math.abs(png.data[i + 1] - g0) + Math.abs(png.data[i + 2] - b0) > 24) n++
  }
  return n
}

/**
 * 64-bit difference hash: shrink to 9×8 greyscale by box averaging, then one
 * bit per "left pixel brighter than right". Near-identical screens land
 * within a few bits of each other. Returned as 16 hex chars.
 */
export function dHash(buf: Buffer): string {
  const png = decodePng(buf)
  const cols = 9
  const rows = 8
  const grey: number[] = []
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * png.height) / rows)
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * png.height) / rows))
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * png.width) / cols)
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * png.width) / cols))
      let sum = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * png.width + x) * 4
          sum += 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]
          n++
        }
      }
      grey.push(sum / n)
    }
  }
  let hex = ''
  for (let r = 0; r < rows; r++) {
    let byte = 0
    for (let c = 0; c < cols - 1; c++) {
      byte = (byte << 1) | (grey[r * cols + c] > grey[r * cols + c + 1] ? 1 : 0)
    }
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

export function hammingHex(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}
