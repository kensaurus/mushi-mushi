/**
 * FILE: apps/admin/src/lib/releaseShipView.ts
 * PURPOSE: View model for a release's "Ship it" section (Plan 025 P4-P6,
 *          ADR 0074): the Security proof, the release kit and the store
 *          upload approvals. Types mirror the server (the admin never imports
 *          server code):
 *            security proof  packages/server/supabase/functions/_shared/security-proof.ts
 *                            + api/routes/security-proof.ts
 *            release kit     _shared/release-kit.ts + api/routes/release-kits.ts
 *            store media     _shared/connectors/store-media.ts
 *          Pure; no React.
 */

import type { BadgeTone } from '../components/ui'

// ── security proof ───────────────────────────────────────────────────────────

export type SecurityLane = 'dependencies' | 'secrets' | 'ai_review' | 'dast'
type ScanSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
type LaneState = 'passed' | 'findings' | 'error' | 'skipped' | 'off' | 'unknown' | 'stale'
type LaneTone = 'ok' | 'warn' | 'danger' | 'neutral'
type ProofState = 'proven' | 'attention' | 'incomplete' | 'not_pinned'

interface ScanRun {
  id: string
  lane: SecurityLane
  tool: string
  commit_sha: string | null
  ref: string | null
  event: string
  status: 'passed' | 'findings' | 'error' | 'skipped'
  skip_reason: string | null
  counts: Partial<Record<ScanSeverity | 'total' | 'deduped' | 'filed', number>>
  run_url: string | null
  target_url: string | null
  finished_at: string
}

export interface LaneProof {
  lane: SecurityLane
  label: string
  required: boolean
  state: LaneState
  tone: LaneTone
  detail: string
  run: ScanRun | null
  counts: Record<ScanSeverity | 'total', number>
  runs: ScanRun[]
}

export interface ProofFinding {
  id: string
  lane: SecurityLane | string
  severity: ScanSeverity | string
  title: string
  rule_id: string
  location: { file?: string; line?: number; url?: string } & Record<string, unknown>
  report_id: string | null
  deduped_by: 'vuln_watch' | 'open_report' | 'daily_limit' | 'below_threshold' | string | null
}

export interface SecurityProofData {
  state: ProofState
  headline: string
  commitSha: string | null
  lanes: LaneProof[]
  release: { id: string; version: string; commitSha: string | null } | null
  findings: ProofFinding[]
  workflowPath: string
}

export const LANE_TOOL: Record<SecurityLane, string> = {
  dependencies: 'OSV-Scanner',
  secrets: 'Gitleaks',
  ai_review: 'claude-code-security-review',
  dast: 'ZAP baseline + Nuclei',
}

export const PROOF_BADGE: Record<ProofState, { label: string; tone: BadgeTone }> = {
  proven: { label: 'Proven', tone: 'ok' },
  attention: { label: 'Needs a look', tone: 'warn' },
  incomplete: { label: 'Not proven yet', tone: 'danger' },
  not_pinned: { label: 'Not pinned', tone: 'neutral' },
}

export const LANE_STATE_LABEL: Record<LaneState, string> = {
  passed: 'Clean',
  findings: 'Findings',
  error: 'Did not finish',
  skipped: 'Skipped',
  off: 'Off',
  unknown: 'No result',
  stale: 'Out of date',
}

export const TONE_BADGE: Record<LaneTone, BadgeTone> = { ok: 'ok', warn: 'warn', danger: 'danger', neutral: 'neutral' }

/** The node dot of a lane, on existing semantic tokens (solid fill, no text on it). */
export const TONE_DOT: Record<LaneTone, string> = {
  ok: 'bg-ok border-ok',
  warn: 'bg-warn border-warn',
  danger: 'bg-danger border-danger',
  neutral: 'bg-surface-overlay border-edge-subtle',
}

/** The connector between two lanes: green only when both ends are clean. */
export function connectorClass(left: LaneTone, right: LaneTone): string {
  if (left === 'danger' || right === 'danger') return 'bg-danger/40'
  if (left === 'warn' || right === 'warn') return 'bg-warn/40'
  if (left === 'ok' && right === 'ok') return 'bg-ok/50'
  return 'bg-edge-subtle'
}

