export type DiffLine = { kind: 'eq' | 'add' | 'del'; text: string }

/**
 * Tiny LCS line-diff. Optimised for small inputs (a single prompt template,
 * typically < 200 lines), so the O(n*m) table is fine. Avoids pulling in a
 * full diff library when we only need add/del/eq markers for syntax highlighting.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const n = aLines.length
  const m = bLines.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ kind: 'eq', text: aLines[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: aLines[i] })
      i++
    } else {
      out.push({ kind: 'add', text: bLines[j] })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: aLines[i++] })
  while (j < m) out.push({ kind: 'add', text: bLines[j++] })
  return out
}
