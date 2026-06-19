/**
 * Plain-language guide for Ask Your Data (NL + SQL query console).
 */

export const QUERY_EXPLAINER_SUMMARY =
  'Ask Your Data runs read-only queries against approved project tables. NL mode drafts SQL for you; raw mode runs your own SELECT. Every run is logged with latency and row count.'

export const QUERY_MODES = [
  {
    id: 'nl',
    label: 'Natural language',
    plain: 'Describe what you want in plain English — Mushi drafts a sandboxed SELECT.',
    redMeans: 'Repeated errors usually mean schema drift or a prompt that references a column that no longer exists.',
  },
  {
    id: 'raw',
    label: 'Raw SQL',
    plain: 'Write SELECT statements directly against the allow-listed tables for this project.',
    redMeans: 'Syntax or permission errors surface inline — only read queries are permitted.',
  },
  {
    id: 'history',
    label: 'History & pins',
    plain: 'Re-run prior queries or pin team favorites so recurring investigations stay one click away.',
    redMeans: 'A spike in 24h errors in History means upstream schema or BYOK issues — check Settings → API Keys.',
  },
] as const

export function isQueryGuideExpanded(errors24h: number): boolean {
  return errors24h > 0
}
