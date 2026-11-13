/**
 * FILE: cloudwatch-ingest.ts
 * PURPOSE: Turn CloudWatch alarm state changes (delivered by SNS to
 *          webhooks-cloudwatch, ADR 0061) into Mushi reports.
 *
 * One report per alarm per project, tracked in `cloudwatch_alarms`
 * (project_id, alarm_key). The same rules as the Sentry ingest
 * (`sentry-ingest.ts`):
 *   - ALARM with no open report files one; ALARM while the report is open
 *     dedupes (counts the episode, files nothing), so a flapping alarm never
 *     spams the queue;
 *   - ALARM after the report was fixed, resolved, verified or dismissed
 *     reopens it and bumps `regression_count`;
 *   - OK annotates the report (state, time, count) and leaves it for a person.
 *     An alarm that clears says the symptom went quiet, not that anyone fixed
 *     the cause: the same reading as Sentry's auto-resolve by age and the
 *     site watch's "its report is left for the user" (ADR 0024);
 *   - INSUFFICIENT_DATA only records the state.
 * SNS delivers at least once and in no set order, so a transition whose
 * StateChangeTime is not newer than the last one applied is dropped as stale.
 *
 * A message on the topic that is not a CloudWatch alarm (a budget notice, a
 * plain-text test publish) is not an alarm: `parseCloudWatchAlarm` returns
 * null and the route answers 200 "ignored".
 *
 * Pure apart from the injected db; vitest runs the flow on a stub.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface CloudWatchAlarm {
  AlarmName: string;
  NewStateValue: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
  AlarmDescription?: string | null;
  AlarmArn?: string;
  AWSAccountId?: string;
  NewStateReason?: string;
  StateChangeTime?: string;
  Region?: string;
  OldStateValue?: string;
  Trigger?: {
    MetricName?: string;
    Namespace?: string;
    Statistic?: string;
    Dimensions?: Array<{ value?: string; name?: string }>;
    Period?: number;
    EvaluationPeriods?: number;
    DatapointsToAlarm?: number;
    ComparisonOperator?: string;
    Threshold?: number;
  };
}

const STATES: ReadonlySet<string> = new Set(['ALARM', 'OK', 'INSUFFICIENT_DATA']);

/** The alarm in an SNS Notification's Message, or null when the message is not a CloudWatch alarm. */
export function parseCloudWatchAlarm(message: string): CloudWatchAlarm | null {
  let o: unknown;
  try {
    o = JSON.parse(message);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const a = o as Record<string, unknown>;
  if (typeof a.AlarmName !== 'string' || !a.AlarmName.trim()) return null;
  if (typeof a.NewStateValue !== 'string' || !STATES.has(a.NewStateValue)) return null;
  return a as unknown as CloudWatchAlarm;
}

/** The dedupe key: the alarm ARN when given, else account + name. */
export function alarmKey(alarm: CloudWatchAlarm): string {
  if (typeof alarm.AlarmArn === 'string' && alarm.AlarmArn.startsWith('arn:aws:cloudwatch:')) return alarm.AlarmArn.slice(0, 500);
  return `${alarm.AWSAccountId ?? 'unknown'}:${alarm.AlarmName}`.slice(0, 500);
}

/** Region code (us-east-1) from the alarm ARN, else null. */
export function alarmRegion(alarm: CloudWatchAlarm): string | null {
  const m = /^arn:aws:cloudwatch:([a-z0-9-]+):/.exec(alarm.AlarmArn ?? '');
  return m ? m[1] : null;
}

function stateChangeMs(alarm: CloudWatchAlarm, fallbackMs: number): number {
  // CloudWatch sends "2026-11-13T10:00:00.000+0000"; Date.parse wants "+00:00".
  const raw = (alarm.StateChangeTime ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : fallbackMs;
}

function metricLine(alarm: CloudWatchAlarm): string | null {
  const t = alarm.Trigger;
  if (!t?.MetricName) return null;
  const dims = (t.Dimensions ?? []).map((d) => `${d.name}=${d.value}`).join(', ');
  const window =
    t.EvaluationPeriods && t.Period
      ? ` (${t.DatapointsToAlarm ?? t.EvaluationPeriods} of ${t.EvaluationPeriods} × ${t.Period} s)`
      : '';
  return `${t.Namespace ? `${t.Namespace}/` : ''}${t.MetricName}${dims ? ` [${dims}]` : ''} ${t.Statistic ?? ''} ${t.ComparisonOperator ?? ''} ${t.Threshold ?? ''}${window}`
    .replace(/\s+/g, ' ')
    .trim();
}

function consoleUrl(alarm: CloudWatchAlarm): string | null {
  const region = alarmRegion(alarm);
  if (!region) return null;
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(alarm.AlarmName)}`;
}

/** The report an alarm that just went into ALARM becomes. */
export function buildCloudWatchReport(projectId: string, alarm: CloudWatchAlarm, topicArn: string, now: Date): Record<string, unknown> {
  const nowIso = now.toISOString();
  const metric = metricLine(alarm);
  const link = consoleUrl(alarm);
  const description = [
    `CloudWatch alarm ${alarm.AlarmName} went into ALARM${alarm.OldStateValue ? ` (was ${alarm.OldStateValue})` : ''}.`,
    alarm.AlarmDescription ? `What it watches: ${alarm.AlarmDescription}` : null,
    alarm.NewStateReason ? `Why: ${alarm.NewStateReason}` : null,
    metric ? `Metric: ${metric}` : null,
    alarm.StateChangeTime ? `Changed at: ${alarm.StateChangeTime}` : null,
    link ? `Alarm: ${link}` : null,
    'Filed by Mushi from an AWS CloudWatch alarm (SNS). No user reported this. When the alarm returns to OK the report is annotated, not closed: close it once the cause is understood.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    title: `AWS alarm: ${alarm.AlarmName} is in ALARM`.slice(0, 200),
    description,
    category: 'bug',
    severity: 'high',
    status: 'new',
    source: 'cloudwatch',
    reporter_token_hash: 'cloudwatch-webhook',
    environment: {
      userAgent: 'cloudwatch-webhook',
      platform: 'aws',
      language: '',
      url: link ?? '',
      referrer: '',
      timestamp: nowIso,
      timezone: 'UTC',
    },
    custom_metadata: {
      source: 'cloudwatch_webhook',
      alarmName: alarm.AlarmName,
      alarmArn: alarm.AlarmArn ?? null,
      alarmKey: alarmKey(alarm),
      accountId: alarm.AWSAccountId ?? null,
      region: alarmRegion(alarm),
      topicArn,
      metric,
      cloudwatch: { state: 'ALARM', lastAlarmAt: alarm.StateChangeTime ?? nowIso, alarmCount: 1, okCount: 0 },
    },
    created_at: nowIso,
  };
}

export type CloudWatchOutcome = 'created' | 'deduped' | 'reopened' | 'annotated' | 'recorded' | 'stale';

export interface CloudWatchIngestResult {
  outcome: CloudWatchOutcome;
  reportId?: string | null;
}

interface AlarmRow {
  id: string;
  report_id: string | null;
  state: string | null;
  state_changed_at: string | null;
  alarm_count: number | null;
  ok_count: number | null;
}

const DONE_STATUSES: ReadonlySet<string> = new Set(['fixed', 'resolved', 'verified', 'dismissed']);

async function readAlarmRow(db: SupabaseClient, projectId: string, key: string): Promise<AlarmRow | null> {
  const { data, error } = await db
    .from('cloudwatch_alarms')
    .select('id, report_id, state, state_changed_at, alarm_count, ok_count')
    .eq('project_id', projectId)
    .eq('alarm_key', key)
    .maybeSingle();
  if (error) throw new Error(`cloudwatch_alarms read failed: ${error.message}`);
  return (data as AlarmRow | null) ?? null;
}

async function readReport(db: SupabaseClient, reportId: string): Promise<{ status: string; regression_count: number; custom_metadata: Record<string, unknown> | null } | null> {
  const { data, error } = await db.from('reports').select('status, regression_count, custom_metadata').eq('id', reportId).maybeSingle();
  if (error) throw new Error(`reports read failed: ${error.message}`);
  if (!data) return null;
  const r = data as { status?: string; regression_count?: number; custom_metadata?: Record<string, unknown> | null };
  return { status: r.status ?? 'new', regression_count: r.regression_count ?? 0, custom_metadata: r.custom_metadata ?? null };
}

/** Merge the alarm's live state into the report's custom_metadata.cloudwatch. */
function withAlarmState(meta: Record<string, unknown> | null, patch: Record<string, unknown>): Record<string, unknown> {
  const base = meta && typeof meta === 'object' ? meta : {};
  const prev = base.cloudwatch && typeof base.cloudwatch === 'object' ? (base.cloudwatch as Record<string, unknown>) : {};
  return { ...base, cloudwatch: { ...prev, ...patch } };
}

export interface CloudWatchIngestInput {
  projectId: string;
  alarm: CloudWatchAlarm;
  topicArn: string;
  messageId: string;
  now: Date;
  /** Queue classification for a newly filed report (injected, so this module stays testable). */
  classify: (reportId: string, projectId: string) => Promise<void> | void;
}

export async function ingestCloudWatchAlarm(db: SupabaseClient, input: CloudWatchIngestInput): Promise<CloudWatchIngestResult> {
  const { projectId, alarm, now } = input;
  const key = alarmKey(alarm);
  const nowIso = now.toISOString();
  const changedMs = stateChangeMs(alarm, now.getTime());
  const changedIso = new Date(changedMs).toISOString();
  const state = alarm.NewStateValue;

  const row = await readAlarmRow(db, projectId, key);
  if (row?.state_changed_at && Date.parse(row.state_changed_at) >= changedMs) {
    return { outcome: 'stale', reportId: row.report_id };
  }

  const rowPatch: Record<string, unknown> = {
    alarm_name: alarm.AlarmName.slice(0, 255),
    alarm_arn: alarm.AlarmArn?.slice(0, 500) ?? null,
    state,
    state_changed_at: changedIso,
    last_message_id: input.messageId.slice(0, 200),
    last_reason: alarm.NewStateReason?.slice(0, 1000) ?? null,
    updated_at: nowIso,
  };
  if (state === 'ALARM') {
    rowPatch.alarm_count = (row?.alarm_count ?? 0) + 1;
    rowPatch.last_alarm_at = changedIso;
  } else if (state === 'OK') {
    rowPatch.ok_count = (row?.ok_count ?? 0) + 1;
    rowPatch.last_ok_at = changedIso;
  }

  /** Apply rowPatch only if no newer transition landed meanwhile. */
  const updateRow = async (extra: Record<string, unknown> = {}) => {
    if (!row) return;
    let q = db.from('cloudwatch_alarms').update({ ...rowPatch, ...extra }).eq('id', row.id);
    q = row.state_changed_at ? q.eq('state_changed_at', row.state_changed_at) : q.is('state_changed_at', null);
    const { error } = await q;
    if (error) throw new Error(`cloudwatch_alarms update failed: ${error.message}`);
  };

  if (state !== 'ALARM') {
    if (!row) {
      const { error } = await db.from('cloudwatch_alarms').insert({ project_id: projectId, alarm_key: key, ...rowPatch });
      // A concurrent delivery created the row first: it holds the newer state or the same one.
      if (error && error.code !== '23505') throw new Error(`cloudwatch_alarms insert failed: ${error.message}`);
      return { outcome: 'recorded', reportId: null };
    }
    await updateRow();
    if (state === 'OK' && row.report_id) {
      const report = await readReport(db, row.report_id);
      if (report) {
        const { error } = await db
          .from('reports')
          .update({
            custom_metadata: withAlarmState(report.custom_metadata, { state: 'OK', lastOkAt: changedIso, okCount: rowPatch.ok_count }),
          })
          .eq('id', row.report_id);
        if (error) throw new Error(`reports annotate failed: ${error.message}`);
        return { outcome: 'annotated', reportId: row.report_id };
      }
    }
    return { outcome: 'recorded', reportId: row.report_id };
  }

  // ── ALARM ────────────────────────────────────────────────────────────────
  if (row?.report_id) {
    const report = await readReport(db, row.report_id);
    if (report) {
      const alarmState = { state: 'ALARM', lastAlarmAt: changedIso, alarmCount: rowPatch.alarm_count };
      if (DONE_STATUSES.has(report.status)) {
        const { error } = await db
          .from('reports')
          .update({
            status: 'reopened',
            reopened_at: nowIso,
            regressed_at: nowIso,
            regression_count: report.regression_count + 1,
            custom_metadata: withAlarmState(report.custom_metadata, alarmState),
          })
          .eq('id', row.report_id);
        if (error) throw new Error(`reports reopen failed: ${error.message}`);
        await updateRow();
        return { outcome: 'reopened', reportId: row.report_id };
      }
      const { error } = await db
        .from('reports')
        .update({ custom_metadata: withAlarmState(report.custom_metadata, alarmState) })
        .eq('id', row.report_id);
      if (error) throw new Error(`reports annotate failed: ${error.message}`);
      await updateRow();
      return { outcome: 'deduped', reportId: row.report_id };
    }
    // The linked report was deleted: file a new one below.
  }

  const report = buildCloudWatchReport(projectId, alarm, input.topicArn, now);
  const reportId = report.id as string;
  const { error: insertError } = await db.from('reports').insert(report);
  if (insertError) throw new Error(`cloudwatch report insert failed: ${insertError.message}`);

  // Link before classification so a racing delivery dedupes against it.
  let linked = false;
  if (!row) {
    const { error } = await db.from('cloudwatch_alarms').insert({ project_id: projectId, alarm_key: key, report_id: reportId, ...rowPatch });
    if (!error) linked = true;
    else if (error.code !== '23505') {
      await db.from('reports').delete().eq('id', reportId);
      throw new Error(`cloudwatch_alarms insert failed: ${error.message}`);
    }
  } else {
    let q = db
      .from('cloudwatch_alarms')
      .update({ ...rowPatch, report_id: reportId })
      .eq('id', row.id);
    q = row.report_id ? q.eq('report_id', row.report_id) : q.is('report_id', null);
    const { data, error } = await q.select('id');
    if (error) {
      await db.from('reports').delete().eq('id', reportId);
      throw new Error(`cloudwatch_alarms link failed: ${error.message}`);
    }
    linked = Array.isArray(data) && data.length > 0;
  }
  if (!linked) {
    // Another delivery of the same alarm linked its report first: ours is the duplicate.
    await db.from('reports').delete().eq('id', reportId);
    const winner = await readAlarmRow(db, projectId, key);
    return { outcome: 'deduped', reportId: winner?.report_id ?? null };
  }
  await input.classify(reportId, projectId);
  return { outcome: 'created', reportId };
}
