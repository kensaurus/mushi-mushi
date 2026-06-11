/**
 * Validate and normalize CLI credentials read from disk/env before they reach
 * outbound HTTP requests. Breaks CodeQL file→network taint and blocks CRLF /
 * header-injection in config values.
 */

import { assertEndpoint, normalizeEndpoint } from './endpoint.js'

const PROJECT_ID_RE =
  /^(?:proj_[A-Za-z0-9_-]{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const API_KEY_RE = /^mushi_[A-Za-z0-9_-]{10,}$/

export function sanitizeApiKey(raw: string): string {
  const key = raw.replace(/[\r\n\0]/g, '')
  if (!API_KEY_RE.test(key)) {
    throw new Error(
      'Invalid API key in config — run `mushi login --api-key <key>` to refresh credentials.',
    )
  }
  return key
}

export function sanitizeProjectId(raw: string): string {
  const id = raw.trim()
  if (!PROJECT_ID_RE.test(id)) {
    throw new Error(
      'Invalid project ID in config — expected a UUID or proj_* slug from the admin console.',
    )
  }
  return id
}

export function sanitizeEndpoint(raw: string): string {
  return assertEndpoint(normalizeEndpoint(raw))
}

export interface SanitizedCliCredentials {
  endpoint: string
  apiKey: string
  projectId: string
}

export function sanitizeCliCredentials(config: {
  endpoint?: string
  apiKey?: string
  projectId?: string
}): SanitizedCliCredentials {
  if (!config.endpoint || !config.apiKey || !config.projectId) {
    throw new Error('Missing endpoint, apiKey, or projectId')
  }
  return {
    endpoint: sanitizeEndpoint(config.endpoint),
    apiKey: sanitizeApiKey(config.apiKey),
    projectId: sanitizeProjectId(config.projectId),
  }
}

export function apiKeyHeaders(apiKey: string, projectId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'X-Mushi-Api-Key': apiKey,
  }
  if (projectId) headers['X-Mushi-Project'] = projectId
  return headers
}
