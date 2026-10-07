// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { dHash, hammingHex, pixelDiff } from './image.js'

const encodePng = (png: PNG): Buffer => PNG.sync.write(png)

function solid(width: number, height: number, paint: (x: number, y: number) => number): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = paint(x, y)
      png.data[i] = v
      png.data[i + 1] = v
      png.data[i + 2] = v
      png.data[i + 3] = 255
    }
  }
  return encodePng(png)
}

describe('pixelDiff', () => {
  it('is zero for identical images', () => {
    const a = solid(40, 30, (x) => x * 6)
    expect(pixelDiff(a, a).ratio).toBe(0)
  })

  it('counts changed pixels and pads mismatched sizes', () => {
    const a = solid(40, 30, () => 255)
    const b = solid(40, 40, (_x, y) => (y < 30 ? 255 : 0))
    const d = pixelDiff(a, b)
    expect(d.width).toBe(40)
    expect(d.height).toBe(40)
    // a is padded white, so only b's black bottom band differs.
    expect(d.changedPixels).toBe(40 * 10)
  })
})

describe('dHash', () => {
  it('puts near-identical screens within a few bits and different ones far apart', () => {
    const gradient = solid(180, 160, (x) => Math.round((x / 180) * 255))
    const nudged = solid(180, 160, (x, y) => (x === 5 && y === 5 ? 0 : Math.round((x / 180) * 255)))
    const reversed = solid(180, 160, (x) => 255 - Math.round((x / 180) * 255))
    expect(dHash(gradient)).toHaveLength(16)
    expect(hammingHex(dHash(gradient), dHash(nudged))).toBeLessThanOrEqual(2)
    expect(hammingHex(dHash(gradient), dHash(reversed))).toBeGreaterThan(40)
  })
})