const SEVERITY_BADGE: Record<ScanSeverity, BadgeTone> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
  info: 'neutral',
}

export function severityTone(s: string): BadgeTone {
  return SEVERITY_BADGE[s as ScanSeverity] ?? 'neutral'
}

/** Why a finding has no report of its own, in plain words. */
export function dedupeText(by: ProofFinding['deduped_by']): string | null {
  switch (by) {
    case 'vuln_watch': return 'Already tracked by Known holes'
    case 'open_report': return 'Already in an open report'
    case 'daily_limit': return 'Waits for tomorrow (daily report limit)'
    case 'below_threshold': return 'Low severity: recorded, not filed'
    default: return null
  }
}

export function locationText(loc: ProofFinding['location'] | null | undefined): string | null {
  if (!loc) return null
  if (typeof loc.file === 'string') return `${loc.file}${typeof loc.line === 'number' ? `:${loc.line}` : ''}`
  if (typeof loc.url === 'string') return loc.url
  return null
}

/** Findings of one lane, worst first. */
export function laneFindings(findings: readonly ProofFinding[], lane: SecurityLane): ProofFinding[] {
  const rank = (s: string) => ['critical', 'high', 'medium', 'low', 'info'].indexOf(s)
  return findings.filter((f) => f.lane === lane).sort((a, b) => rank(String(a.severity)) - rank(String(b.severity)))
}

/** "2 high · 1 medium": the severities that are present. */
export function severitySummary(counts: Partial<Record<ScanSeverity | 'total', number>>): string {
  const parts = (['critical', 'high', 'medium', 'low', 'info'] as const).filter((s) => (counts[s] ?? 0) > 0).map((s) => `${counts[s]} ${s}`)
  return parts.join(' · ')
}

/** True when no lane ever produced a run: show the setup card. */
export function proofNeverRan(p: SecurityProofData): boolean {
  return p.lanes.every((l) => l.runs.length === 0 && (l.state === 'off' || l.state === 'unknown'))
}

export const SHA_RE = /^[0-9a-f]{7,40}$/i

export function proveCommand(sha: string): string {
  return `gh workflow run mushi-security.yml -f sha=${sha}`
}

// ── release kit ──────────────────────────────────────────────────────────────

export type KitPreset = 'app_store_preview' | 'play_promo' | 'social_vertical' | 'social_square'
type CheckState = 'pass' | 'fail' | 'declared' | 'unknown'
export interface SpecCheck { id: string; label: string; state: CheckState; detail: string }

interface PresetSpec {
  id: KitPreset
  label: string
  output: { width: number; height: number; minSeconds: number; maxSeconds: number; maxFps: number; container: string; codec: string; note: string }
  destination: string
}

type KitAssetKind = 'screenshot_before' | 'screenshot_after' | 'clip' | 'device_recording' | 'product_video'

export interface KitAsset {
  id: string
  kind: KitAssetKind
  source: 'ux_baseline' | 'ux_surface' | 'playwright' | 'upload' | 'lazycow'
  storage_path: string
  mime: string
  bytes: number | null
  sha256: string | null
  width: number | null
  height: number | null
  duration_ms: number | null
  fps: number | null
  codec: string | null
  metadata_from: 'measured' | 'declared'
  platform: 'web' | 'ios' | 'android' | null
  surface_path: string | null
  viewport: string | null
  label: string | null
  status: 'pending' | 'ready' | 'rejected'
  created_at: string
  url: string | null
  usableAs: string | null
  checks: SpecCheck[]
}

export interface StoreTarget {
  connectorId: string
  kind: 'app_store_connect' | 'play_console'
  name: string
  externalId: string
  actEnabled: boolean
  actions: readonly string[]
}

type StoreActionStatus = 'pending_approval' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed' | 'expired'

export interface StoreAction {
  id: string
  action: string
  status: StoreActionStatus
  payload?: Record<string, unknown>
  payload_sha256: string
  reason?: string | null
  requested_by?: string | null
  requested_at: string
  expires_at: string | null
  error: string | null
  result?: Record<string, unknown> | null
}

interface KitBrand { name: string; accent: string | null; theme: 'light' | 'dark' | 'auto' | null; logoUrl: string | null }

