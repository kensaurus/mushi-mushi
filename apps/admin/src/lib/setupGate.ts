/**
 * FILE: apps/admin/src/lib/setupGate.ts
 * PURPOSE: What the setup screen (pages/SetupGatePage.tsx) tells a self-hoster
 *          whose console has no backend address: connect this browser now
 *          (kept in localStorage), or bake the address into the console the
 *          way it is served. A static build and a Docker image read the values
 *          at BUILD time (Vite inlines VITE_*), so restarting a server never
 *          helps; only the dev server reads apps/admin/.env on restart.
 */

import { isValidBackendUrl } from './env'

export type ConsoleHosting = 'static' | 'docker' | 'compose' | 'dev'

export const CONSOLE_HOSTING_OPTIONS: ReadonlyArray<{ id: ConsoleHosting; label: string }> = [
  { id: 'static', label: 'Static build' },
  { id: 'docker', label: 'Docker image' },
  { id: 'compose', label: 'Docker Compose' },
  { id: 'dev', label: 'Dev server' },
]

export interface BackendValues {
  supabaseUrl: string
  anonKey: string
}

const PLACEHOLDER: BackendValues = { supabaseUrl: 'https://<your-ref>.supabase.co', anonKey: '<anon key>' }

/** The copyable block for one way of serving the console, plus the one line that says when it applies. */
export function consoleConfigBlock(hosting: ConsoleHosting, values?: Partial<BackendValues>): { when: string; code: string } {
  const url = values?.supabaseUrl?.trim().replace(/\/+$/, '') || PLACEHOLDER.supabaseUrl
  const key = values?.anonKey?.trim() || PLACEHOLDER.anonKey
  const api = `${url}/functions/v1/api`
  switch (hosting) {
    case 'static':
      return {
        when: 'Rebuild, then upload apps/admin/dist again. The values are baked in at build time.',
        code: [
          `VITE_SUPABASE_URL=${url} \\`,
          `VITE_SUPABASE_ANON_KEY=${key} \\`,
          `VITE_API_URL=${api} \\`,
          'VITE_INSTANCE_TYPE=self-hosted \\',
          'pnpm --filter "@mushi-mushi/admin..." build',
        ].join('\n'),
      }
    case 'docker':
      return {
        when: 'Build your own image with the values; the published image asks here instead.',
        code: [
          'docker build -f deploy/Dockerfile.admin \\',
          `  --build-arg VITE_SUPABASE_URL=${url} \\`,
          `  --build-arg VITE_SUPABASE_ANON_KEY=${key} \\`,
          `  --build-arg VITE_API_URL=${api} \\`,
          '  --build-arg VITE_INSTANCE_TYPE=self-hosted \\',
          '  -t mushi-admin . && docker run -p 3000:3000 mushi-admin',
        ].join('\n'),
      }
    case 'compose':
      return {
        when: 'Compose builds the console from deploy/.env (MUSHI_PUBLIC_URL, SUPABASE_ANON_KEY). Rebuild after changing them.',
        code: 'docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build admin',
      }
    case 'dev':
      return {
        when: 'Put these in apps/admin/.env, then restart pnpm dev.',
        code: [`VITE_SUPABASE_URL=${url}`, `VITE_SUPABASE_ANON_KEY=${key}`, 'VITE_INSTANCE_TYPE=self-hosted'].join('\n'),
      }
  }
}

/** Field errors for "Connect this browser"; empty when the values can be saved. */
export function backendFormErrors(values: BackendValues): Partial<Record<keyof BackendValues, string>> {
  const errors: Partial<Record<keyof BackendValues, string>> = {}
  if (!isValidBackendUrl(values.supabaseUrl)) {
    errors.supabaseUrl = 'Enter the project URL, e.g. https://<ref>.supabase.co or http://localhost for Compose.'
  }
  const key = values.anonKey.trim()
  if (!key) errors.anonKey = 'Paste the anon (public) key.'
  else if (key.split('.').length !== 3 && !key.startsWith('sb_publishable_')) {
    errors.anonKey = 'That does not look like an anon key (a JWT starting eyJ…, or sb_publishable_…).'
  }
  return errors
}
