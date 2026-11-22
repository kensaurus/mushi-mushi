import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { toPublicSupabaseUrl } from './public-url.ts'

const selfHost = { internal: 'http://api-gw:8000', public: 'https://mushi.example.com/' }

Deno.test('a signed Storage link built from the internal gateway opens on the public origin', () => {
  assertEquals(
    toPublicSupabaseUrl('http://api-gw:8000/storage/v1/object/sign/screenshots/a.png?token=t', selfHost),
    'https://mushi.example.com/storage/v1/object/sign/screenshots/a.png?token=t',
  )
  assertEquals(toPublicSupabaseUrl('http://api-gw:8000', selfHost), 'https://mushi.example.com')
})

Deno.test('hosted (no public URL, or the same one) and other hosts pass through unchanged', () => {
  const hosted = 'https://abc.supabase.co/storage/v1/object/sign/s/a.png?token=t'
  assertEquals(toPublicSupabaseUrl(hosted, { internal: 'https://abc.supabase.co', public: undefined }), hosted)
  assertEquals(toPublicSupabaseUrl(hosted, { internal: 'https://abc.supabase.co', public: 'https://abc.supabase.co' }), hosted)
  // A host that merely starts with the same characters is not the gateway.
  assertEquals(toPublicSupabaseUrl('http://api-gw:80001/x', selfHost), 'http://api-gw:80001/x')
  assertEquals(toPublicSupabaseUrl('https://cdn.example.com/a.png', selfHost), 'https://cdn.example.com/a.png')
  assertEquals(toPublicSupabaseUrl(null, selfHost), null)
  assertEquals(toPublicSupabaseUrl(undefined, selfHost), undefined)
})
