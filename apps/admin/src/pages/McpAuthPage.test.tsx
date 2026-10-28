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
const statusText = () => host.querySelector('[data-testid="mcp-auth-status"]')?.textContent ?? ''

async function renderAt(entry: string) {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(McpAuthPage)))
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('McpAuthPage — a request that is no longer pending', () => {
  async function renderWith(txn: Record<string, unknown>) {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/mcp-oauth/request')) return { ok: true, data: { client_name: 'Claude Code', granted_key_scopes: ['mcp:read'], redirect_host: 'localhost:4567', ...txn } }
      if (path === '/v1/admin/projects') return { ok: true, data: { projects: PROJECTS } }
      return { ok: false }
    })
    await render()
  }

  it('approved but never collected: explains the localhost hand-back instead of "already handled"', async () => {
    await renderWith({ status: 'approved', token_delivered: false })
    expect(host.textContent).toContain('has not picked it up')
    expect(host.textContent).not.toContain('already handled')
  })

  it('approved and collected: says the connection is complete', async () => {
    await renderWith({ status: 'approved', token_delivered: true })
    expect(host.textContent).toContain('Connection complete')
  })
})

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

describe('McpAuthPage status line', () => {
  it('asks to approve access while the request is waiting', async () => {
    await render()
    expect(host.querySelector('[data-page-posture]')).not.toBeNull()
    expect(statusText()).toContain('Approve access')
    expect(host.querySelector('h1')?.textContent).toContain('Connect an MCP client')
  })

  it('says to return to the MCP client after a safe approval', async () => {
    await render()
    await act(async () => { button('Approve connection').click() })
    expect(statusText()).toContain('Return to your MCP client')
    expect(host.querySelector('h1')?.textContent).toContain('Approved — returning to your MCP client')
  })

  it('keeps the consent form and shows retry guidance when the redirect is refused', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/mcp-oauth/request')) {
        return { ok: true, data: { status: 'pending', client_name: 'Claude Code', granted_key_scopes: ['mcp:read'], redirect_host: 'localhost:4567' } }
      }
      if (path === '/v1/admin/projects') return { ok: true, data: { projects: PROJECTS } }
      if (path === '/v1/mcp-oauth/approve') return { ok: true, data: { redirect_to: 'javascript:alert(1)' } }
      return { ok: false }
    })
    await render()
    await act(async () => { button('Approve connection').click() })
    expect(assign).not.toHaveBeenCalled()
    expect(button('Approve connection').textContent).toContain('Approve connection')
    expect(host.textContent).toContain("Couldn't approve connection")
    expect(statusText()).toContain('try again')
  })

  it('keeps the denied heading and points at a retry from the client', async () => {
    await render()
    await act(async () => { button('Deny').click() })
    expect(host.querySelector('h1')?.textContent).toContain('Access denied')
    expect(statusText()).toContain('retry')
  })

  it('keeps the failure heading and points at a restart when the request cannot load', async () => {
    await renderAt('/mcp-auth')
    expect(host.querySelector('h1')?.textContent).toContain("Can't complete this connection")
    expect(host.textContent).toContain('Connection failed')
    expect(statusText()).toContain('restart')
  })

  it('keeps the complete heading and says to return to the client', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/mcp-oauth/request')) {
        return { ok: true, data: { status: 'approved', token_delivered: true, client_name: 'Claude Code', granted_key_scopes: ['mcp:read'], redirect_host: 'localhost:4567' } }
      }
      if (path === '/v1/admin/projects') return { ok: true, data: { projects: PROJECTS } }
      return { ok: false }
    })
    await render()
    expect(host.querySelector('h1')?.textContent).toContain('Connection complete')
    expect(statusText()).toContain('Return to your MCP client')
  })
})