export interface ReleaseKitData {
  kit: { id: string; preset: KitPreset; changelog: string[]; brand: KitBrand; exportedAt: string | null; exportCount: number }
  release: { id: string; version: string; title: string; status: string; publishedAt: string | null; commitSha: string | null }
  assets: KitAsset[]
  readiness: { ready: boolean; screenshots: number; videos: number; problems: string[]; recommended?: string[] }
  presets: PresetSpec[]
  settings: { clipsEnabled: boolean; clipMaxSeconds: number; clipMaxMb: number }
  storeTargets: StoreTarget[]
  storeActions: StoreAction[]
  organizationId: string | null
}

/** POST …/kit/export. `preset` is lazycow's name for the kit's preset (appstore-iphone, play-promo, social-9x16, social-1x1). */
export interface KitExport { kitUrl: string; expiresAt: string; preset?: string; manifest: Record<string, unknown> }

/** Mushi's preset → lazycow's make_product_video preset (mirrors the server's LAZYCOW_PRESET). */
export const LAZYCOW_PRESET: Record<KitPreset, string> = {
  app_store_preview: 'appstore-iphone',
  play_promo: 'play-promo',
  social_vertical: 'social-9x16',
  social_square: 'social-1x1',
}

export const PRESET_OPTIONS: ReadonlyArray<{ id: KitPreset; label: string }> = [
  { id: 'app_store_preview', label: 'App Store preview' },
  { id: 'play_promo', label: 'Play promo' },
  { id: 'social_vertical', label: 'Social 9:16' },
  { id: 'social_square', label: 'Social 1:1' },
]

export const CHECK_BADGE: Record<CheckState, { tone: BadgeTone; suffix: string }> = {
  pass: { tone: 'ok', suffix: '' },
  fail: { tone: 'danger', suffix: '' },
  declared: { tone: 'info', suffix: ' (declared)' },
  unknown: { tone: 'neutral', suffix: ' (not read)' },
}

interface ScreenshotPair {
  key: string
  surfacePath: string | null
  viewport: string | null
  before: KitAsset | null
  after: KitAsset | null
}

/** Before/after screenshots paired by screen and viewport, in the order they were added. */
export function pairScreenshots(assets: readonly KitAsset[]): ScreenshotPair[] {
  const shots = assets.filter((a) => a.kind === 'screenshot_before' || a.kind === 'screenshot_after')
  const pairs = new Map<string, ScreenshotPair>()
  for (const a of shots) {
    const key = `${a.surface_path ?? ''}|${a.viewport ?? ''}`
    const p = pairs.get(key) ?? { key, surfacePath: a.surface_path, viewport: a.viewport, before: null, after: null }
    if (a.kind === 'screenshot_before') p.before = p.before ?? a
    else p.after = p.after ?? a
    pairs.set(key, p)
  }
  return [...pairs.values()]
}

export function isVideo(a: Pick<KitAsset, 'mime'>): boolean {
  return a.mime.startsWith('video/')
}

export function videoAssets(assets: readonly KitAsset[]): KitAsset[] {
  return assets.filter(isVideo)
}

export const KIND_LABEL: Record<KitAssetKind, string> = {
  screenshot_before: 'Before',
  screenshot_after: 'After',
  clip: 'Clip',
  device_recording: 'Device recording',
  product_video: 'Product video',
}

export function bytesText(n: number | null | undefined): string | null {
  if (n == null) return null
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}

export function presetSpecText(p: PresetSpec): string {
  const o = p.output
  return `${o.width}×${o.height} · ${o.minSeconds}–${o.maxSeconds} s · ≤ ${o.maxFps} fps · ${o.codec.toUpperCase()} ${o.container}`
}

export function handoffSnippet(kitUrl: string, preset: string): string {
  return `make_product_video({ kitUrl: ${JSON.stringify(kitUrl)}, preset: ${JSON.stringify(preset)} })`
}

const MAX_CHANGELOG_LINES = 12
const MAX_CHANGELOG_CHARS = 140

