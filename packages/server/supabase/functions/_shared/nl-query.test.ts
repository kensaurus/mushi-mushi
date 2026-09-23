import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { sanitizeSql } from './nl-query.ts'

// The database (execute_readonly_query → mushi_nl.run as mushi_nl_reader) is
// the tenant boundary; these checks are the first layer. Each rejected case
// below is a shape that reached rows outside the caller's project before the
// 2026-09-23 fix.

const RAW = { tableAllowlist: true, requireProjectIdParam: true }

Deno.test('sanitizeSql keeps an ordinary scoped query', () => {
  const sql = sanitizeSql('select severity, count(*) as n from reports where project_id = $1 group by 1', RAW)
  assertEquals(sql, 'select severity, count(*) as n from reports where project_id = $1 group by 1\nLIMIT 100')
})

Deno.test('sanitizeSql rejects quoted identifiers (they slip past the schema check)', () => {
  assertThrows(
    () => sanitizeSql('select * from "vault"."decrypted_secrets" where $1 is not null', RAW),
    Error,
    'Quoted identifiers',
  )
  assertThrows(
    () => sanitizeSql('select count(*) as "Bug Count" from reports where project_id = $1', RAW),
    Error,
    'Quoted identifiers',
  )
})

Deno.test('sanitizeSql rejects reads of PostgREST request settings', () => {
  for (const sql of [
    "select current_setting('request.headers', true) as h from reports where project_id = $1",
    "select set_config('request.jwt.claims', '{}', true) from reports where project_id = $1",
    "select name from pg_settings where $1 is not null",
  ]) {
    assertThrows(() => sanitizeSql(sql, RAW), Error, 'disallowed')
  }
})

Deno.test('sanitizeSql rejects functions that run a query from a string', () => {
  assertThrows(
    () => sanitizeSql("select query_to_xml('select 1', true, false, '') from reports where project_id = $1", RAW),
    Error,
    'disallowed',
  )
})

Deno.test('sanitizeSql rejects restricted schemas, including net and the executor schema', () => {
  for (const sql of [
    'select * from vault.decrypted_secrets where $1 is not null',
    'select * from auth.users where $1 is not null',
    'select net.http_delete(url) from reports where project_id = $1',
    'select * from mushi_nl.run where $1 is not null',
  ]) {
    assertThrows(() => sanitizeSql(sql, RAW), Error)
  }
})
