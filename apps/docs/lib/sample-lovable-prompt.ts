/**
 * The sample fix prompt for a chat builder (Lovable, Bolt), on /demo/diagnosis.
 *
 * It is the console builder's prompt (data/sample-fix-prompt.json, pinned by
 * apps/admin/.../fixPrompt.sample.test.ts) with only the lines a chat builder
 * cannot act on taken out: writing and running tests, and opening a pull
 * request. Nothing is added to the diagnosis. The pinned prompt itself is
 * never changed here.
 */

const CLOSING = [
  '## When you are done',
  'Tell me in plain words what you changed, so I can check it in the preview before I publish.',
  'If you are not confident the diagnosis is right, say what you checked and why instead of guessing.',
].join('\n')

export function lovableFixPrompt(fixPrompt: string): string {
  const cut = fixPrompt.indexOf('\n## When you are done')
  const body = (cut >= 0 ? fixPrompt.slice(0, cut) : fixPrompt)
    .split('\n')
    // "- A test covers it: …" in "Done when".
    .filter((line) => !/^- A test covers it\b/.test(line))
    // "…, and the existing test suite passes." at the end of a "Done when" line.
    .map((line) => line.replace(/, and the existing test suite passes\.$/, '.'))
    // "Add a test that …." as its own sentence in the suggested fix.
    .map((line) => line.replace(/\s*Add a test\b[^.]*\./g, ''))
    .join('\n')
    .trimEnd()
  return `${body}\n\n${CLOSING}\n`
}
