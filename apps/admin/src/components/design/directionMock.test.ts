/**
 * FILE: apps/admin/src/components/design/directionMock.test.ts
 * PURPOSE: directionAssetUrl only ever yields an https URL on the api's own
 *          origin and path (http on a loopback host for local development),
 *          whatever the asset path or the stored api base says.
 */
import { describe, expect, it } from 'vitest'
import { directionAssetUrl } from './directionMock'

const API = 'https://abc.supabase.co/functions/v1/api'
const ASSET = '/v1/design-assets/1000000a-0000-4000-8000-000000000000?path=assets%2Ficon.png&exp=1&sig=ab'
const PAGE = 'https://kensaur.us'

describe('directionAssetUrl', () => {
  it('joins a signed asset path to the api base, keeping the base path and the encoded query', () => {
    expect(directionAssetUrl(ASSET, API, PAGE)).toBe(`${API}${ASSET}`)
  })

  it('allows http only on a loopback host, as in local development behind the dev proxy', () => {
    expect(directionAssetUrl(ASSET, '/functions/v1/api', 'http://localhost:5173')).toBe(`http://localhost:5173/functions/v1/api${ASSET}`)
    expect(directionAssetUrl(ASSET, 'http://127.0.0.1:54321/functions/v1/api', PAGE)).toBe(`http://127.0.0.1:54321/functions/v1/api${ASSET}`)
    expect(directionAssetUrl(ASSET, 'http://abc.example/functions/v1/api', PAGE)).toBeNull()
    expect(directionAssetUrl(ASSET, '/functions/v1/api', 'http://evil.example')).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['protocol-relative', '//evil.example/x.png'],
    ['backslash host', '/\\evil.example/x.png'],
    ['absolute foreign URL', 'https://evil.example/x.png'],
    ['dot segments out of the api path', '/../../../evil.png'],
  ])('refuses a hostile asset path: %s', (_name, url) => {
    expect(directionAssetUrl(url, API, PAGE)).toBeNull()
  })

  it.each([
    ['javascript:', 'javascript:alert(1)//'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD4='],
    ['vbscript:', 'vbscript:msgbox(1)//'],
    ['plain http to a remote host', 'http://evil.example/functions/v1/api'],
    ['credentials in the base', 'https://abc.supabase.co@evil.example'],
  ])('refuses a hostile api base: %s', (_name, base) => {
    expect(directionAssetUrl(ASSET, base, PAGE)).toBeNull()
  })

  it('never returns anything but an https or loopback http URL', () => {
    const bases = [API, '', 'javascript:x', 'data:x', 'ftp://h/a', 'https://h/a', 'http://localhost/a']
    const paths = [ASSET, '/x', '/a b', '/<img>', '/"onerror="x']
    for (const base of bases) {
      for (const p of paths) {
        const src = directionAssetUrl(p, base, PAGE)
        if (src) expect(src.startsWith('https://') || src.startsWith('http://localhost')).toBe(true)
      }
    }
  })
})
