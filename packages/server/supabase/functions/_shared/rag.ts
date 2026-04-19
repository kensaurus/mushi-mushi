import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createEmbedding } from './embeddings.ts'
import { log } from './logger.ts'

const ragLog = log.child('rag')

export interface CodeContext {
  filePath: string
  preview: string
  componentTag?: string
  similarity: number
  symbolName?: string | null
  signature?: string | null
  lineStart?: number | null
  lineEnd?: number | null
}

export async function getRelevantCode(
  db: SupabaseClient,
  projectId: string,
  extraction: { symptom?: string; action?: string; component?: string },
): Promise<CodeContext[]> {
  const { data: settings } = await db
    .from('project_settings')
    .select('codebase_index_enabled')
    .eq('project_id', projectId)
    .single()

  if (!settings?.codebase_index_enabled) return []

  const queryText = [extraction.symptom, extraction.action, extraction.component]
    .filter(Boolean)
    .join(' ')

  if (!queryText.trim()) return []

  try {
    const embedding = await createEmbedding(queryText, { projectId })

    const { data: files } = await db.rpc('match_codebase_files', {
      query_embedding: embedding,
      match_project: projectId,
      match_count: 5,
    })

    return (files ?? []).map((f: Record<string, unknown>) => ({
      filePath: f.file_path as string,
      preview: f.content_preview as string,
      componentTag: f.component_tag as string | undefined,
      similarity: f.similarity as number,
      symbolName: (f.symbol_name as string | null | undefined) ?? null,
      signature: (f.signature as string | null | undefined) ?? null,
      lineStart: (f.line_start as number | null | undefined) ?? null,
      lineEnd: (f.line_end as number | null | undefined) ?? null,
    }))
  } catch (err) {
    ragLog.error('Failed to retrieve code context', { err: String(err) })
    return []
  }
}

export function formatCodeContext(files: CodeContext[]): string {
  if (!files.length) return ''

  return files
    .map(f => {
      const head = f.symbolName
        ? `--- ${f.filePath}:${f.lineStart ?? '?'}-${f.lineEnd ?? '?'} :: ${f.symbolName} (similarity: ${f.similarity.toFixed(2)}) ---`
        : `--- ${f.filePath} (similarity: ${f.similarity.toFixed(2)}) ---`
      return `${head}\n${f.signature ? `${f.signature}\n` : ''}${f.preview}`
    })
    .join('\n\n')
}
