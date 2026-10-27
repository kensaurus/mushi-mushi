import { describe, expect, it } from 'vitest'
import {
  buildAddPlan,
  defaultLabel,
  defaultMemory,
  egressRules,
  mergeIni,
  parseResolvers,
  parseRunnerSha,
  systemdArgv,
  type AddPlanInput,
} from './add-plan.js'

const SHA = 'b'.repeat(64)
const KEY = 'mushi_test_key_0123' // gitleaks:allow — fake key; must never appear in a plan

function input(over: Partial<AddPlanInput> = {}): AddPlanInput {
  return {
    repo: 'kensaurus/glot.it',
    label: 'mushi-nuc',
    mode: 'ephemeral',
    platform: 'linux',
    arch: 'x64',
    memoryMax: '8G',
    runnerUser: 'gha-runner',
    uid: 1990,
    installUser: 'kenji',
    release: { version: '2.329.0', sha256: SHA },
    endpoint: 'https://api.test/functions/v1/api',
    hostId: 'a'.repeat(64),
    heartbeatCommand: ['/usr/bin/node', '/usr/lib/node_modules/@mushi-mushi/cli/dist/index.js', 'runner', 'heartbeat', '--once'],
    blockLan: false,
    resolvers: [],
    systemdRunning: true,
    wsl: null,
    setVariable: false,
    isPublic: false,
    allowPublic: false,
    forkApproval: 'all_external_contributors',
    prTargetWorkflows: [],
    ghTokenInKeyring: false,
    ...over,
  }
}

const ids = (plan: ReturnType<typeof buildAddPlan>) => plan.steps.map((s) => s.id)

describe('buildAddPlan refusals', () => {
  it('refuses a public repo unless --allow-public, and cites GitHub', () => {
    const plan = buildAddPlan(input({ isPublic: true }))
    expect(plan.refused).toMatch(/public/)
    expect(plan.refused).toContain('https://docs.github.com/en/actions/reference/security/secure-use')
    expect(plan.steps).toEqual([])
    const allowed = buildAddPlan(input({ isPublic: true, allowPublic: true }))
    expect(allowed.refused).toBeNull()
    expect(allowed.warnings.join(' ')).toMatch(/public/)
  })

  it('sends native Windows to WSL2 and refuses root or a shared user', () => {
    expect(buildAddPlan(input({ platform: 'windows' })).refused).toMatch(/WSL2/)
    expect(buildAddPlan(input({ installUser: 'root' })).refused).toMatch(/not as root/)
    expect(buildAddPlan(input({ runnerUser: 'kenji' })).refused).toMatch(/its own user/)
  })

  it('validates everything that ends up in a shell command', () => {
    expect(buildAddPlan(input({ repo: 'a/b; rm -rf /' })).refused).toMatch(/owner\/name/)
    expect(buildAddPlan(input({ label: 'Bad Label' })).refused).toMatch(/Label/)
    expect(buildAddPlan(input({ memoryMax: '8 GB' })).refused).toMatch(/Memory/)
    expect(buildAddPlan(input({ hostId: '' })).refused).toMatch(/machine id/)
  })

  it('will not download without a published SHA-256', () => {
    expect(buildAddPlan(input({ release: null })).refused).toMatch(/SHA-256/)
  })
})

