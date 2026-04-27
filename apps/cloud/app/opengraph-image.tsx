import { ImageResponse } from 'next/og'

export const alt = 'Mushi Mushi — bugs your users feel, walked into a fix'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#f8f4ed',
          color: '#0e0d0b',
          fontFamily: 'Georgia, serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              width: 72,
              height: 72,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              background: '#e03c2c',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 32,
            }}
          >
            虫
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 22, letterSpacing: 6, color: '#e03c2c' }}>
            MUSHI / LITTLE BUG HELPER
          </div>
        </div>
        <div style={{ fontSize: 96, lineHeight: 0.95, letterSpacing: -5, maxWidth: 900 }}>
          Bugs your users feel, walked into a fix.
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 22, color: '#5c5852' }}>
          Capture, classify, repair, verify, and learn from one clear trail.
        </div>
      </div>
    ),
    size,
  )
}
