/**
 * PGlite runs one backend, so a sequential claim never waits on the row lock.
 * These probes use a real Postgres with one connection per caller.
 *
 * Opt-in: MUSHI_SERVER_PG_INTEGRATION=1
 *   pnpm --filter @mushi-mushi/server test:integration
 * The ordinary suite does not load this file. The runner that sets the flag
 * must provide Podman or Docker. The container is always postgres:17-alpine.
 *
 * A bucket already at the cap must raise rate_limit_exceeded while another
 * transaction still holds the row. Callers that all read a below-cap count
 * and then block on the upsert must not admit more than the cap, must not
 * report a claim they did not store, and must not come back as
 * statement_timeout once the lock is released.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pgIntegrationEnabled, resolvePostgresImage } from './scoped-rate-limit-pg.ts'

const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261031150000_scoped_rate_limit_claim_full_window.sql'),
  'utf8',
)

const NAME = `mushi-rl-claim-${process.pid}`

const START = `
set -eu
mkdir -p /tmp/pg
run_as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then
    su postgres -c "$1"
  else
    sh -c "$1"
  fi
}
if [ "$(id -u)" -eq 0 ]; then
  chown postgres:postgres /tmp/pg
fi
run_as_postgres 'initdb -D /tmp/pg --auth=trust --username=postgres --no-instructions' > /tmp/initdb.log 2>&1
cat >> /tmp/pg/postgresql.conf <<'EOF'
listen_addresses = ''
unix_socket_directories = '/tmp'
EOF
run_as_postgres 'pg_ctl -D /tmp/pg -l /tmp/pg.log -w start'
touch /tmp/pg.ready
while true; do sleep 3600; done
`

const SETUP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.scoped_rate_limits (
  user_id uuid not null,
  scope text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, scope, window_start)
);
${MIGRATION}
create extension if not exists dblink;
create table public.rl_barrier (
  id int primary key,
  release boolean not null
);
insert into public.rl_barrier values (1, false);
create table public.rl_probe (
  id text primary key,
  line text not null
);
create function public.rl_test_hold_lock(p_user uuid, p_scope text) returns int
language plpgsql as $fn$
begin
  perform request_count from public.scoped_rate_limits
   where user_id = p_user and scope = p_scope
   for update;
  if not found then
    raise exception 'rl_test_hold_lock found no row';
  end if;
  loop
    exit when (select release from public.rl_barrier where id = 1);
    perform pg_sleep(0.01);
  end loop;
  return 1;
end
$fn$;
`

function execFile(cmd: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      })
    })
    child.stdin.end(input ?? '')
  })
}

async function firstRuntime(): Promise<string> {
  let missing = 0
  for (const bin of ['podman', 'docker']) {
    try {
      const result = await execFile(bin, ['version'])
      if (result.code === 0) return bin
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') {
        missing += 1
        continue
      }
      throw error
    }
  }
  if (missing === 2) throw new Error('podman or docker is required for the multi-connection rate-limit test')
  throw new Error('podman and docker are installed but neither reported a version')
}

function fields(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of line.trim().split(' ')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

const integration = pgIntegrationEnabled(process.env)

describe.skipIf(!integration)('scoped_rate_limit_claim under concurrent connections', () => {
  let bin = ''

  beforeAll(async () => {
    bin = await firstRuntime()
    await execFile(bin, ['rm', '-f', NAME])
    const listed = await execFile(bin, ['images', '--format', '{{.Repository}}:{{.Tag}}'])
    if (listed.code !== 0) throw new Error(listed.stderr || listed.stdout)
    const cached = listed.stdout.split('\n')
    const { image, local } = resolvePostgresImage(cached)
    const started = await execFile(bin, [
      'run',
      '-d',
      '--name',
      NAME,
      '--pull',
      local ? 'never' : 'missing',
      '--entrypoint',
      'sh',
      image,
      '-c',
      START,
    ])
    if (started.code !== 0) throw new Error(started.stderr || started.stdout)

    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const probe = await execFile(bin, ['exec', NAME, 'test', '-f', '/tmp/pg.ready'])
      if (probe.code === 0) {
        ready = true
        break
      }
      const state = await execFile(bin, ['inspect', '-f', '{{.State.Running}}', NAME])
      if (state.stdout.trim() === 'false') break
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    }
    if (!ready) {
      const logs = await execFile(bin, ['logs', NAME])
      throw new Error(`postgres did not become ready\n${logs.stdout}\n${logs.stderr}`)
    }

    const setup = await psql(bin, SETUP)
    if (setup.code !== 0) throw new Error(setup.stderr || setup.stdout)
  }, 180_000)

  afterAll(async () => {
    if (!bin) return
    await execFile(bin, ['rm', '-f', NAME])
  })

  it('rejects a locked full bucket without waiting out statement_timeout', async () => {
    const result = await psql(bin, fullBucketSql(8))
    expect(result.code, result.stderr || result.stdout).toBe(0)
    const row = fields(result.stdout)
    expect(row.held, result.stdout).toBe('true')
    expect(row.ok, result.stdout).toBe('0')
    expect(row.limit, result.stdout).toBe('8')
    expect(row.timeout, result.stdout).toBe('0')
    expect(row.other, result.stdout).toBe('0')
    expect(Number(row.ms), result.stdout).toBeLessThan(1500)
  }, 60_000)

  it('admits exactly the cap when a below-cap burst races on the row lock', async () => {
    const cap = 5
    const workers = 20
    const result = await psql(bin, burstSql(workers, cap))
    expect(result.code, result.stderr || result.stdout).toBe(0)
    const row = fields(result.stdout)
    expect(row.waiting, result.stdout).toBe(String(workers))
    expect(row.ok, result.stdout).toBe(String(cap))
    expect(row.limit, result.stdout).toBe(String(workers - cap))
    expect(row.timeout, result.stdout).toBe('0')
    expect(row.other, result.stdout).toBe('0')
    expect(row.stored, result.stdout).toBe(String(cap))
    expect(row.vals, result.stdout).toBe('1,2,3,4,5')
    expect(Number(row.drain_ms), result.stdout).toBeLessThan(3000)
  }, 60_000)
})

function psql(bin: string, sql: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return execFile(
    bin,
    ['exec', '-i', '-u', 'postgres', NAME, 'psql', '-h', '/tmp', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-tA'],
    sql,
  )
}

function fullBucketSql(workers: number): string {
  return `
set client_min_messages = warning;
do $body$
declare
  actor uuid := '10000000-0000-4000-8000-0000000000aa';
  bucket text := 'full_locked';
  n_workers int := ${workers};
  i int;
  j int;
  done int;
  msg text;
  ok_n int := 0;
  lim_n int := 0;
  to_n int := 0;
  other_n int := 0;
  t0 timestamptz;
  held boolean := false;
  locked boolean := false;
begin
  perform dblink_connect('flag', 'host=/tmp dbname=postgres user=postgres');
  perform dblink_exec('flag', format('delete from public.scoped_rate_limits where user_id = %L and scope = %L', actor, bucket));
  for i in 1..3 loop
    perform * from dblink('flag', format(
      'select public.scoped_rate_limit_claim(%L::uuid, %L, 3, interval ''1 hour'')', actor, bucket)) as t(n int);
  end loop;
  perform dblink_exec('flag', 'update public.rl_barrier set release = false where id = 1');
  perform dblink_connect('locker', 'host=/tmp dbname=postgres user=postgres');
  perform dblink_send_query('locker', format('select public.rl_test_hold_lock(%L::uuid, %L)', actor, bucket));
  for i in 1..100 loop
    select exists (
      select 1 from pg_locks l
       where l.relation = 'public.scoped_rate_limits'::regclass
         and l.granted and l.mode = 'RowShareLock' and l.pid <> pg_backend_pid()
    ) into locked;
    exit when locked;
    perform pg_sleep(0.02);
  end loop;
  if not locked then
    raise exception 'locker did not hold the full bucket: %', dblink_error_message('locker');
  end if;

  for i in 1..n_workers loop
    perform dblink_connect('w' || i, 'host=/tmp dbname=postgres user=postgres');
    perform dblink_exec('w' || i, 'set statement_timeout = ''800ms''');
  end loop;
  for i in 1..n_workers loop
    perform dblink_send_query('w' || i, format(
      'select public.scoped_rate_limit_claim(%L::uuid, %L, 3, interval ''1 hour'')', actor, bucket));
  end loop;

  t0 := clock_timestamp();
  done := 0;
  for i in 1..80 loop
    done := 0;
    for j in 1..n_workers loop
      if dblink_is_busy('w' || j) = 0 then done := done + 1; end if;
    end loop;
    exit when done = n_workers;
    perform pg_sleep(0.02);
  end loop;
  if done <> n_workers then
    raise exception 'full-bucket callers still running: %/%', done, n_workers;
  end if;
  select exists (
    select 1 from pg_locks l
     where l.relation = 'public.scoped_rate_limits'::regclass
       and l.granted and l.mode = 'RowShareLock' and l.pid <> pg_backend_pid()
  ) into held;

  for i in 1..n_workers loop
    perform * from dblink_get_result('w' || i, false) as t(n int);
    msg := dblink_error_message('w' || i);
    if msg = 'OK' then ok_n := ok_n + 1;
    elsif msg ilike '%statement timeout%' then to_n := to_n + 1;
    elsif msg ilike '%rate_limit_exceeded%' then lim_n := lim_n + 1;
    else other_n := other_n + 1;
    end if;
    perform dblink_disconnect('w' || i);
  end loop;

  perform dblink_exec('flag', 'update public.rl_barrier set release = true where id = 1');
  perform pg_sleep(0.05);
  perform * from dblink_get_result('locker', false) as t(n int);
  perform dblink_disconnect('locker');
  perform dblink_disconnect('flag');

  insert into public.rl_probe (id, line) values (
    'full',
    format(
      'held=%s ms=%s ok=%s limit=%s timeout=%s other=%s',
      case when held then 'true' else 'false' end,
      (extract(epoch from clock_timestamp() - t0) * 1000)::int,
      ok_n, lim_n, to_n, other_n
    )
  ) on conflict (id) do update set line = excluded.line;
end
$body$;
select line from public.rl_probe where id = 'full';
`
}

function burstSql(workers: number, cap: number): string {
  return `
set client_min_messages = warning;
do $body$
declare
  actor uuid := '20000000-0000-4000-8000-0000000000bb';
  bucket text := 'burst_low';
  n_workers int := ${workers};
  n_cap int := ${cap};
  i int;
  j int;
  waiting int := 0;
  done int := 0;
  got int;
  msg text;
  ok_n int := 0;
  lim_n int := 0;
  to_n int := 0;
  other_n int := 0;
  vals int[] := '{}';
  vals_txt text;
  stored int;
  t_release timestamptz;
  locked boolean := false;
begin
  perform dblink_connect('flag', 'host=/tmp dbname=postgres user=postgres');
  perform dblink_exec('flag', format('delete from public.scoped_rate_limits where user_id = %L and scope = %L', actor, bucket));
  perform dblink_exec('flag', format(
    'insert into public.scoped_rate_limits (user_id, scope, window_start, request_count) values (%L, %L, date_bin(interval ''1 hour'', now(), ''epoch''), 0)',
    actor, bucket));
  perform dblink_exec('flag', 'update public.rl_barrier set release = false where id = 1');
  perform dblink_connect('locker', 'host=/tmp dbname=postgres user=postgres');
  perform dblink_send_query('locker', format('select public.rl_test_hold_lock(%L::uuid, %L)', actor, bucket));
  for i in 1..100 loop
    select exists (
      select 1 from pg_locks l
       where l.relation = 'public.scoped_rate_limits'::regclass
         and l.granted and l.mode = 'RowShareLock' and l.pid <> pg_backend_pid()
    ) into locked;
    exit when locked;
    perform pg_sleep(0.02);
  end loop;
  if not locked then
    raise exception 'locker did not hold the below-cap bucket: %', dblink_error_message('locker');
  end if;

  for i in 1..n_workers loop
    perform dblink_connect('w' || i, 'host=/tmp dbname=postgres user=postgres');
    perform dblink_exec('w' || i, 'set statement_timeout = ''8s''');
  end loop;
  for i in 1..n_workers loop
    perform dblink_send_query('w' || i, format(
      'select public.scoped_rate_limit_claim(%L::uuid, %L, %s, interval ''1 hour'')', actor, bucket, n_cap));
  end loop;

  for i in 1..200 loop
    -- The locker holds its row lock and sleeps (wait event Timeout).
    -- Every claim blocked on that row is a Lock wait. The top-level query
    -- text is not a reliable filter: inside the function Postgres may show
    -- the statement that is waiting instead of the call.
    select count(*) into waiting from pg_stat_activity
     where pid <> pg_backend_pid()
       and backend_type = 'client backend'
       and wait_event_type = 'Lock';
    exit when waiting >= n_workers;
    perform pg_sleep(0.02);
  end loop;
  if waiting < n_workers then
    raise exception 'only % of % claims were waiting on the lock; %', waiting, n_workers, (
      select string_agg(
        coalesce(state, '-') || '/' || coalesce(wait_event_type, '-') || '/' || coalesce(wait_event, '-') || ':' || left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 80),
        ' || '
      )
      from pg_stat_activity
      where backend_type = 'client backend' and pid <> pg_backend_pid()
    );
  end if;

  t_release := clock_timestamp();
  perform dblink_exec('flag', 'update public.rl_barrier set release = true where id = 1');
  for i in 1..200 loop
    done := 0;
    for j in 1..n_workers loop
      if dblink_is_busy('w' || j) = 0 then done := done + 1; end if;
    end loop;
    exit when done = n_workers;
    perform pg_sleep(0.02);
  end loop;
  if done <> n_workers then
    raise exception 'burst callers still running: %/%', done, n_workers;
  end if;

  for i in 1..n_workers loop
    got := null;
    select t.n into got from dblink_get_result('w' || i, false) as t(n int);
    msg := dblink_error_message('w' || i);
    if msg = 'OK' then
      ok_n := ok_n + 1;
      vals := vals || coalesce(got, -1);
    elsif msg ilike '%statement timeout%' then to_n := to_n + 1;
    elsif msg ilike '%rate_limit_exceeded%' then lim_n := lim_n + 1;
    else other_n := other_n + 1;
    end if;
    perform dblink_disconnect('w' || i);
  end loop;

  select coalesce(string_agg(v::text, ',' order by v), '') into vals_txt from unnest(vals) as v;
  select request_count into stored from public.scoped_rate_limits where user_id = actor and scope = bucket;

  perform * from dblink_get_result('locker', false) as t(n int);
  perform dblink_disconnect('locker');
  perform dblink_disconnect('flag');

  insert into public.rl_probe (id, line) values (
    'burst',
    format(
      'waiting=%s drain_ms=%s ok=%s limit=%s timeout=%s other=%s stored=%s vals=%s',
      waiting,
      (extract(epoch from clock_timestamp() - t_release) * 1000)::int,
      ok_n, lim_n, to_n, other_n, stored, vals_txt
    )
  ) on conflict (id) do update set line = excluded.line;
end
$body$;
select line from public.rl_probe where id = 'burst';
`
}
