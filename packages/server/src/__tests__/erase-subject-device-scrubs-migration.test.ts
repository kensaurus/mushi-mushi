/**
 * erase_subject() counted only deleted reporter_devices rows. The UPDATE that
 * strips the subject's token digests from shared device rows went uncounted,
 * so `devices` under-reported and a digest-only subject skipped the audit
 * row. 20261009170000 reads that UPDATE's row_count into v_m and adds it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261009170000_erase_subject_count_device_scrubs.sql'),
  'utf8',
)
const body = sql.replace(/^--.*$/gm, '')

describe('20261009170000_erase_subject_count_device_scrubs', () => {
  it('reads the reporter_devices UPDATE row count into v_m', () => {
    expect(body).toMatch(
      /update public\.reporter_devices d\s+set reporter_tokens = [^;]*;\s*get diagnostics v_m = row_count;/,
    )
  })

  it('adds v_m into devices before devices is reported and totalled', () => {
    expect(body).toMatch(
      /get diagnostics v_m = row_count;\s*v_n := v_n \+ v_m;\s*v_out := v_out \|\| jsonb_build_object\('devices', v_n\); v_total := v_total \+ v_n;/,
    )
  })
})
