/**
 * FILE: packages/cli/src/runner/hooks.ts
 * PURPOSE: The job hook scripts `mushi runner hooks install` writes into a
 *          runner folder (Plan 022 Phase 3). GitHub's runner runs them before
 *          and after every job (ACTIONS_RUNNER_HOOK_JOB_STARTED / _COMPLETED,
 *          https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts).
 *
 *          Each script reads the runner's own cgroup (memory.peak, memory.max,
 *          memory.events oom_kill), swap and load, and POSTs one `kind: 'job'`
 *          sample to /v1/ingest/runner. Rules the templates keep:
 *          - never fail a job: all work runs in a function whose result is
 *            ignored, and the script always ends with `exit 0`;
 *          - the API key is read from `mushi-hooks/key` (0600) and handed to
 *            curl on stdin as a header, so it is never in the script, never in
 *            a process argument and never echoed;
 *          - curl gives up after 5 seconds;
 *          - GitHub-provided values are reduced to safe characters before
 *            they go into the JSON body.
 *
 *          Pure: templates and the .env merge are strings in, strings out.
 */

export const HOOKS_DIR_NAME = 'mushi-hooks'
export const HOOK_ENV_STARTED = 'ACTIONS_RUNNER_HOOK_JOB_STARTED'
export const HOOK_ENV_COMPLETED = 'ACTIONS_RUNNER_HOOK_JOB_COMPLETED'

/** A value safe inside single quotes in sh (we only embed a URL and a hex id). */
function shSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function hookScript(opts: { phase: 'started' | 'completed'; endpoint: string; hostId: string }): string {
  if (!/^[0-9a-f]{64}$/.test(opts.hostId)) throw new Error('host id must be 64 hex characters')
  if (!/^https?:\/\/[^\s'"]+$/.test(opts.endpoint)) throw new Error('endpoint must be an http(s) URL')
  return `#!/bin/sh
# Mushi runner job hook (job ${opts.phase}). Written by \`mushi runner hooks install\`.
# Sends this job's memory peak, memory limit, out-of-memory kills, swap and
# load to Mushi, so a job killed by the machine reads "test machine stopped",
# not "your code failed". It never fails the job: it always exits 0.
# The API key is read from ./key (mode 0600); it is never printed.

PHASE=${opts.phase}
ENDPOINT=${shSingleQuoted(opts.endpoint.replace(/\/+$/, ''))}
HOST_ID=${opts.hostId}

safe() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._/-' | cut -c1-100; }
safe_name() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._/ -' | cut -c1-100; }
digits() { printf '%s' "$1" | tr -cd '0-9' | cut -c1-20; }
num_or_null() { case "$1" in ''|*[!0-9.]*) printf 'null' ;; *) printf '%s' "$1" ;; esac; }
mb() { case "$1" in ''|max|*[!0-9]*) printf '' ;; *) printf '%s' $(( $1 / 1048576 )) ;; esac; }

mushi_hook() {
  HOOK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || return 0
  [ -r "$HOOK_DIR/key" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0

  CG=$(sed -n 's/^0:://p' /proc/self/cgroup 2>/dev/null | head -n 1)
  CGDIR="/sys/fs/cgroup$CG"
  PEAK=$(mb "$(cat "$CGDIR/memory.peak" 2>/dev/null)")
  MAX=$(mb "$(cat "$CGDIR/memory.max" 2>/dev/null)")
  if [ -z "$MAX" ]; then MAX=$(mb "$(cat "$(dirname "$CGDIR")/memory.max" 2>/dev/null)"); fi
  OOM=$(sed -n 's/^oom_kill \\([0-9]*\\)$/\\1/p' "$CGDIR/memory.events" 2>/dev/null | head -n 1)
  SWAP=$(awk '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{if (t!="") printf "%d", (t-f)/1024}' /proc/meminfo 2>/dev/null)
  LOAD=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null)

  REPO=$(safe "$GITHUB_REPOSITORY")
  RUNNER=$(safe_name "$RUNNER_NAME")
  JOB=$(safe "$GITHUB_JOB")
  RUN_ID=$(digits "$GITHUB_RUN_ID")
  ATTEMPT=$(digits "$GITHUB_RUN_ATTEMPT")
  [ -n "$REPO" ] && [ -n "$RUN_ID" ] && [ -n "$JOB" ] || return 0
  AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  BODY=$(printf '{"kind":"job","host_id":"%s","runner_name":"%s","repo":"%s","run_id":%s,"run_attempt":%s,"job_key":"%s","phase":"%s","at":"%s","mem_peak_mb":%s,"mem_max_mb":%s,"oom_kills":%s,"swap_used_mb":%s,"load1":%s}' \\
    "$HOST_ID" "$RUNNER" "$REPO" "$RUN_ID" "\${ATTEMPT:-1}" "$JOB" "$PHASE" "$AT" \\
    "$(num_or_null "$PEAK")" "$(num_or_null "$MAX")" "$(num_or_null "$OOM")" "$(num_or_null "$SWAP")" "$(num_or_null "$LOAD")")

  # The key goes to curl on stdin as a header (printf is a shell builtin, so
  # it never appears in a process list).
  printf 'X-Mushi-Api-Key: %s\\n' "$(cat "$HOOK_DIR/key")" | curl -sS --max-time 5 -o /dev/null \\
    -H @- -H 'Content-Type: application/json' -X POST --data "$BODY" "$ENDPOINT/v1/ingest/runner"
}

mushi_hook >/dev/null 2>&1 || true
exit 0
`
}

export interface EnvMergeResult {
  /** The new .env text, or null when nothing changes. */
  text: string | null
  /** Keys already pointing at a different script (someone else's hook). */
  conflicts: Array<{ key: string; current: string }>
}

/**
 * Add the two hook lines to a runner's .env idempotently. A key already set
 * to our script is left alone; a key set to another script is a conflict and
 * is only replaced with `force`.
 */
export function mergeRunnerEnv(existing: string, hooks: { started: string; completed: string }, force = false): EnvMergeResult {
  const wanted: Array<[string, string]> = [
    [HOOK_ENV_STARTED, hooks.started],
    [HOOK_ENV_COMPLETED, hooks.completed],
  ]
  const lines = existing.length ? existing.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : []
  const conflicts: EnvMergeResult['conflicts'] = []
  let changed = false
  for (const [key, value] of wanted) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`))
    if (idx === -1) {
      lines.push(`${key}=${value}`)
      changed = true
      continue
    }
    const current = lines[idx]!.slice(key.length + 1)
    if (current === value) continue
    if (!force) {
      conflicts.push({ key, current })
      continue
    }
    lines[idx] = `${key}=${value}`
    changed = true
  }
  return { text: changed && conflicts.length === 0 ? `${lines.join('\n')}\n` : null, conflicts }
}
