/**
 * FILE: a2a-push-format.test.ts
 * PURPOSE: A2A 1.0 alignment (exec plan row 14 / C5):
 *          - POST /v1/a2a/tasks accepts `configuration.taskPushNotificationConfig`
 *            (1.0) with `authentication.scheme`, and still accepts the 0.3
 *            `configuration.pushNotificationConfig` + `authentication.schemes[]`;
 *          - a2a-push-notify sends a `StreamResponse { statusUpdate }` body
 *            with TASK_STATE_* names, `Content-Type: application/a2a+json`,
 *            `Authorization: {scheme} {credentials}` and the unchanged
 *            Standard Webhooks / X-Mushi-* headers.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/project-access.ts', () => ({ accessibleProjectIds: async () => [] }))

import { parsePushNotificationConfig } from '../../supabase/functions/_shared/a2a-push-config.ts'
import {
  A2A_PUSH_CONTENT_TYPE,
  STATUS_TO_TASK_STATE,
  authorizationHeaderFor,
  buildPushHeaders,
  buildStreamResponse,
  type FixDispatchRow,
} from '../../supabase/functions/a2a-push-notify/index.ts'

const URL_OK = 'https://hooks.example.com/a2a'

describe('parsePushNotificationConfig — 1.0 with 0.3 alias', () => {
  it('reads configuration.taskPushNotificationConfig with authentication.scheme (singular)', () => {
    const res = parsePushNotificationConfig({
      taskPushNotificationConfig: { id: 'cfg-1', url: URL_OK, authentication: { scheme: 'Bearer', credentials: 'tok' } },
    })
    expect(res).toEqual({
      ok: true,
      deprecatedAlias: false,
      config: { url: URL_OK, id: 'cfg-1', authentication: { scheme: 'Bearer', credentials: 'tok' } },
    })
  })

  it('still accepts the deprecated configuration.pushNotificationConfig with authentication.schemes[]', () => {
    const res = parsePushNotificationConfig({
      pushNotificationConfig: { url: URL_OK, token: 'legacy-token', authentication: { schemes: ['ApiKey', 'Bearer'], credentials: 'k' } },
    })
    expect(res).toEqual({
      ok: true,
      deprecatedAlias: true,
      config: { url: URL_OK, token: 'legacy-token', authentication: { scheme: 'ApiKey', credentials: 'k' } },
    })
  })

  it('prefers the 1.0 key when both are present', () => {
    const res = parsePushNotificationConfig({
      taskPushNotificationConfig: { url: URL_OK },
      pushNotificationConfig: { url: 'https://old.example.com/' },
    })
    expect(res).toMatchObject({ ok: true, deprecatedAlias: false, config: { url: URL_OK } })
  })

  it('returns config null when nothing is configured', () => {
    expect(parsePushNotificationConfig(undefined)).toEqual({ ok: true, config: null, deprecatedAlias: false })
    expect(parsePushNotificationConfig({})).toEqual({ ok: true, config: null, deprecatedAlias: false })
  })

  it('rejects http URLs, oversize tokens and authentication without a scheme', () => {
    expect(parsePushNotificationConfig({ taskPushNotificationConfig: { url: 'http://hooks.example.com' } })).toMatchObject({ ok: false, code: 'INVALID_PUSH_URL' })
    expect(parsePushNotificationConfig({ taskPushNotificationConfig: { url: URL_OK, token: 'x'.repeat(5000) } })).toMatchObject({ ok: false, code: 'INVALID_PUSH_TOKEN' })
    expect(parsePushNotificationConfig({ taskPushNotificationConfig: { url: URL_OK, authentication: { credentials: 'c' } } })).toMatchObject({ ok: false, code: 'INVALID_PUSH_AUTH' })
    expect(parsePushNotificationConfig({ taskPushNotificationConfig: { url: URL_OK, authentication: { scheme: 'not a scheme!' } } })).toMatchObject({ ok: false, code: 'INVALID_PUSH_AUTH' })
  })
})

function row(overrides: Partial<FixDispatchRow> = {}): FixDispatchRow {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    project_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    report_id: '0f7f2b1a-1111-4222-8333-444455556666',
    status: 'completed',
    skill: 'dispatch_fix',
    fix_attempt_id: 'fa-1',
    pr_url: 'https://github.com/o/r/pull/3',
    error: null,
    created_at: '2026-09-12T00:00:00Z',
    started_at: '2026-09-12T00:00:05Z',
    finished_at: '2026-09-12T00:03:00Z',
    inventory_action_node_id: null,
    push_notification_config: { url: URL_OK },
    ...overrides,
  }
}

describe('buildStreamResponse — A2A 1.0 push body', () => {
  it('wraps a TaskStatusUpdateEvent as the single StreamResponse member', () => {
    const body = buildStreamResponse(row())
    expect(Object.keys(body)).toEqual(['statusUpdate'])
    const su = body.statusUpdate as Record<string, unknown>
    expect(su).toMatchObject({
      taskId: '11111111-2222-4333-8444-555555555555',
      contextId: '0f7f2b1a-1111-4222-8333-444455556666',
      final: true,
      status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-09-12T00:03:00Z' },
      metadata: { prUrl: 'https://github.com/o/r/pull/3', fixAttemptId: 'fa-1', mushiStatus: 'completed' },
    })
    const message = (su.status as { message: { role: string; parts: Array<{ text: string }> } }).message
    expect(message.role).toBe('ROLE_AGENT')
    expect(message.parts[0].text).toContain('https://github.com/o/r/pull/3')
  })

  it('maps every fix_dispatch_jobs status onto a TASK_STATE_* name and marks non-terminal states final=false', () => {
    expect(STATUS_TO_TASK_STATE).toMatchObject({
      queued: 'TASK_STATE_SUBMITTED',
      running: 'TASK_STATE_WORKING',
      completed: 'TASK_STATE_COMPLETED',
      completed_no_pr: 'TASK_STATE_COMPLETED',
      failed: 'TASK_STATE_FAILED',
      cancelled: 'TASK_STATE_CANCELED',
    })
    const working = buildStreamResponse(row({ status: 'running', pr_url: null, finished_at: null })).statusUpdate as Record<string, unknown>
    expect(working).toMatchObject({ final: false, status: { state: 'TASK_STATE_WORKING', timestamp: '2026-09-12T00:00:05Z' } })
    const failed = buildStreamResponse(row({ status: 'failed', pr_url: null, error: 'boom' })).statusUpdate as Record<string, unknown>
    expect(failed).toMatchObject({ final: true, status: { state: 'TASK_STATE_FAILED' } })
    expect((failed.status as { message: { parts: Array<{ text: string }> } }).message.parts[0].text).toContain('boom')
  })
})

describe('buildPushHeaders / authorizationHeaderFor', () => {
  it('sends application/a2a+json, the 1.0 Authorization scheme, and keeps Standard Webhooks + X-Mushi-* headers', async () => {
    const headers = await buildPushHeaders({
      config: { url: URL_OK, authentication: { scheme: 'ApiKey', credentials: 'k-123' } },
      projectId: 'p-1',
      legacyState: 'completed',
      deliveryId: 'del-1',
      stdTimestamp: '1757635200',
      rawBody: '{"statusUpdate":{}}',
      signingSecret: 'secret',
    })
    expect(headers['Content-Type']).toBe(A2A_PUSH_CONTENT_TYPE)
    expect(A2A_PUSH_CONTENT_TYPE).toBe('application/a2a+json')
    expect(headers['A2A-Version']).toBe('1.0')
    expect(headers.Authorization).toBe('ApiKey k-123')
    expect(headers['webhook-id']).toBe('del-1')
    expect(headers['webhook-timestamp']).toBe('1757635200')
    expect(headers['webhook-signature']).toMatch(/^v1,[A-Za-z0-9+/=]+$/)
    expect(headers['X-Mushi-Event']).toBe('a2a.task.completed')
    expect(headers['X-Mushi-Project']).toBe('p-1')
    expect(headers['X-Mushi-Delivery']).toBe('del-1')
  })

  it('falls back to Bearer <token> for 0.3 configs and omits Authorization when nothing is configured', async () => {
    expect(authorizationHeaderFor({ url: URL_OK, token: 'legacy' })).toBe('Bearer legacy')
    expect(authorizationHeaderFor({ url: URL_OK, authentication: { scheme: 'Bearer' }, token: 'legacy' })).toBe('Bearer legacy')
    expect(authorizationHeaderFor({ url: URL_OK })).toBeNull()
    const headers = await buildPushHeaders({
      config: { url: URL_OK },
      projectId: 'p-1',
      legacyState: 'working',
      deliveryId: 'del-2',
      stdTimestamp: '1',
      rawBody: '{}',
      signingSecret: null,
    })
    expect(headers).not.toHaveProperty('Authorization')
    expect(headers).not.toHaveProperty('webhook-signature')
  })
})
