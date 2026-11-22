/**
 * @vitest-environment jsdom
 *
 * /ci timeline (2026-11-22): the machines running a job now sit first and are tinted; they
 * also get a "Running now (N)" label above them and a divider before the rest, so the group
 * reads by its words, never by colour alone.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { CiJob } from '../../lib/ciTypes'
import { CiTimeline, leadingLiveLaneCount } from './CiTimeline'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

function job(id: number, runner: string, live: boolean): CiJob {
  return {
    id: String(id),
    projectId: 'p1',
    repo: 'acme/app',
    runId: id,
    jobId: id,
    workflowName: 'CI',
    jobName: `job-${id}`,
    headBranch: 'main',
    prNumber: null,
    status: live ? 'in_progress' : 'completed',
    conclusion: live ? null : 'success',
    ciKind: live ? 'running' : 'passed',
    infra: false,
    infraDetail: null,
    runnerName: runner,
    runnerKind: 'self_hosted',
    labels: ['self-hosted'],
    queueSeconds: 5,
    durationSeconds: live ? null : 300,
    createdAt: minsAgo(30),
    startedAt: minsAgo(29),
    completedAt: live ? null : minsAgo(24),
    htmlUrl: null,
    memPeakMb: null,
  } as CiJob
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(jobs: CiJob[]) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(createElement(CiTimeline, { jobs })))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('leadingLiveLaneCount', () => {
  const lane = (outcomes: string[], unassigned = false) => ({ unassigned, bars: outcomes.map((outcome) => ({ outcome })) })
  it('counts the live lanes at the top and stops at the first lane that is not live', () => {
    expect(leadingLiveLaneCount([lane(['running']), lane(['waiting', 'passed']), lane(['passed']), lane(['running'])])).toBe(2)
    expect(leadingLiveLaneCount([lane(['passed']), lane(['running'])])).toBe(0)
    // "No runner yet" is never part of the live group, even with a waiting job.
    expect(leadingLiveLaneCount([lane(['waiting'], true)])).toBe(0)
  })
})

describe('CiTimeline running-now group', () => {
  it('labels the live machines "Running now (N)" and puts a divider before the rest', () => {
    // Several jobs per machine so none fold into the quiet row.
    const el = render([
      job(1, 'nuc-a', true),
      job(2, 'nuc-a', false),
      job(3, 'nuc-b', true),
      job(4, 'nuc-b', false),
      job(5, 'nuc-c', false),
      job(6, 'nuc-c', false),
    ])
    const label = el.querySelector('[data-testid="ci-timeline-live-label"]')
    expect(label?.textContent).toBe('Running now (2)')
    const items = Array.from(el.querySelectorAll('ul[aria-label="Jobs per runner"] > li'))
    const ids = items.map((li) => li.getAttribute('data-testid'))
    expect(ids).toEqual([
      'ci-timeline-live-label',
      'ci-timeline-lane-nuc-a',
      'ci-timeline-lane-nuc-b',
      'ci-timeline-live-divider',
      'ci-timeline-lane-nuc-c',
    ])
  })

  it('shows no label and no divider when nothing runs', () => {
    const el = render([job(1, 'nuc-a', false), job(2, 'nuc-a', false), job(3, 'nuc-b', false), job(4, 'nuc-b', false)])
    expect(el.querySelector('[data-testid="ci-timeline-live-label"]')).toBeNull()
    expect(el.querySelector('[data-testid="ci-timeline-live-divider"]')).toBeNull()
  })

  it('draws no divider when every lane is live', () => {
    const el = render([job(1, 'nuc-a', true), job(2, 'nuc-a', false), job(3, 'nuc-b', true), job(4, 'nuc-b', false)])
    expect(el.querySelector('[data-testid="ci-timeline-live-label"]')?.textContent).toBe('Running now (2)')
    expect(el.querySelector('[data-testid="ci-timeline-live-divider"]')).toBeNull()
  })
})
