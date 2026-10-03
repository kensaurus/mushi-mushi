import { scanImportSpecifiers } from './imports'
import type { FileFingerprint, IndexedFileRow, UpdateClassification } from './types'

const EXPORT_RE = /^\s*export\s+/m

export function fingerprintFile(row: IndexedFileRow): FileFingerprint {
  const preview = row.content_preview ?? ''
  const importCount = row.imports ? row.imports.length : scanImportSpecifiers(preview).length
  const exportCount = (preview.match(EXPORT_RE) ?? []).length
  return {
    filePath: row.file_path,
    contentHash: row.content_hash ?? hashString(preview),
    exportCount,
    importCount,
  }
}

function hashString(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export function classifyFingerprintDelta(
  prior: FileFingerprint | undefined,
  next: FileFingerprint,
): UpdateClassification {
  if (!prior) return 'PARTIAL_UPDATE'
  if (prior.contentHash === next.contentHash) return 'SKIP'
  if (prior.exportCount !== next.exportCount || prior.importCount !== next.importCount) {
    return 'PARTIAL_UPDATE'
  }
  return 'PARTIAL_UPDATE'
}

export function classifyBatchUpdate(
  changedPaths: string[],
  prior: Map<string, FileFingerprint>,
  nextRows: IndexedFileRow[],
): { classification: UpdateClassification; paths: string[] } {
  const paths: string[] = []
  let anyStructural = false
  for (const row of nextRows) {
    if (changedPaths.length && !changedPaths.includes(row.file_path)) continue
    const fp = fingerprintFile(row)
    const cls = classifyFingerprintDelta(prior.get(row.file_path), fp)
    if (cls !== 'SKIP') {
      paths.push(row.file_path)
      if (cls === 'PARTIAL_UPDATE') anyStructural = true
    }
  }
  if (paths.length === 0) return { classification: 'SKIP', paths: [] }
  if (changedPaths.length > 50) return { classification: 'FULL_UPDATE', paths: changedPaths }
  return { classification: anyStructural ? 'PARTIAL_UPDATE' : 'SKIP', paths }
}
