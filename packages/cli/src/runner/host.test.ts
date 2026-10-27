import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  collectHeartbeat,
  detectPlatform,
  hashHostId,
  parseLaunchctlList,
  parseMeminfo,
  parseRunnerFile,
  parseSystemctlShow,
  parseSystemctlUnits,
  parseUnitName,
  readCgroupMemory,
  runnerDirFromShow,
  type HostIO,
} from './host.js'

const MEMINFO = `MemTotal:       16303740 kB
MemFree:         1203400 kB
MemAvailable:    6303740 kB
SwapTotal:       4194300 kB
SwapFree:        3145724 kB
`

const UNIT = 'actions.runner.kensaurus-glot.it.nuc-1.service'

function fakeHost(files: Record<string, string>, execs: Record<string, string>, platform: NodeJS.Platform = 'linux'): HostIO {
  return {
    platform,
    readFile: (path) => files[path] ?? null,
    exec: (cmd, args) => execs[[cmd, ...args].join(' ')] ?? null,
    diskFreeBytes: () => 120 * 1024 ** 3,
    cpuCount: 8,
    totalMemBytes: 16 * 1024 ** 3,
    freeMemBytes: 4 * 1024 ** 3,
    load1: 0.5,
    hostname: 'nuc.local',
  }
}

describe('host parsers', () => {
  it('detects WSL2 from /proc/version', () => {
    expect(detectPlatform({ platform: 'linux', readFile: () => 'Linux version 6.6.36.6-microsoft-standard-WSL2' })).toBe('wsl2')
    expect(detectPlatform({ platform: 'linux', readFile: () => 'Linux version 6.8.0-45-generic' })).toBe('linux')
    expect(detectPlatform({ platform: 'darwin', readFile: () => null })).toBe('macos')
  })

  it('hashes the machine id with the mushi-runner salt and never returns it', () => {
    const id = hashHostId('abc123\n')
    expect(id).toBe(createHash('sha256').update('abc123mushi-runner').digest('hex'))
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(id).not.toContain('abc123')
  })

  it('reads memory and swap from /proc/meminfo', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ totalMb: 15922, availableMb: 6156, swapTotalMb: 4096, swapFreeMb: 3072 })
    expect(parseMeminfo('nothing')).toBeNull()
  })

  it('finds runner units in systemctl output, with or without a bullet', () => {
    const out = `${UNIT} loaded active running GitHub Actions Runner (kensaurus-glot.it.nuc-1)
● actions.runner.acme-api.ci-2.service loaded failed failed GitHub Actions Runner
`
    expect(parseSystemctlUnits(out)).toEqual([UNIT, 'actions.runner.acme-api.ci-2.service'])
  })

  it('splits owner and repo from a unit name only when it is unambiguous', () => {
    expect(parseUnitName('actions.runner.acme-api.ci-2.service')).toEqual({ name: 'ci-2', repo: 'acme/api' })
    // kensaurus-glot.it: one dash, so it splits
    expect(parseUnitName(UNIT)).toEqual({ name: 'nuc-1', repo: 'kensaurus/glot.it' })
    // my-org-my-repo: ambiguous
    expect(parseUnitName('actions.runner.my-org-my-repo.box.service')).toEqual({ name: 'box', repo: null })
  })

  it('prefers the .runner file for name and repo, and handles a BOM', () => {
    expect(parseRunnerFile('﻿{"agentName":"nuc-1","gitHubUrl":"https://github.com/my-org/my-repo"}')).toEqual({ name: 'nuc-1', repo: 'my-org/my-repo' })
    expect(parseRunnerFile('{"agentName":"org-runner","gitHubUrl":"https://github.com/my-org"}')).toEqual({ name: 'org-runner', repo: null })
    expect(parseRunnerFile('not json')).toBeNull()
  })

  it('finds the runner folder from WorkingDirectory or ExecStart', () => {
    const props = parseSystemctlShow('ExecStart={ path=/home/gha/actions-runner/runsvc.sh ; argv[]=/home/gha/actions-runner/runsvc.sh ; ignore_errors=no }\nWorkingDirectory=!/\n')
    expect(runnerDirFromShow(props)).toBe('/home/gha/actions-runner')
    expect(runnerDirFromShow({ WorkingDirectory: '/opt/r' })).toBe('/opt/r')
  })

  it('reads cgroup memory and falls back to the slice limit', () => {
    const cg = '/mushi-runner.slice/mushi-runner-x.service'
    const io = {
      readFile: (path: string) => ({
        '/sys/fs/cgroup/mushi-runner.slice/mushi-runner-x.service/memory.current': String(512 * 1024 * 1024),
        '/sys/fs/cgroup/mushi-runner.slice/mushi-runner-x.service/memory.max': 'max',
        '/sys/fs/cgroup/mushi-runner.slice/memory.max': String(8 * 1024 ** 3),
        '/sys/fs/cgroup/mushi-runner.slice/mushi-runner-x.service/memory.events': 'low 0\nhigh 3\nmax 1\noom 1\noom_kill 2\n',
      } as Record<string, string>)[path] ?? null,
    }
    expect(readCgroupMemory(io, cg)).toEqual({ mem_current_mb: 512, mem_max_mb: 8192, oom_kills: 2 })
    expect(readCgroupMemory(io, undefined)).toEqual({ mem_current_mb: null, mem_max_mb: null, oom_kills: null })
  })

  it('reads launchd runner agents on macOS', () => {
    expect(parseLaunchctlList('PID\tStatus\tLabel\n312\t0\tactions.runner.acme-api.mac-1\n-\t0\tcom.apple.x\n')).toEqual([
      { label: 'actions.runner.acme-api.mac-1', running: true },
    ])
  })
})