describe('buildAddPlan (Linux, ephemeral default)', () => {
  const plan = buildAddPlan(input())
  const all = JSON.stringify(plan)

  it('creates a dedicated user, checks the download, caps memory and runs one job per runner', () => {
    expect(ids(plan)).toEqual([
      'user', 'download', 'deps', 'slice', 'mint', 'start', 'service',
      'hook-started', 'hook-completed', 'hook-key', 'hook-env',
      'heartbeat-key', 'heartbeat-service', 'heartbeat-timer', 'enable',
    ])
    const step = (id: string) => plan.steps.find((s) => s.id === id)!
    expect(step('user').run).toContain('useradd --system --uid 1990')
    expect(step('user').run).toContain('--shell /usr/sbin/nologin gha-runner')
    expect(step('download').run).toContain(`echo '${SHA}  '"$tmp/runner.tgz" | sha256sum -c -`)
    expect(step('download').run).toContain('v2.329.0/actions-runner-linux-x64-2.329.0.tar.gz')
    expect(step('slice').file!.content).toContain('MemoryMax=8G')
    expect(step('slice').file!.content).not.toContain('MemoryHigh')
    expect(step('slice').file!.content).toContain('MemorySwapMax=2G')
    const mint = step('mint').file!.content
    expect(mint).toContain('repos/kensaurus/glot.it/actions/runners/generate-jitconfig')
    expect(mint).toContain('-F runner_group_id=1')
    expect(mint).toContain("-f 'labels[]=mushi-nuc'")
    expect(mint).toContain('runuser -u kenji -- gh')
    // A repo-admin token is only used when root alone can read it.
    expect(mint).toContain(`[ "$(stat -c '%u %a' '/etc/mushi-runner/mushi-nuc.gh-token')" = "0 600" ]`)
    expect(mint).toContain("rm -rf '/opt/mushi-runner/mushi-nuc/_work'")
    expect(step('start').file!.content).toContain('ACTIONS_RUNNER_INPUT_JITCONFIG=$(cat "$RUNTIME_DIRECTORY/jit")')
    const svc = step('service').file!.content
    expect(svc).toContain('User=gha-runner')
    expect(svc).toContain('Slice=mushi-runner.slice')
    expect(svc).toContain('Restart=always')
    expect(svc).toContain('ProtectHome=yes')
    expect(svc).toContain('ExecStartPre=+/usr/local/lib/mushi-runner/mushi-nuc-mint.sh')
    expect(step('enable').run).toBe('systemctl daemon-reload && systemctl enable --now mushi-runner-mushi-nuc.service mushi-runner-heartbeat.timer')
  })

  it('pipes secrets on stdin and never puts them in a step', () => {
    expect(plan.steps.filter((s) => s.stdinSecret).map((s) => [s.id, s.stdinSecret])).toEqual([
      ['hook-key', 'runner-key'],
      ['heartbeat-key', 'runner-key'],
    ])
    expect(all).not.toContain(KEY)
    // The heartbeat gets its runner key from systemd, never from the unit or an env file.
    const hb = plan.steps.find((s) => s.id === 'heartbeat-service')!.file!.content
    expect(hb).toContain('LoadCredential=runner-key:/etc/mushi/runner.key')
    expect(hb).not.toMatch(/EnvironmentFile|MUSHI_API_KEY|MUSHI_RUNNER_KEY/)
    expect(plan.steps.find((s) => s.id === 'heartbeat-key')!.run).toContain("> /etc/mushi/runner.key")
    expect(all).not.toMatch(/--token\s/)
    for (const s of plan.steps) expect(s.run).not.toMatch(/flush ruleset/)
  })

  it('runs every root step through sudo and never touches the global ruleset', () => {
    expect(plan.steps.every((s) => s.sudo)).toBe(true)
  })

  it('tells the user how workflows opt in and that container isolation is not built yet', () => {
    const notes = plan.notes.join('\n')
    expect(notes).toContain('runs-on: [self-hosted, mushi-nuc]')
    expect(notes).toContain('gh variable set LINUX_RUNNER --repo kensaurus/glot.it --body mushi-nuc')
    expect(notes).toMatch(/container per job/)
  })
})

describe('buildAddPlan options', () => {
  it('persistent mode registers with a token read from stdin into ACTIONS_RUNNER_INPUT_TOKEN', () => {
    const plan = buildAddPlan(input({ mode: 'persistent' }))
    const reg = plan.steps.find((s) => s.id === 'register')!
    expect(reg.stdinSecret).toBe('registration-token')
    expect(reg.run).toContain('IFS= read -r ACTIONS_RUNNER_INPUT_TOKEN')
    expect(reg.run).toContain('./config.sh --unattended --replace --url https://github.com/kensaurus/glot.it --name mushi-nuc --labels mushi-nuc')
    expect(ids(plan)).not.toContain('mint')
  })

  it('adds the egress block in its own nftables table, and sets the variable only on --set-variable', () => {
    const plan = buildAddPlan(input({ blockLan: true, setVariable: true, resolvers: ['192.168.1.1', '127.0.0.53'] }))
    expect(ids(plan).slice(ids(plan).indexOf('egress-check'), ids(plan).indexOf('egress-check') + 3)).toEqual(['egress-check', 'egress-rules', 'egress-service'])
    expect(plan.steps.find((s) => s.id === 'enable')!.run).toContain('mushi-runner-egress.service')
    const variable = plan.steps.find((s) => s.id === 'variable')!
    expect(variable.sudo).toBe(false)
    expect(variable.run).toBe('gh variable set LINUX_RUNNER --repo kensaurus/glot.it --body mushi-nuc')
  })

  it('warns about weak fork approval, pull_request_target and a keyring gh login', () => {
    const plan = buildAddPlan(input({ forkApproval: 'first_time_contributors', prTargetWorkflows: ['label.yml'], ghTokenInKeyring: true }))
    const w = plan.warnings.join('\n')
    expect(w).toContain('first_time_contributors')
    expect(w).toContain('label.yml')
    expect(w).toContain('/etc/mushi-runner/mushi-nuc.gh-token')
    expect(w).toMatch(/Cloud agents push branches/)
  })

  it('on WSL2 turns systemd on, offers isolation and prints the keepalive', () => {
    const plan = buildAddPlan(input({ platform: 'wsl2', wsl: { distro: 'Ubuntu-24.04', wslConf: '[boot]\nsystemd=true\n', isolate: true } }))
    const conf = plan.steps.find((s) => s.id === 'wsl-conf')!.file!.content
    expect(conf).toBe('[boot]\nsystemd=true\n\n[automount]\nenabled=false\n\n[interop]\nenabled=false\nappendWindowsPath=false\n')
    const notes = plan.notes.join('\n')
    expect(notes).toContain('wsl.exe -d Ubuntu-24.04 -u root --exec sleep infinity')
    expect(notes).toContain('instanceIdleTimeout=-1')
    expect(notes).toContain('vmIdleTimeout=-1')
  })

  it('on WSL2 without systemd only fixes wsl.conf and asks for a restart', () => {
    const plan = buildAddPlan(input({ platform: 'wsl2', systemdRunning: false, wsl: { distro: 'Ubuntu', wslConf: '', isolate: false } }))
    expect(ids(plan)).toEqual(['wsl-conf'])
    expect(plan.notes.join(' ')).toMatch(/wsl --shutdown/)
    expect(plan.warnings.join(' ')).toMatch(/--wsl-isolate/)
  })

  it('on macOS prints LaunchAgent steps and runs nothing', () => {
    const plan = buildAddPlan(input({ platform: 'macos', arch: 'arm64' }))
    expect(plan.steps).toEqual([])
    expect(plan.notes.join('\n')).toMatch(/LaunchAgent/)
  })
})

