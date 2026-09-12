/**
 * FILE: plugin-event-union.test.ts
 * PURPOSE: Keep the three plugin event lists from drifting again (exec plan
 *          rows 29–30): the server `MushiEventName` union in
 *          `_shared/plugins.ts`, the public union in
 *          `packages/plugin-sdk/src/types.ts`, and `KNOWN_EVENTS` in
 *          `packages/plugin-sdk/src/event-schema.ts`. Source-level like
 *          internal-auth-contract.test.ts — no Deno runtime needed.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverSrc = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/plugins.ts'), 'utf-8')
const sdkTypesSrc = readFileSync(resolve(__dirname, '../../../plugin-sdk/src/types.ts'), 'utf-8')
const sdkSchemaSrc = readFileSync(resolve(__dirname, '../../../plugin-sdk/src/event-schema.ts'), 'utf-8')

function unionMembers(src: string, typeName: string): string[] {
  const start = src.indexOf(`export type ${typeName} =`)
  expect(start).toBeGreaterThan(-1)
  const rest = src.slice(start)
  const end = rest.search(/\n\n/)
  const block = rest.slice(0, end === -1 ? undefined : end)
  return [...block.matchAll(/^\s*\|\s*'([a-z_.]+)'/gm)].map((m) => m[1])
}

function setMembers(src: string): string[] {
  const start = src.indexOf('KNOWN_EVENTS')
  const block = src.slice(start, src.indexOf('])', start))
  return [...block.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1])
}

const serverEvents = unionMembers(serverSrc, 'MushiEventName')
const sdkEvents = unionMembers(sdkTypesSrc, 'MushiEventName')
const knownEvents = setMembers(sdkSchemaSrc)

describe('plugin event union sync', () => {
  it('every server event is in the SDK union', () => {
    const missing = serverEvents.filter((e) => !sdkEvents.includes(e))
    expect(missing).toEqual([])
  })

  it('every server event is in KNOWN_EVENTS', () => {
    const missing = serverEvents.filter((e) => !knownEvents.includes(e))
    expect(missing).toEqual([])
  })

  it('every SDK union member is in KNOWN_EVENTS (isKnownEvent must agree with the type)', () => {
    const missing = sdkEvents.filter((e) => !knownEvents.includes(e))
    expect(missing).toEqual([])
  })

  it('the previously dead/skewed events are present everywhere', () => {
    for (const name of ['fix.requested', 'qa_story.failed', 'qa_story.recovered', 'linear.issue.updated']) {
      expect(serverEvents, name).toContain(name)
      expect(sdkEvents, name).toContain(name)
      expect(knownEvents, name).toContain(name)
    }
    // qa_story.passed stays public (SDK) even though the server does not emit it yet.
    expect(sdkEvents).toContain('qa_story.passed')
    expect(knownEvents).toContain('qa_story.passed')
  })

  it('webhooks-linear dispatches a typed event (no `as never`) and reward.* stay on the reward-webhooks channel', () => {
    const linearSrc = readFileSync(resolve(__dirname, '../../supabase/functions/webhooks-linear/index.ts'), 'utf-8')
    expect(linearSrc).toContain("'linear.issue.updated'")
    expect(linearSrc).not.toContain("'linear.issue.updated' as never")
    expect(serverSrc).toContain('reward-webhooks.ts')
    const questSrc = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/quest-tracker.ts'), 'utf-8')
    expect(questSrc).not.toContain("dispatchPluginEvent('reward.quest_completed')")
  })

  it('fix.requested has a producer now (fix-worker cloud branch) and the Cursor plugin guards on externalAgentId', () => {
    const workerSrc = readFileSync(resolve(__dirname, '../../supabase/functions/fix-worker/index.ts'), 'utf-8')
    expect(workerSrc).toContain("'fix.requested'")
    expect(serverSrc).toContain('fix.requested already dispatched by fix-worker')
    const pluginSrc = readFileSync(resolve(__dirname, '../../../plugin-cursor-cloud/src/index.ts'), 'utf-8')
    expect(pluginSrc).toContain('externalAgentId')
    expect(pluginSrc).toContain('/v1/agents')
    expect(pluginSrc).not.toContain('/v0/agents')
  })
})
