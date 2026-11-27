/**
 * Runs migration 20261127140000_security_proof_release_kits on real Postgres
 * (PGlite) against a minimal stub of the tables it alters, twice (it must be
 * idempotent), and checks what ADR 0074 relies on: the new tables and
 * their member-read / service-write policies, `security_scan` appended to
 * reports_source_check without dropping a source, one open security_scan
 * report per (app, pattern_key), the release commit check and the
 * release-kits bucket.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(resolve(__dirname, '../../supabase/migrations/20261127140000_security_proof_release_kits.sql'), 'utf8')
const P = '1000000a-0000-4000-8000-000000000000'
const R = '2000000a-0000-4000-8000-000000000000'

let db: PGlite

describe('migration 20261127140000_security_proof_release_kits on Postgres', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.waitReady
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema if not exists private;
      create schema if not exists storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create function private.is_project_member(p uuid) returns boolean language sql stable as $$ select true $$;
      create table public.projects (id uuid primary key, name text);
      create table public.project_settings (project_id uuid primary key references public.projects(id));
      create table public.releases (id uuid primary key, project_id uuid references public.projects(id), version text, status text default 'draft');
      create table public.reports (
        id uuid primary key default gen_random_uuid(),
        project_id uuid references public.projects(id),
        source text,
        status text,
        pattern_key text,
        parent_report_id uuid,
        constraint reports_source_check check (source in ('sdk', 'security_advisory', 'ux_scorecard', 'widget'))
      );
      insert into public.projects values ('${P}', 'Glot');
      insert into public.project_settings values ('${P}');
      insert into public.releases (id, project_id, version) values ('${R}', '${P}', '1.4.0');
    `)
    await db.exec(MIGRATION)
    // Idempotent: a second apply changes nothing and does not fail.
    await db.exec(MIGRATION)
  }, 60_000)

  afterAll(async () => {
    await db?.close()
  })

  it('creates the four tables with member SELECT and service-role write policies', async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies where tablename in ('security_scan_runs','security_scan_findings','release_kits','release_kit_assets') order by 1, 2`,
    )
    expect(rows.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([
      'release_kit_assets.release_kit_assets_member_select', 'release_kit_assets.release_kit_assets_service_write',
      'release_kits.release_kits_member_select', 'release_kits.release_kits_service_write',
      'security_scan_findings.security_scan_findings_member_select', 'security_scan_findings.security_scan_findings_service_write',
      'security_scan_runs.security_scan_runs_member_select', 'security_scan_runs.security_scan_runs_service_write',
    ])
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname in ('security_scan_runs','security_scan_findings','release_kits','release_kit_assets')`,
    )
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true)
  })

  it('appends security_scan to reports_source_check and keeps every existing source', async () => {
    const { rows } = await db.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'reports_source_check'`)
    for (const s of ['sdk', 'security_advisory', 'ux_scorecard', 'widget', 'security_scan']) expect(rows[0].def).toContain(`'${s}'`)
    await db.exec(`insert into public.reports (project_id, source, status, pattern_key) values ('${P}', 'security_scan', 'classified', 'security_scan:abc')`)
    await expect(db.exec(`insert into public.reports (project_id, source, status, pattern_key) values ('${P}', 'security_scan', 'new', 'security_scan:abc')`)).rejects.toThrow(/duplicate key/)
    // A closed one does not block a new open one.
    await db.exec(`insert into public.reports (project_id, source, status, pattern_key) values ('${P}', 'security_scan', 'fixed', 'security_scan:abc')`)
  })

  it('checks release commits, scan rows and kit assets', async () => {
    await expect(db.exec(`update public.releases set commit_sha = 'not-a-sha' where id = '${R}'`)).rejects.toThrow(/releases_commit_sha_check/)
    await db.exec(`update public.releases set commit_sha = 'abcdef1' where id = '${R}'`)
    await db.exec(`insert into public.security_scan_runs (project_id, lane, tool, status, commit_sha) values ('${P}', 'secrets', 'gitleaks', 'passed', 'abcdef1')`)
    await expect(db.exec(`insert into public.security_scan_runs (project_id, lane, tool, status) values ('${P}', 'secrets', 'semgrep', 'passed')`)).rejects.toThrow(/check/)
    await db.exec(`insert into public.release_kits (release_id, project_id) values ('${R}', '${P}')`)
    await expect(db.exec(`insert into public.release_kits (release_id, project_id) values ('${R}', '${P}')`)).rejects.toThrow(/duplicate key/)
    const kit = (await db.query<{ id: string }>(`select id from public.release_kits where release_id = '${R}'`)).rows[0].id
    await expect(db.exec(`insert into public.release_kit_assets (kit_id, project_id, kind, source, storage_path, mime, bytes) values ('${kit}', '${P}', 'clip', 'playwright', '${P}/${kit}/clip-1-a.webm', 'video/webm', 104857601)`)).rejects.toThrow(/check/)
  })

  it('adds the opt-in, capped kit settings and the private release-kits bucket', async () => {
    const s = await db.query<Record<string, unknown>>(`select security_reports_daily_limit, release_kit_clips_enabled, release_kit_clip_max_seconds, release_kit_clip_max_mb from public.project_settings`)
    expect(s.rows[0]).toEqual({ security_reports_daily_limit: 10, release_kit_clips_enabled: false, release_kit_clip_max_seconds: 30, release_kit_clip_max_mb: 25 })
    const b = await db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'release-kits'`)
    expect(b.rows[0].public).toBe(false)
    expect(Number(b.rows[0].file_size_limit)).toBe(104857600)
    expect(b.rows[0].allowed_mime_types).toContain('application/json')
  })
})
