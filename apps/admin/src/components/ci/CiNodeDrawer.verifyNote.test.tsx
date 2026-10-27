/**
 * @vitest-environment jsdom
 *
 * /ci job drawer (Plan 024): a "Mushi verify" job says in one line that it
 * proves a fix; other jobs do not.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ciOverviewFixture, FIXTURE_JOBS } from './__fixtures__/ciOverview'
import { CiNodeDrawer } from './CiNodeDrawer'
import { MUSHI_VERIFY_JOB_NOTE } from '../../lib/verifyView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

async function open(nodeId: string) {
  const overview = ciOverviewFixture({
    jobs: [...FIXTURE_JOBS, { ...FIXTURE_JOBS[0]!, id: 'jv', jobName: 'verify', workflowName: 'Mushi verify' }],
  })
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CiNodeDrawer, { overview, nodeId, onClose: () => {} })))
  })
}

describe('CiNodeDrawer — Mushi verify job', () => {
  it('says the job proves a fix', async () => {
    await open('job:jv')
    expect(document.body.textContent).toContain(MUSHI_VERIFY_JOB_NOTE)
  })

  it('says nothing about it for other jobs', async () => {
    await open('job:j1')
    expect(document.body.textContent).toContain('build')
    expect(document.body.textContent).not.toContain(MUSHI_VERIFY_JOB_NOTE)
  })
})
