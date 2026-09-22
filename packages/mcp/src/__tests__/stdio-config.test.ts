/**
 * FILE: packages/mcp/src/__tests__/stdio-config.test.ts
 * PURPOSE: A client that does not expand variables hands the stdio server the
 *          literal text `${MUSHI_API_KEY}`. That string used to be sent to the
 *          API as the key; it now counts as unset, and the setup-mode report
 *          says the client did not expand it and how to fix the client config.
 */

import { describe, expect, it } from 'vitest'
import {
  isUnexpandedPlaceholder,
  missingApiKeyReport,
  resolveStdioCredentials,
  type CliConfigSnapshot,
} from '../stdio-config.js'

const DEFAULT_ENDPOINT = 'https://default.example/functions/v1/api'
const NO_CLI: CliConfigSnapshot = { path: '/home/u/.config/mushi/config.json', found: false }
const CLI_WITH_KEY: CliConfigSnapshot = {
  path: '/home/u/.config/mushi/config.json',
  found: true,
  apiKey: 'mushi_fromcli',
  projectId: '11111111-1111-4111-8111-111111111111',
}

describe('isUnexpandedPlaceholder', () => {
  it.each(['${MUSHI_API_KEY}', '${env:MUSHI_API_KEY}', '$MUSHI_API_KEY', '${input:mushi-api-key}', '${MUSHI_API_KEY:-}', '%MUSHI_API_KEY%', '{{MUSHI_API_KEY}}', '  ${MUSHI_API_KEY}  '])(
    'flags %s',
    (value) => expect(isUnexpandedPlaceholder(value)).toBe(true),
  )

  it.each(['mushi_0123456789abcdef', '11111111-1111-4111-8111-111111111111', 'https://x.supabase.co/functions/v1/api', ''])(
    'accepts the real value %s',
    (value) => expect(isUnexpandedPlaceholder(value)).toBe(false),
  )
})

describe('resolveStdioCredentials', () => {
  it('never uses an unexpanded ${MUSHI_API_KEY} as the key', () => {
    const r = resolveStdioCredentials({ MUSHI_API_KEY: '${MUSHI_API_KEY}' }, NO_CLI, DEFAULT_ENDPOINT)
    expect(r.apiKey).toBe('')
    expect(r.apiKeySource).toBe('')
    expect(r.placeholders).toEqual([{ name: 'MUSHI_API_KEY', value: '${MUSHI_API_KEY}' }])
  })

  it('falls through a placeholder to the CLI config key, like an empty value', () => {
    const r = resolveStdioCredentials({ MUSHI_API_KEY: '${env:MUSHI_API_KEY}' }, CLI_WITH_KEY, DEFAULT_ENDPOINT)
    expect(r.apiKey).toBe('mushi_fromcli')
    expect(r.apiKeySource).toBe('cli-config')
    expect(r.placeholders.map((p) => p.name)).toEqual(['MUSHI_API_KEY'])
  })

  it('treats placeholder project ids and endpoints as unset too', () => {
    const r = resolveStdioCredentials(
      { MUSHI_API_KEY: 'mushi_real', MUSHI_PROJECT_ID: '$MUSHI_PROJECT_ID', MUSHI_API_ENDPOINT: '${MUSHI_API_ENDPOINT}' },
      NO_CLI,
      DEFAULT_ENDPOINT,
    )
    expect(r).toMatchObject({ apiKey: 'mushi_real', apiKeySource: 'env', projectId: '', endpoint: DEFAULT_ENDPOINT })
    expect(r.placeholders.map((p) => p.name)).toEqual(['MUSHI_PROJECT_ID', 'MUSHI_API_ENDPOINT'])
  })

  it('keeps the existing precedence for real values: env beats CLI config beats default', () => {
    const r = resolveStdioCredentials(
      { MUSHI_API_KEY: ' mushi_env ', MUSHI_API_ENDPOINT: 'https://self.host/functions/v1/api' },
      { ...CLI_WITH_KEY, endpoint: 'https://cli.host/functions/v1/api' },
      DEFAULT_ENDPOINT,
    )
    expect(r).toMatchObject({
      apiKey: 'mushi_env',
      apiKeySource: 'env',
      projectId: CLI_WITH_KEY.projectId,
      endpoint: 'https://self.host/functions/v1/api',
      placeholders: [],
    })
    // `${MUSHI_API_KEY:-}` expanded by the client to '' still falls through.
    expect(resolveStdioCredentials({ MUSHI_API_KEY: '' }, CLI_WITH_KEY, DEFAULT_ENDPOINT).apiKey).toBe('mushi_fromcli')
  })
})

describe('missingApiKeyReport', () => {
  it('says the client did not expand the variable and names the client-side fixes', () => {
    const env = { MUSHI_API_KEY: '${MUSHI_API_KEY}' }
    const report = missingApiKeyReport({ env, cli: NO_CLI, resolved: resolveStdioCredentials(env, NO_CLI, DEFAULT_ENDPOINT) })
    expect(report).toContain('env MUSHI_API_KEY        → set to the unexpanded placeholder ${MUSHI_API_KEY}')
    expect(report).toContain('did not expand the variable reference')
    expect(report).toMatch(/Claude Desktop does not expand variables/)
    expect(report).toMatch(/\$\{env:MUSHI_API_KEY\}/)
    expect(report).toMatch(/serving setup mode/)
  })

  it('keeps the plain missing-key report free of placeholder advice', () => {
    const report = missingApiKeyReport({ env: {}, cli: NO_CLI, resolved: resolveStdioCredentials({}, NO_CLI, DEFAULT_ENDPOINT) })
    expect(report).toContain('env MUSHI_API_KEY        → not set')
    expect(report).toContain(NO_CLI.path)
    expect(report).not.toContain('did not expand')
    expect(report).toContain(`MUSHI_API_ENDPOINT  unset → ${DEFAULT_ENDPOINT}`)
  })
})
