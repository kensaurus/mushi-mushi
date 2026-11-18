/**
 * The workflow parse cache (2026-11-18): /v1/admin/ci/overview parsed every workflow two or
 * three times per request and hit the edge CPU limit (546). One parse per text per isolate.
 */
import { describe, expect, it } from 'vitest'
import { parseWorkflowYaml, workflowYamlCacheSize } from '../../supabase/functions/_shared/workflow-yaml'

describe('parseWorkflowYaml', () => {
  it('parses a workflow once and hands back the same value for the same text', () => {
    const text = 'name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n'
    const a = parseWorkflowYaml(text) as { jobs: { build: { 'runs-on': string } } }
    const b = parseWorkflowYaml(text)
    expect(a.jobs.build['runs-on']).toBe('ubuntu-latest')
    expect(b).toBe(a)
  })

  it('treats edited text as a new workflow', () => {
    const a = parseWorkflowYaml('on: push\njobs: {}\n') as { on: string }
    const b = parseWorkflowYaml('on: pull_request\njobs: {}\n') as { on: string }
    expect(a.on).toBe('push')
    expect(b.on).toBe('pull_request')
  })

  it('rethrows a parse error every time, so callers keep their try/catch', () => {
    const bad = 'jobs:\n  a: [unclosed\n'
    expect(() => parseWorkflowYaml(bad)).toThrow()
    expect(() => parseWorkflowYaml(bad)).toThrow()
  })

  it('keeps at most 400 workflows per isolate', () => {
    for (let i = 0; i < 450; i++) parseWorkflowYaml(`name: w${i}\njobs: {}\n`)
    expect(workflowYamlCacheSize()).toBeLessThanOrEqual(400)
  })
})
