/**
 * Terminal control sequences (colours, cursor moves, OSC titles) in text a
 * machine sent. Git hooks colour their output, and workers older than
 * @mushi-mushi/cli's stripVTControlCharacters pass stored it raw, so the
 * console showed failures like "Secret scan... \u001b[32;1mOK\u001b[0m".
 * Same pattern as the strip-ansi package (CSI and OSC sequences).
 */
const TERMINAL_SEQUENCE = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  ].join('|'),
  'g',
)

export function stripTerminalCodes<T extends string | null | undefined>(text: T): T {
  if (typeof text !== 'string' || !/[\u001B\u009B]/.test(text)) return text
  return text.replace(TERMINAL_SEQUENCE, '') as T
}