describe('helpers', () => {
  it('defaults the label to mushi-<short host> and memory to 60% of RAM', () => {
    expect(defaultLabel('NUC.local')).toBe('mushi-nuc')
    expect(defaultLabel('Kenji_Alienware')).toBe('mushi-kenji-alienware')
    expect(defaultMemory(16000)).toBe('9G')
    expect(defaultMemory(2000)).toBe('1200M')
  })

  it('reads the SHA-256 GitHub publishes in the release notes', () => {
    const body = `## Hashes\n<!-- BEGIN SHA linux-x64 -->${SHA}<!-- END SHA linux-x64 -->\n<!-- BEGIN SHA linux-arm64 -->${'c'.repeat(64)}<!-- END SHA linux-arm64 -->`
    expect(parseRunnerSha(body, 'linux-x64')).toBe(SHA)
    expect(parseRunnerSha(body, 'linux-arm64')).toBe('c'.repeat(64))
    expect(parseRunnerSha(body, 'osx-x64')).toBeNull()
  })

  it('merges INI keys and leaves a file alone when nothing changes', () => {
    expect(mergeIni('[boot]\nsystemd=true\n', { boot: { systemd: 'true' } })).toBeNull()
    expect(mergeIni('[boot]\nsystemd=false\n[network]\nhostname=x\n', { boot: { systemd: 'true' } })).toBe('[boot]\nsystemd=true\n[network]\nhostname=x\n')
  })

  it('writes an nftables table of its own, allows DNS and blocks private ranges', () => {
    const rules = egressRules(1990, parseResolvers('nameserver 192.168.1.1\nnameserver 127.0.0.53\n'))
    expect(rules).toContain('table inet mushi_runner_egress_1990 {}')
    expect(rules).toContain('delete table inet mushi_runner_egress_1990')
    expect(rules).toContain('define MUSHI_RUNNER_UID = 1990')
    expect(rules).toContain('ip daddr { 10.255.255.254, 192.168.1.1 } meta l4proto { tcp, udp } th dport 53 accept')
    expect(rules).toContain('100.64.0.0/10')
    expect(rules).not.toContain('flush')
  })

  it('quotes systemd argv', () => {
    expect(systemdArgv(['/usr/bin/node', '/a b/c.js', '100%'])).toBe('/usr/bin/node "/a b/c.js" 100%%')
  })
})

describe('values from GitHub and the machine are allowlisted before they reach a shell step', () => {
  it('refuses an odd runner version, checksum or resolver', async () => {
    const { buildAddPlan } = await import('./add-plan.js')
    const ok = input()
    expect(buildAddPlan({ ...ok, release: { version: "2.338.0'; rm -rf / #", sha256: ok.release!.sha256 } }).refused).toMatch(/Unexpected actions\/runner version/)
    expect(buildAddPlan({ ...ok, release: { version: '2.338.0', sha256: 'abc' } }).refused).toMatch(/checksum/)
    expect(buildAddPlan({ ...ok, resolvers: ['1.1.1.1; reboot'] }).refused).toMatch(/resolver/)
    expect(buildAddPlan(ok).refused).toBeNull()
  })
})

