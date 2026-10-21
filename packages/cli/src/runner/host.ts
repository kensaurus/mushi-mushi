/**
 * FILE: packages/cli/src/runner/host.ts
 * PURPOSE: Reads this machine's health and its GitHub Actions runner services
 *          for `mushi runner heartbeat` (Plan 022 Phase 3, ADR 0033):
 *          memory, swap, load and free disk from /proc and statfs, runner
 *          services from systemd (launchd on macOS, best effort), and each
 *          runner's cgroup memory use, limit and out-of-memory kills.
 *
 *          What leaves the machine is only the heartbeat body built here:
 *          numbers, the hostname, runner names, repo names and unit names.
 *          The machine id is hashed with sha256 before it is sent. No file
 *          contents, environment values or process arguments are sent; the
 *          runner's ExecStart is read locally only to find its folder.
 *
 *          All I/O goes through HostIO so the parsers are unit-tested.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statfsSync } from 'node:fs'
import { cpus, freemem, hostname, loadavg, totalmem } from 'node:os'
import { dirname, join } from 'node:path'

export type RunnerPlatform = 'linux' | 'wsl2' | 'macos' | 'windows'

export interface HostIO {
  platform: NodeJS.Platform
  readFile(path: string): string | null
  /** Run a program without a shell; null when it fails or is missing. */
  exec(cmd: string, args: string[]): string | null
  diskFreeBytes(path: string): number | null
  cpuCount: number
  totalMemBytes: number
  freeMemBytes: number
  load1: number
  hostname: string
}

export const nodeHostIO: HostIO = {
  platform: process.platform,
  readFile(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  exec(cmd, args) {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 })
    } catch {
      return null
    }
  },
  diskFreeBytes(path) {
    try {
      const s = statfsSync(path)
      return Number(s.bavail) * Number(s.bsize)
    } catch {
      return null
    }
  },
  // Getters, so a heartbeat loop reads fresh values every tick.
  get cpuCount() { return cpus().length },
  get totalMemBytes() { return totalmem() },
  get freeMemBytes() { return freemem() },
  get load1() { return loadavg()[0] ?? 0 },
  get hostname() { return hostname() },
}

interface RunnerSample {
  name: string
  repo: string | null
  service: string | null
  active: boolean
  restarts: number | null
  mem_current_mb: number | null
  mem_max_mb: number | null
  oom_kills: number | null
}

export interface HeartbeatBody {
  kind: 'heartbeat'
  host: {
    host_id: string
    hostname: string
    platform: RunnerPlatform
    cpu_count: number
    mem_total_mb: number
    mushi_version: string
    /** Inside `host`, as runnerHeartbeatSchema (strict) in _shared/schemas.ts expects. */
    metrics: {
      load1: number
      mem_used_mb: number
      swap_used_mb: number
      swap_total_mb: number
      disk_free_gb: number
    }
  }
  runners: RunnerSample[]
}

const HOST_ID_SALT = 'mushi-runner'
const MAX_RUNNERS = 40

export function detectPlatform(io: Pick<HostIO, 'platform' | 'readFile'>): RunnerPlatform {
  if (io.platform === 'darwin') return 'macos'
  if (io.platform === 'win32') return 'windows'
  const version = io.readFile('/proc/version') ?? ''
  return /microsoft/i.test(version) ? 'wsl2' : 'linux'
}

/** The raw machine id (never sent): /etc/machine-id on Linux, IOPlatformUUID on macOS. */
export function readMachineId(io: HostIO): string | null {
  if (io.platform === 'darwin') {
    const out = io.exec('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
    return out?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? null
  }
  for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    const id = io.readFile(path)?.trim()
    if (id) return id
  }
  return null
}

/** sha256(machine id + salt), 64 hex characters. */
export function hashHostId(rawId: string): string {
  return createHash('sha256').update(`${rawId.trim()}${HOST_ID_SALT}`).digest('hex')
}

interface MemInfo {
  totalMb: number
  availableMb: number
  swapTotalMb: number
  swapFreeMb: number
}

/** @internal Exported for tests only. */
export function parseMeminfo(text: string): MemInfo | null {
  const kb = (key: string): number | null => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm'))
    return m ? Number(m[1]) : null
  }
  const total = kb('MemTotal')
  if (total == null) return null
  const available = kb('MemAvailable') ?? kb('MemFree') ?? 0
  return {
    totalMb: Math.round(total / 1024),
    availableMb: Math.round(available / 1024),
    swapTotalMb: Math.round((kb('SwapTotal') ?? 0) / 1024),
    swapFreeMb: Math.round((kb('SwapFree') ?? 0) / 1024),
  }
}

function parseLoadavg(text: string): number | null {
  const v = Number(text.trim().split(/\s+/)[0])
  return Number.isFinite(v) ? v : null
}

