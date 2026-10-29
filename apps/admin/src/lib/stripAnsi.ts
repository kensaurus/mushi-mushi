/**
 * FILE: apps/admin/src/lib/stripAnsi.ts
 * PURPOSE: Drop terminal color codes so lib code can clean a stored error
 *          without importing a component module.
 */

/**
 * Drop terminal color and cursor sequences so hook output can be read as text.
 * Lefthook's border is truecolor `\u001b[38;2;56;56;56m`; leaving it in a
 * report makes the push failure unreadable.
 */
export function stripAnsi(text: string): string {
  return text
    // A double-encoded copy stores the six characters "\u001b" instead of ESC.
    .replace(/\\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[@-_]/g, '')
}