describe('collectHeartbeat', () => {
  it('builds the contract body from /proc, systemd and cgroups', () => {
    const io = fakeHost(
      {
        '/proc/version': 'Linux version 6.6.36.6-microsoft-standard-WSL2',
        '/etc/machine-id': 'deadbeef\n',
        '/proc/meminfo': MEMINFO,
        '/proc/loadavg': '3.21 2.00 1.50 2/900 1234\n',
        '/home/gha/actions-runner/.runner': '{"agentName":"nuc-1","gitHubUrl":"https://github.com/kensaurus/glot.it"}',
        '/sys/fs/cgroup/system.slice/x.service/memory.current': String(1024 * 1024 * 1024),
        '/sys/fs/cgroup/system.slice/x.service/memory.max': String(6 * 1024 ** 3),
        '/sys/fs/cgroup/system.slice/x.service/memory.events': 'oom_kill 1\n',
      },
      {
        'systemctl list-units --all actions.runner.* mushi-runner-* --no-legend --plain': [
          `${UNIT} loaded active running GitHub Actions Runner`,
          'mushi-runner-mushi-nuc.service loaded activating start-pre Mushi GitHub Actions runner',
          'mushi-runner-heartbeat.service loaded inactive dead Mushi runner heartbeat',
          '',
        ].join('\n'),
        [`systemctl show ${UNIT} -p ActiveState -p NRestarts -p ControlGroup -p WorkingDirectory -p ExecStart -p Description`]:
          'ActiveState=active\nNRestarts=4\nControlGroup=/system.slice/x.service\nWorkingDirectory=/home/gha/actions-runner\nExecStart={ path=/home/gha/actions-runner/runsvc.sh ; argv[]=/home/gha/actions-runner/runsvc.sh SECRET_ARG ; }\n',
        'systemctl show mushi-runner-mushi-nuc.service -p ActiveState -p NRestarts -p ControlGroup -p WorkingDirectory -p ExecStart -p Description':
          'ActiveState=activating\nNRestarts=12\nControlGroup=\nDescription=Mushi GitHub Actions runner mushi-nuc for my-org/my-repo (one job per runner)\n',
      },
    )
    const body = collectHeartbeat(io, '0.33.0')
    expect(body).toEqual({
      kind: 'heartbeat',
      host: {
        host_id: hashHostId('deadbeef'), hostname: 'nuc.local', platform: 'wsl2', cpu_count: 8, mem_total_mb: 15922, mushi_version: '0.33.0',
        metrics: { load1: 3.2, mem_used_mb: 15922 - 6156, swap_used_mb: 1024, swap_total_mb: 4096, disk_free_gb: 120 },
      },
      runners: [
        { name: 'nuc-1', repo: 'kensaurus/glot.it', service: UNIT, active: true, restarts: 4, mem_current_mb: 1024, mem_max_mb: 6144, oom_kills: 1 },
        { name: 'mushi-nuc', repo: 'my-org/my-repo', service: 'mushi-runner-mushi-nuc.service', active: false, restarts: 12, mem_current_mb: null, mem_max_mb: null, oom_kills: null },
      ],
    })
    const text = JSON.stringify(body)
    expect(text).not.toContain('deadbeef')
    expect(text).not.toContain('SECRET_ARG')
    expect(text).not.toContain('runsvc.sh')
  })

  it('on WSL2, sends the VM boot id hashed as machine_id, so distros on one PC group as one machine', () => {
    const files = (version: string) => ({
      '/proc/version': version,
      '/etc/machine-id': 'distro-a\n',
      '/proc/meminfo': MEMINFO,
      '/proc/sys/kernel/random/boot_id': 'b007-1d\n',
    })
    const wsl = collectHeartbeat(fakeHost(files('Linux version 6.6.36.6-microsoft-standard-WSL2'), {}), '1')
    expect(wsl.host.metrics.machine_id).toBe(hashHostId('wsl-vm:b007-1d'))
    expect(wsl.host.metrics.machine_id).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(wsl)).not.toContain('b007-1d')
    // A second distro has its own machine id but the same VM boot id.
    const other = collectHeartbeat(fakeHost({ ...files('Linux version 6.6.36.6-microsoft-standard-WSL2'), '/etc/machine-id': 'distro-b\n' }, {}), '1')
    expect(other.host.host_id).not.toBe(wsl.host.host_id)
    expect(other.host.metrics.machine_id).toBe(wsl.host.metrics.machine_id)
    // Plain Linux sends none: its host id already is the machine.
    expect(collectHeartbeat(fakeHost(files('Linux version 6.8.0-generic'), {}), '1').host.metrics).not.toHaveProperty('machine_id')
  })

  it('refuses native Windows and points at WSL2', () => {
    expect(() => collectHeartbeat(fakeHost({}, {}, 'win32'), '1')).toThrow(/WSL2/)
  })
})