/** macOS `sysctl vm.swapusage`: "total = 2048.00M  used = 1024.50M  free = ..." */
function parseSwapUsage(text: string): { totalMb: number; usedMb: number } | null {
  const total = text.match(/total\s*=\s*([\d.]+)M/)
  const used = text.match(/used\s*=\s*([\d.]+)M/)
  if (!total || !used) return null
  return { totalMb: Math.round(Number(total[1])), usedMb: Math.round(Number(used[1])) }
}

/** Units `mushi runner add` writes that are not runners. */
const MUSHI_HELPER_UNITS = new Set(['mushi-runner-heartbeat.service', 'mushi-runner-egress.service'])

/**
 * Runner unit names from `systemctl list-units --all 'actions.runner.*'
 * 'mushi-runner-*' --no-legend --plain`: GitHub's own svc.sh units and the
 * ones `mushi runner add` writes (mushi-runner-<label>.service).
 * @internal Exported for tests only.
 */
export function parseSystemctlUnits(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const unit = line.trim().split(/\s+/).find((tok) =>
      /^actions\.runner\..+\.service$/.test(tok) || (/^mushi-runner-.+\.service$/.test(tok) && !MUSHI_HELPER_UNITS.has(tok)))
    if (unit && !out.includes(unit)) out.push(unit)
  }
  return out
}

/** Label and repo from the Description `mushi runner add` writes: "Mushi GitHub Actions runner <label> for <owner/repo> …". */
function parseMushiUnitDescription(description: string | undefined): { name: string; repo: string } | null {
  const m = description?.match(/^Mushi GitHub Actions runner (\S+) for ([\w.-]+\/[\w.-]+)/)
  return m ? { name: m[1]!, repo: m[2]! } : null
}

/**
 * `systemctl show <unit> -p A -p B` → { A: '...', B: '...' }.
 * @internal Exported for tests only.
 */
export function parseSystemctlShow(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1).trim()
  }
  return out
}

/**
 * Runner name and repo from `actions.runner.<owner>-<repo>.<name>.service`.
 * The owner/repo split is ambiguous when either contains '-', so repo is
 * null unless exactly one '-' separates them. Prefer the runner's .runner file.
 * @internal Exported for tests only.
 */
export function parseUnitName(unit: string): { name: string; repo: string | null } | null {
  const m = unit.match(/^actions\.runner\.(.+)\.service$/)
  if (!m) return null
  const middle = m[1]!
  const dot = middle.lastIndexOf('.')
  if (dot <= 0) return { name: middle, repo: null }
  const name = middle.slice(dot + 1)
  const ownerRepo = middle.slice(0, dot)
  const dashes = ownerRepo.split('-').length - 1
  if (dashes !== 1) return { name, repo: null }
  const [owner, repo] = ownerRepo.split('-')
  return { name, repo: owner && repo ? `${owner}/${repo}` : null }
}

/**
 * The runner folder: WorkingDirectory, else the folder of ExecStart's program.
 * @internal Exported for tests only.
 */
export function runnerDirFromShow(props: Record<string, string>): string | null {
  const wd = props['WorkingDirectory']
  if (wd && wd.startsWith('/')) return wd
  const path = props['ExecStart']?.match(/path=([^\s;]+)/)?.[1]
  return path && path.startsWith('/') ? dirname(path) : null
}

/**
 * The runner's own `.runner` file: { agentName, gitHubUrl }. Org-level runners have no repo.
 * @internal Exported for tests only.
 */
export function parseRunnerFile(text: string): { name: string | null; repo: string | null } | null {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const name = typeof d['agentName'] === 'string' ? d['agentName'] : null
  let repo: string | null = null
  if (typeof d['gitHubUrl'] === 'string') {
    try {
      const parts = new URL(d['gitHubUrl']).pathname.split('/').filter(Boolean)
      if (parts.length >= 2) repo = `${parts[0]}/${parts[1]}`
    } catch {
      repo = null
    }
  }
  return { name, repo }
}

const MB = 1024 * 1024

function bytesToMb(text: string | null): number | null {
  const t = text?.trim()
  if (!t || t === 'max') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n / MB) : null
}

function parseOomKills(eventsText: string | null): number | null {
  const m = eventsText?.match(/^oom_kill\s+(\d+)/m)
  return m ? Number(m[1]) : null
}

/**
 * Memory use, limit and OOM kills of a cgroup v2 path; the limit falls back to the parent slice.
 * @internal Exported for tests only.
 */
export function readCgroupMemory(io: Pick<HostIO, 'readFile'>, controlGroup: string | undefined): {
  mem_current_mb: number | null
  mem_max_mb: number | null
  oom_kills: number | null
} {
  if (!controlGroup || !controlGroup.startsWith('/')) return { mem_current_mb: null, mem_max_mb: null, oom_kills: null }
  const dir = join('/sys/fs/cgroup', controlGroup)
  const slice = dirname(dir)
  const max = bytesToMb(io.readFile(join(dir, 'memory.max'))) ??
    (slice !== '/sys/fs/cgroup' ? bytesToMb(io.readFile(join(slice, 'memory.max'))) : null)
  return {
    mem_current_mb: bytesToMb(io.readFile(join(dir, 'memory.current'))),
    mem_max_mb: max,
    oom_kills: parseOomKills(io.readFile(join(dir, 'memory.events'))),
  }
}

