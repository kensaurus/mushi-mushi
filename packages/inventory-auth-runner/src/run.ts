#!/usr/bin/env node
/**
 * mushi-mushi-auth — CLI entrypoint for the scripted auth runner.
 *
 * Usage:
 *   $ MUSHI_API_KEY=… MUSHI_PROJECT=… \
 *     TEST_USER_EMAIL=qa@example.com TEST_USER_PASSWORD=… \
 *     npx mushi-mushi-auth refresh [--debug]
 */

import { refresh } from './index.ts'

const args = process.argv.slice(2)
const command = args[0] ?? 'refresh'
const debug = args.includes('--debug')

const apiKey = process.env.MUSHI_API_KEY
const projectId = process.env.MUSHI_PROJECT
const apiEndpoint =
  process.env.MUSHI_API_ENDPOINT ?? 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'

if (!apiKey || !projectId) {
  console.error(
    'mushi-mushi-auth: MUSHI_API_KEY and MUSHI_PROJECT must be set.\n' +
      'Get a project-scoped API key with the inventory:write scope from /settings/keys.',
  )
  process.exit(1)
}

if (command !== 'refresh') {
  console.error(`mushi-mushi-auth: unknown command '${command}' (only 'refresh' is supported)`)
  process.exit(1)
}

try {
  const result = await refresh({ apiEndpoint: apiEndpoint.replace(/\/$/, ''), apiKey, projectId, debug })
  console.log(`✓ Auth refreshed: cookie '${result.cookieName}' captured for domain '${result.domain}'.`)
} catch (err) {
  console.error('✗ Auth refresh failed:', err instanceof Error ? err.message : String(err))
  process.exit(2)
}
