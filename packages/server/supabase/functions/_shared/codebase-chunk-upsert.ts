/**
 * FILE: packages/server/supabase/functions/_shared/codebase-chunk-upsert.ts
 * PURPOSE: Write project_codebase_files chunks without the 8s role timeout.
 *
 * The GitHub indexer upserts each changed chunk through PostgREST. That role
 * cancels statements at 8s (SQLSTATE 57014). A chunk whose embedding changes
 * updates idx_codebase_embedding_ivf_half, and a metadata refresh of 200 rows
 * holds those row locks long enough for the one-row upsert to be canceled
 * too (Sentry: path packages/server/src/__tests__/billing-rules.test.ts).
 *
 * Writes go through upsert_codebase_chunks, which sets its own 30s
 * statement_timeout (same hoist as write_codebase_graph). Refresh batches
 * stay at 20 rows and omit the embedding so an unchanged vector is not
 * rewritten. A null embedding in the payload keeps the stored one.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Rows per refresh call. 90 non-HOT updates took ~18s under HNSW; 20 fits. */
export const CODEBASE_CHUNK_UPSERT_BATCH = 20

/** SQL rejects a larger payload so one call cannot outgrow its 30s budget. */
export const CODEBASE_CHUNK_UPSERT_MAX = 25

export interface CodebaseChunkWrite {
  project_id: string
  file_path: string
  symbol_name: string | null
  signature: string | null
  line_start: number | null
  line_end: number | null
  language: string | null
  content_hash: string
  content_preview: string | null
  imports: string[]
  last_modified: string
  tombstoned_at: null
  /** Omit on refresh. Null keeps the stored vector. */
  embedding?: number[] | null
  embedding_model?: string | null
}

export interface CodebaseChunkWriteError {
  message: string
  code?: string
}

function chunkWriteKey(row: CodebaseChunkWrite): string {
  return `${row.project_id}\0${row.file_path}\0${row.symbol_name ?? ''}`
}

/**
 * One row per (project, path, symbol), last wins. ON CONFLICT cannot touch
 * the same row twice in one INSERT.
 */
export function dedupeChunkWrites(rows: CodebaseChunkWrite[]): CodebaseChunkWrite[] {
  const byKey = new Map<string, CodebaseChunkWrite>()
  for (const row of rows) byKey.set(chunkWriteKey(row), row)
  return [...byKey.values()]
}

/**
 * Upsert one batch. Empty input is a no-op. More than
 * CODEBASE_CHUNK_UPSERT_MAX rows is refused before the round trip.
 */
export async function upsertCodebaseChunks(
  db: SupabaseClient,
  rows: CodebaseChunkWrite[],
): Promise<{ error: CodebaseChunkWriteError | null }> {
  if (rows.length === 0) return { error: null }
  const batch = dedupeChunkWrites(rows)
  if (batch.length > CODEBASE_CHUNK_UPSERT_MAX) {
    return {
      error: {
        code: '22023',
        message: `upsert_codebase_chunks batch exceeds ${CODEBASE_CHUNK_UPSERT_MAX} rows`,
      },
    }
  }
  const { error } = await db.rpc('upsert_codebase_chunks', { p_rows: batch })
  if (!error) return { error: null }
  return { error: { message: error.message, code: error.code } }
}