function linuxRunners(io: HostIO): RunnerSample[] {
  const list = io.exec('systemctl', ['list-units', '--all', 'actions.runner.*', 'mushi-runner-*', '--no-legend', '--plain'])
  if (!list) return []
  const out: RunnerSample[] = []
  for (const unit of parseSystemctlUnits(list).slice(0, MAX_RUNNERS)) {
    const props = parseSystemctlShow(
      io.exec('systemctl', ['show', unit, '-p', 'ActiveState', '-p', 'NRestarts', '-p', 'ControlGroup', '-p', 'WorkingDirectory', '-p', 'ExecStart', '-p', 'Description']) ?? '',
    )
    const fromName = parseMushiUnitDescription(props['Description']) ?? parseUnitName(unit)
    const dir = runnerDirFromShow(props)
    const fromFile = dir ? parseRunnerFile(io.readFile(join(dir, '.runner')) ?? '') : null
    const restarts = Number(props['NRestarts'])
    out.push({
      name: (fromFile?.name ?? fromName?.name ?? unit).slice(0, 100),
      repo: fromFile?.repo ?? fromName?.repo ?? null,
      service: unit,
      active: props['ActiveState'] === 'active',
      restarts: Number.isFinite(restarts) && props['NRestarts'] !== '' && props['NRestarts'] !== undefined ? restarts : null,
      ...readCgroupMemory(io, props['ControlGroup']),
    })
  }
  return out
}

/**
 * macOS, best effort: `launchctl list` rows "PID Status Label" for actions.runner.* agents.
 * @internal Exported for tests only.
 */
export function parseLaunchctlList(text: string): Array<{ label: string; running: boolean }> {
  const out: Array<{ label: string; running: boolean }> = []
  for (const line of text.split('\n')) {
    const [pid, , label] = line.trim().split(/\s+/)
    if (label && label.startsWith('actions.runner.')) out.push({ label, running: pid !== undefined && /^\d+$/.test(pid) })
  }
  return out
}

function macRunners(io: HostIO): RunnerSample[] {
  const list = io.exec('launchctl', ['list'])
  if (!list) return []
  return parseLaunchctlList(list).slice(0, MAX_RUNNERS).map(({ label, running }) => {
    const parsed = parseUnitName(`${label}.service`)
    return {
      name: (parsed?.name ?? label).slice(0, 100),
      repo: parsed?.repo ?? null,
      service: label,
      active: running,
      restarts: null,
      mem_current_mb: null,
      mem_max_mb: null,
      oom_kills: null,
    }
  })
}

export class UnsupportedHostError extends Error {}

export function collectHeartbeat(io: HostIO, mushiVersion: string): HeartbeatBody {
  const platform = detectPlatform(io)
  if (platform === 'windows') {
    throw new UnsupportedHostError('The heartbeat runs on Linux, WSL2 and macOS. On Windows, run your runner inside WSL2 and run this there.')
  }
  const rawId = readMachineId(io)
  if (!rawId) throw new UnsupportedHostError('Could not read a machine id (/etc/machine-id or IOPlatformUUID).')

  const round1 = (n: number) => Math.round(n * 10) / 10
  let memTotalMb = Math.round(io.totalMemBytes / MB)
  let memUsedMb = Math.round((io.totalMemBytes - io.freeMemBytes) / MB)
  let swapUsedMb = 0
  let swapTotalMb = 0
  let load1 = io.load1
  if (platform === 'macos') {
    const swap = parseSwapUsage(io.exec('sysctl', ['vm.swapusage']) ?? '')
    if (swap) {
      swapUsedMb = swap.usedMb
      swapTotalMb = swap.totalMb
    }
  } else {
    const mem = parseMeminfo(io.readFile('/proc/meminfo') ?? '')
    if (mem) {
      memTotalMb = mem.totalMb
      memUsedMb = mem.totalMb - mem.availableMb
      swapTotalMb = mem.swapTotalMb
      swapUsedMb = mem.swapTotalMb - mem.swapFreeMb
    }
    load1 = parseLoadavg(io.readFile('/proc/loadavg') ?? '') ?? load1
  }
  const diskFree = io.diskFreeBytes('/')

  return {
    kind: 'heartbeat',
    host: {
      host_id: hashHostId(rawId),
      hostname: io.hostname.slice(0, 80),
      platform,
      cpu_count: io.cpuCount,
      mem_total_mb: memTotalMb,
      mushi_version: mushiVersion.slice(0, 40),
      metrics: {
        load1: round1(load1),
        mem_used_mb: Math.max(0, memUsedMb),
        swap_used_mb: Math.max(0, swapUsedMb),
        swap_total_mb: swapTotalMb,
        disk_free_gb: diskFree == null ? 0 : round1(diskFree / 1024 ** 3),
      },
    },
    runners: platform === 'macos' ? macRunners(io) : linuxRunners(io),
  }
}