/** Textarea text → the changelog lines the server takes (≤ 12 non-empty lines, ≤ 140 chars). */
export function parseChangelog(text: string): { lines: string[]; problem: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length > MAX_CHANGELOG_LINES) return { lines, problem: `At most ${MAX_CHANGELOG_LINES} lines (you have ${lines.length}).` }
  const long = lines.findIndex((l) => l.length > MAX_CHANGELOG_CHARS)
  if (long >= 0) return { lines, problem: `Line ${long + 1} is ${lines[long].length} characters; keep each under ${MAX_CHANGELOG_CHARS + 1}.` }
  return { lines, problem: null }
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── store uploads ────────────────────────────────────────────────────────────

/** Keys of APPLE_SCREENSHOT_SIZES / APPLE_PREVIEW_SIZES / PLAY_IMAGE_TYPES in store-media.ts. */
const APPLE_DISPLAY_TYPES = ['APP_IPHONE_67', 'APP_IPHONE_65', 'APP_IPHONE_61', 'APP_IPHONE_55', 'APP_IPAD_PRO_3GEN_129', 'APP_IPAD_PRO_129', 'APP_IPAD_PRO_3GEN_11'] as const
const APPLE_PREVIEW_TYPES = ['IPHONE_67', 'IPHONE_65', 'IPHONE_61', 'IPHONE_58', 'IPHONE_55', 'IPHONE_47', 'IPAD_PRO_3GEN_129', 'IPAD_PRO_3GEN_11', 'IPAD_PRO_129', 'IPAD_105', 'IPAD_97', 'DESKTOP', 'APPLE_TV', 'APPLE_VISION_PRO'] as const
const PLAY_IMAGE_TYPES = ['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvScreenshots', 'wearScreenshots', 'icon', 'featureGraphic', 'tvBanner'] as const

export const STORE_ACTION_LABEL: Record<string, string> = {
  upload_screenshots: 'Upload screenshots',
  upload_app_preview: 'Upload app preview',
  upload_listing_images: 'Upload listing images',
  set_promo_video: 'Set promo video',
}

export const STORE_ACTION_STATUS: Record<StoreActionStatus, { label: string; tone: BadgeTone }> = {
  pending_approval: { label: 'Waiting for approval', tone: 'warn' },
  approved: { label: 'Approved, not run', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  executing: { label: 'Running', tone: 'info' },
  executed: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
}

export interface StoreFormState {
  action: string
  locale: string
  deviceType: string
  assetIds: string[]
  youtubeUrl: string
  replace: boolean
}

export function defaultStoreForm(t: StoreTarget): StoreFormState {
  const action = t.actions[0] ?? ''
  return { action, locale: 'en-US', deviceType: deviceTypesFor(action)[0] ?? '', assetIds: [], youtubeUrl: '', replace: false }
}

export function deviceTypesFor(action: string): readonly string[] {
  if (action === 'upload_screenshots') return APPLE_DISPLAY_TYPES
  if (action === 'upload_app_preview') return APPLE_PREVIEW_TYPES
  if (action === 'upload_listing_images') return PLAY_IMAGE_TYPES
  return []
}

/** Assets a store action can take: images for screenshots and listing images, store-ready videos for a preview. */
export function assetsForAction(assets: readonly KitAsset[], action: string): KitAsset[] {
  const ready = assets.filter((a) => a.status === 'ready')
  if (action === 'upload_app_preview') return ready.filter((a) => a.mime === 'video/mp4' || a.mime === 'video/quicktime')
  if (action === 'upload_screenshots' || action === 'upload_listing_images') return ready.filter((a) => a.mime === 'image/png' || a.mime === 'image/jpeg')
  return []
}

/** The body POST …/kit/store-upload takes (release-kits.ts storeSchema). */
export function storeUploadBody(t: StoreTarget, f: StoreFormState): Record<string, unknown> {
  const body: Record<string, unknown> = { connectorId: t.connectorId, action: f.action, locale: f.locale.trim() }
  if (f.action === 'set_promo_video') return { ...body, youtubeUrl: f.youtubeUrl.trim(), assetIds: [] }
  if (f.action === 'upload_screenshots') body.displayType = f.deviceType
  if (f.action === 'upload_app_preview') body.previewType = f.deviceType
  if (f.action === 'upload_listing_images') {
    body.imageType = f.deviceType
    body.replace = f.replace
  }
  return { ...body, assetIds: f.assetIds }
}

export const STORE_KIND_LABEL: Record<StoreTarget['kind'], string> = { app_store_connect: 'App Store Connect', play_console: 'Google Play' }
