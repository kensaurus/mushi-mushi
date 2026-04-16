import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from './db.ts'

export interface ProjectContext {
  projectId: string
  projectName: string
}

/**
 * Middleware: validate API key from X-Mushi-Api-Key header.
 * Sets projectId and projectName on the Hono context.
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const apiKey = c.req.header('X-Mushi-Api-Key') || c.req.header('X-Mushi-Project')

  if (!apiKey) {
    return c.json({ error: { code: 'MISSING_API_KEY', message: 'X-Mushi-Api-Key header required' } }, 401)
  }

  const db = getServiceClient()

  // Hash the key and look it up
  const encoder = new TextEncoder()
  const data = encoder.encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

  const { data: keyRow, error } = await db
    .from('project_api_keys')
    .select('project_id, is_active, projects!inner(name)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (error || !keyRow) {
    return c.json({ error: { code: 'INVALID_API_KEY', message: 'Invalid or revoked API key' } }, 401)
  }

  c.set('projectId', keyRow.project_id)
  c.set('projectName', (keyRow as any).projects?.name ?? 'Unknown')
  await next()
}

/**
 * Middleware: validate Supabase JWT for admin endpoints.
 * Requires authenticated user.
 */
export async function jwtAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: { code: 'MISSING_AUTH', message: 'Authorization Bearer token required' } }, 401)
  }

  const db = getServiceClient()
  const token = authHeader.replace('Bearer ', '')

  const { data: { user }, error } = await db.auth.getUser(token)

  if (error || !user) {
    return c.json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired auth token' } }, 401)
  }

  c.set('userId', user.id)
  c.set('userEmail', user.email)
  await next()
}
