#!/usr/bin/env node
/**
 * Wave G3 — `mushi-plugin` dev CLI.
 *
 * Three subcommands:
 *   mushi-plugin simulate <event-name>
 *       POST a signed sample envelope to http://localhost:3000/webhook to
 *       exercise a plugin end-to-end without depending on the live Mushi
 *       cluster.
 *   mushi-plugin sign <file>
 *       Print the X-Mushi-Signature header for a raw JSON file given the
 *       MUSHI_PLUGIN_SECRET env var. Lets plugin devs construct curl
 *       requests manually.
 *   mushi-plugin verify
 *       Pipe a raw body on stdin plus X-Mushi-Signature via env var;
 *       exits 0 if valid, 1 otherwise. Useful in CI contract tests.
 */

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { verifySignature } from './sign.js'
import type { MushiEventEnvelope, MushiEventName } from './types.js'

const SAMPLE_ENVELOPES: Record<MushiEventName, MushiEventEnvelope> = {
  'report.created': { event: 'report.created', deliveryId: 'dev-0001', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'pending', category: 'bug', severity: 'high', title: 'Login button does nothing on /signin' } } },
  'report.classified': { event: 'report.classified', deliveryId: 'dev-0002', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'classified' }, classification: { category: 'bug', severity: 'high', confidence: 0.92, tags: ['auth', 'regression'] } } },
  'report.status_changed': { event: 'report.status_changed', deliveryId: 'dev-0003', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'fixed' }, previousStatus: 'fixing', newStatus: 'fixed', actorUserId: 'u_dev' } },
  'report.commented': { event: 'report.commented', deliveryId: 'dev-0004', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'classified' }, comment: { id: 'c_dev_001', authorUserId: 'u_dev', body: 'repro on Firefox too', visibleToReporter: true } } },
  'report.dedup_grouped': { event: 'report.dedup_grouped', deliveryId: 'dev-0005', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_002', status: 'grouped' }, groupId: 'g_dev_001', peers: 3 } },
  'fix.proposed': { event: 'fix.proposed', deliveryId: 'dev-0006', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'fixing' }, fix: { id: 'f_dev_001', status: 'proposed', branch: 'mushi/fix/r_dev_001', summary: 'null-check on auth callback' } } },
  'fix.applied': { event: 'fix.applied', deliveryId: 'dev-0007', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'fixed' }, fix: { id: 'f_dev_001', status: 'applied', branch: 'mushi/fix/r_dev_001', pullRequestUrl: 'https://github.com/example/app/pull/42', summary: 'null-check on auth callback' } } },
  'fix.failed': { event: 'fix.failed', deliveryId: 'dev-0008', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'classified' }, fix: { id: 'f_dev_001', status: 'failed', summary: 'validateResult rejected diff: tests still failing' } } },
  'judge.score_recorded': { event: 'judge.score_recorded', deliveryId: 'dev-0009', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'classified' }, judge: { score: 0.81, rationale: 'category accurate; severity under-called', promptVersion: 'stage2-v12' } } },
  'sla.breached': { event: 'sla.breached', deliveryId: 'dev-0010', occurredAt: new Date().toISOString(), projectId: 'dev-project', pluginSlug: 'dev-plugin', data: { report: { id: 'r_dev_001', status: 'classified' }, sla: { severity: 'critical', targetSeconds: 900, elapsedSeconds: 1420 } } },
}

function sign(rawBody: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(rawBody).digest('hex')
  const ts = Math.floor(Date.now() / 1000)
  return `t=${ts},v1=${sig}`
}

async function simulate(eventName: string): Promise<void> {
  const target = process.env.MUSHI_PLUGIN_URL ?? 'http://localhost:3000/webhook'
  const secret = process.env.MUSHI_PLUGIN_SECRET
  if (!secret) {
    console.error('MUSHI_PLUGIN_SECRET not set')
    process.exit(1)
  }
  const sample = SAMPLE_ENVELOPES[eventName as MushiEventName]
  if (!sample) {
    console.error(`Unknown event "${eventName}". Known: ${Object.keys(SAMPLE_ENVELOPES).join(', ')}`)
    process.exit(1)
  }
  const raw = JSON.stringify(sample)
  const res = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mushi-Signature': sign(raw, secret) },
    body: raw,
  })
  console.log(`→ ${target}`)
  console.log(`← ${res.status} ${await res.text()}`)
  process.exit(res.ok ? 0 : 1)
}

function signFile(path: string): void {
  const secret = process.env.MUSHI_PLUGIN_SECRET
  if (!secret) {
    console.error('MUSHI_PLUGIN_SECRET not set')
    process.exit(1)
  }
  const raw = readFileSync(path, 'utf8')
  console.log(sign(raw, secret))
}

async function verify(): Promise<void> {
  const secret = process.env.MUSHI_PLUGIN_SECRET
  const sigHeader = process.env.MUSHI_SIGNATURE
  if (!secret || !sigHeader) {
    console.error('MUSHI_PLUGIN_SECRET and MUSHI_SIGNATURE are required')
    process.exit(2)
  }
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  const rawBody = Buffer.concat(chunks).toString('utf8')
  const result = verifySignature({ rawBody, header: sigHeader, secret })
  if (result.ok) { console.log('ok'); process.exit(0) }
  console.error(`invalid: ${result.reason}`)
  process.exit(1)
}

const [, , cmd, ...args] = process.argv
switch (cmd) {
  case 'simulate': void simulate(args[0] ?? 'report.created'); break
  case 'sign': signFile(args[0] ?? '/dev/stdin'); break
  case 'verify': void verify(); break
  default:
    console.log('usage: mushi-plugin <simulate|sign|verify> [args]')
    process.exit(1)
}
