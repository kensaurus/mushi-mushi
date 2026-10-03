/**
 * FILE: packages/server/supabase/functions/_shared/read-body-capped.ts
 * PURPOSE: Read at most `limit` bytes of a request body, counting the bytes
 *          that actually arrive. Returns null when the body is larger.
 *          Content-Length alone is not a cap: a chunked request omits it.
 *          Used by the event ingest and the bill import.
 */

export async function readBodyCapped(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
