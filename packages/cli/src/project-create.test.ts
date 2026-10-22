/**
 * FILE: project-create.test.ts
 * PURPOSE: `mushi project create` file writes — `.env.local`, MCP merge, `saveConfig`.
 *
 * OVERVIEW:
 * - `persistProjectCreate` is the step the create command runs after sign-in.
 * - Tests use a temp directory so they never touch the real CLI config.
 *
 * DEPENDENCIES: vitest, node:fs/promises, ./commands/project.js
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { persistProjectCreate } from './commands/project.js'

const created = {
  endpoint: 'https://api.example.test',
  projectId: 'proj_1',
  apiKey: 'mushi_key_1',
  consoleUrl: 'https://console.example.test',
}

const ENV_KEYS = ['MUSHI_API_KEY', 'MUSHI_PROJECT_ID', 'MUSHI_API_ENDPOINT', 'MUSHI_ENDPOINT', 'MUSHI_CONSOLE_URL', 'MUSHI_PROFILE'] as const

describe('persistProjectCreate', () => {
  const dirs: string[] = []
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  async function tempDir(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'mushi-project-create-'))
    dirs.push(d)
    return d
  }

  it('creates .env.local, .cursor/mcp.json, and the CLI config', async () => {
    const cwd = await tempDir()
    const configPath = join(cwd, 'config.json')
    const res = await persistProjectCreate({ cwd, configPath, ...created })
    expect(res).toEqual({ envUpdated: false, mcpUpdated: false })

    const env = await readFile(join(cwd, '.env.local'), 'utf8')
    expect(env).toContain(`MUSHI_API_ENDPOINT=${created.endpoint}`)
    expect(env).toContain(`MUSHI_PROJECT_ID=${created.projectId}`)
    expect(env).toContain(`MUSHI_API_KEY=${created.apiKey}`)

    const mcp = JSON.parse(await readFile(join(cwd, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { env?: Record<string, string> }>
    }
    expect(mcp.mcpServers.mushi?.env?.MUSHI_PROJECT_ID).toBe(created.projectId)
    expect(mcp.mcpServers.mushi?.env?.MUSHI_API_ENDPOINT).toBe(created.endpoint)
    // The key stays in gitignored .env.local. Cursor reads ${env:MUSHI_API_KEY}.
    expect(mcp.mcpServers.mushi?.env?.MUSHI_API_KEY).toBe('${env:MUSHI_API_KEY}')
    expect(JSON.stringify(mcp)).not.toContain(created.apiKey)

    const saved = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    expect(saved).toMatchObject(created)
  })

  it('merges .env.local and mcp.json and keeps other saved config fields', async () => {
    const cwd = await tempDir()
    const configPath = join(cwd, 'config.json')
    await writeFile(
      configPath,
      JSON.stringify({ telemetryNoticeShown: true, clientId: 'cli_abc12345' }),
      'utf8',
    )
    await writeFile(
      join(cwd, '.env.local'),
      ['DATABASE_URL=postgres://x', '# Mushi MCP — old comment', 'MUSHI_API_KEY=old', 'STRIPE_SECRET_KEY=sk_test'].join('\n'),
      'utf8',
    )
    await mkdir(join(cwd, '.cursor'))
    await writeFile(
      join(cwd, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'echo' }, mushi: { command: 'old' } } }),
      'utf8',
    )

    const res = await persistProjectCreate({ cwd, configPath, ...created })
    expect(res).toEqual({ envUpdated: true, mcpUpdated: true })

    const env = await readFile(join(cwd, '.env.local'), 'utf8')
    expect(env).toContain('DATABASE_URL=postgres://x')
    expect(env).toContain('STRIPE_SECRET_KEY=sk_test')
    expect(env).not.toContain('MUSHI_API_KEY=old')
    expect(env).not.toContain('old comment')
    expect(env).toContain(`MUSHI_API_KEY=${created.apiKey}`)
    expect(env.match(/^# Mushi MCP/gm)).toHaveLength(1)

    const mcp = JSON.parse(await readFile(join(cwd, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command?: string; env?: Record<string, string> }>
    }
    expect(mcp.mcpServers.other?.command).toBe('echo')
    expect(mcp.mcpServers.mushi?.env?.MUSHI_PROJECT_ID).toBe(created.projectId)
    expect(mcp.mcpServers.mushi?.command).not.toBe('old')

    const saved = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    expect(saved).toMatchObject({ ...created, telemetryNoticeShown: true, clientId: 'cli_abc12345' })
  })

  it('is idempotent when the same project is written again', async () => {
    const cwd = await tempDir()
    const configPath = join(cwd, 'config.json')
    await persistProjectCreate({ cwd, configPath, ...created })
    const env1 = await readFile(join(cwd, '.env.local'), 'utf8')
    const mcp1 = await readFile(join(cwd, '.cursor', 'mcp.json'), 'utf8')
    const cfg1 = await readFile(configPath, 'utf8')

    const res = await persistProjectCreate({ cwd, configPath, ...created })
    expect(res).toEqual({ envUpdated: true, mcpUpdated: true })
    expect(await readFile(join(cwd, '.env.local'), 'utf8')).toBe(env1)
    expect(await readFile(join(cwd, '.cursor', 'mcp.json'), 'utf8')).toBe(mcp1)
    expect(await readFile(configPath, 'utf8')).toBe(cfg1)
  })
})
