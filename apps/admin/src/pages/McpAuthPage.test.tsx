/**
 * The MCP consent page offers one connection for all projects, a picked set,
 * or one project (ADR 0026), and posts the matching approve body.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('../lib/supabase', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }))

import { McpAuthPage } from './McpAuthPage'

const TXN = '2000000a-0000-4000-8000-000000000000'
const PROJECTS = [
  { id: 'p1', name: 'glot.it', can_manage: true, organization_role: 'owner' },
  { id: 'p2', name: 'yen-yen', can_manage: false, organization_role: 'member' },
]

let root: Root
let host: HTMLDivElement
const assign = vi.fn()

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  apiFetch.mockReset()
  assign.mockReset()
  Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true })
  apiFetch.mockImplementation(async (path: string, init?: { body?: string }) => {
    if (path.startsWith('/v1/mcp-oauth/request')) {
      return { ok: true, data: { status: 'pending', client_name: 'Claude Code', granted_key_scopes: ['report:write', 'mcp:read', 'mcp:write'], redirect_host: 'localhost:4567' } }
    }
    if (path === '/v1/admin/projects') return { ok: true, data: { projects: PROJECTS } }
    if (path === '/v1/mcp-oauth/approve') return { ok: true, data: { redirect_to: `http://localhost:4567/callback?code=x&body=${encodeURIComponent(init?.body ?? '')}` } }
    return { ok: false }
  })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [`/mcp-auth?txn=${TXN}`] }, createElement(McpAuthPage)))
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

const approveBody = () => JSON.parse(apiFetch.mock.calls.find(([p]) => p === '/v1/mcp-oauth/approve')![1].body as string)
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const radio = (value: string) => host.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`)!

describe('McpAuthPage', () => {
  it('offers all, picked and one-project access, defaulting to all projects', async () => {
    await render()
    expect(host.textContent).toContain('All my projects')
    expect(host.textContent).toContain('Only the projects I pick')
    expect(host.textContent).toContain('One project')
    expect(radio('account').checked).toBe(true)
    // An account key never ingests reports, so report:write is not offered.
    expect(host.textContent).not.toContain('report:write')
    expect(host.textContent).toContain('mcp-oauth-account')
  })

  it('loads projects from every team, not just the active one: an account key reaches them all', async () => {
    await render()
    expect(apiFetch).toHaveBeenCalledWith('/v1/admin/projects', { scope: 'none' })
  })

  it('approving all projects posts an account grant', async () => {
    await render()
    await act(async () => { button('Approve connection').click() })
    expect(approveBody()).toEqual({ txn: TXN, access: 'account' })
    expect(assign).toHaveBeenCalled()
  })

  it('picked projects need at least one tick and post their ids', async () => {
    await render()
    act(() => radio('selected').click())
    expect(button('Approve connection').disabled).toBe(true)
    const yenYen = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes('yen-yen') && l.querySelector('input[type=checkbox]'))!
    act(() => yenYen.querySelector('input')!.click())
    await act(async () => { button('Approve connection').click() })
    expect(approveBody()).toEqual({ txn: TXN, access: 'selected', project_ids: ['p2'] })
  })

  it('one project offers only projects the user manages', async () => {
    await render()
    act(() => radio('project').click())
    const options = [...host.querySelectorAll('select option')].map((o) => o.textContent)
    expect(options).toContain('glot.it')
    expect(options).not.toContain('yen-yen')
    await act(async () => { button('Approve connection').click() })
    expect(approveBody()).toEqual({ txn: TXN, access: 'project', project_id: 'p1' })
  })
})
