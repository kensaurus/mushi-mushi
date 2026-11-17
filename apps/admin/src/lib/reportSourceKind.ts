/**
 * FILE: apps/admin/src/lib/reportSourceKind.ts
 * PURPOSE: Where a bug came from, as one tag with a shape: a user, Sentry,
 *          an alarm, a setup task, a test, or one of Mushi Mushi's own
 *          checks. The Bugs list and the bug page show it, and the list
 *          filters by it (`?source=`, server `_shared/report-source-kind.ts`;
 *          keep the two lists in step).
 *
 *          Owner's walkthrough, 2026-11-17: CloudWatch alarms and "Add the
 *          Mushi SDK to kensaur.us" read as user bugs with High/Medium/Low
 *          beside them, and the bug page said "Reporter: A user".
 */

export type ReportSourceKind = 'user' | 'sentry' | 'alarm' | 'task' | 'test' | 'check'

const SOURCE_TO_KIND: Readonly<Record<string, Exclude<ReportSourceKind, 'user' | 'test'>>> = {
  sentry: 'sentry',
  cloudwatch: 'alarm',
  sdk_health: 'task',
  site_watch: 'check',
  site_audit: 'check',
  code_audit: 'check',
  security_advisory: 'check',
  library_modernizer: 'check',
  skill_run: 'check',
  fresh_eyes: 'check',
  ux_loop: 'check',
}

export function reportSourceKind(r: { source?: string | null; metadata_source?: string | null }): ReportSourceKind {
  if (r.metadata_source === 'admin_test_report') return 'test'
  return (r.source && SOURCE_TO_KIND[r.source]) || 'user'
}

/**
 * Label, glyph and what it means. The glyph is the shape the status needs
 * (never colour alone): ● a person, ◆ Sentry, ▲ an alarm, ☐ a task, ◇ a
 * test, ◎ a check.
 */
export const REPORT_SOURCE_META: Readonly<Record<ReportSourceKind, { label: string; glyph: string; hint: string; tone: string }>> = {
  user: { label: 'User report', glyph: '●', hint: 'Someone using the app sent this from the bug widget or the SDK.', tone: 'text-fg-secondary' },
  sentry: { label: 'Sentry', glyph: '◆', hint: 'Imported from Sentry: a production error, not a person.', tone: 'text-fg-secondary' },
  alarm: { label: 'Alarm', glyph: '▲', hint: 'An infrastructure alarm (AWS CloudWatch) filed this. No user reported it.', tone: 'text-warn-foreground' },
  task: { label: 'Setup task', glyph: '☐', hint: 'A setup step Mushi Mushi filed for you, not a bug in the app.', tone: 'text-info-foreground' },
  test: { label: 'Test', glyph: '◇', hint: 'A sample from "Send a test report". Nothing is broken.', tone: 'text-fg-muted' },
  check: { label: 'Mushi Mushi check', glyph: '◎', hint: "One of Mushi Mushi's own checks found this (site watch, audit, first-user test). No user reported it.", tone: 'text-fg-secondary' },
}

/** The list filter's options, in the order a person scans them. */
export const REPORT_SOURCE_FILTER_OPTIONS: ReadonlyArray<{ value: ReportSourceKind; label: string }> = (
  ['user', 'sentry', 'alarm', 'task', 'check', 'test'] as const
).map((value) => ({ value, label: REPORT_SOURCE_META[value].label }))

/**
 * A setup task or a test sample is not a bug, so it gets no bug severity
 * (High/Medium/Low read as "something is broken"). Alarms and checks keep
 * theirs: they rank real problems.
 */
export function showsSeverity(kind: ReportSourceKind): boolean {
  return kind !== 'task' && kind !== 'test'
}
