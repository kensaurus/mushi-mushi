/**
 * FILE: packages/server/supabase/functions/_shared/secret-scan.ts
 * PURPOSE: One secret-pattern scan for text Mushi stores, shows to end users
 *          or feeds to an LLM: untrusted repo text (mushi.recipe.json, DTCG
 *          token files) and operator-authored text (the SDK assistant's
 *          knowledge corpus, reporter message templates). Pure, no I/O.
 *
 * The patterns live in secret-patterns.ts, shared byte-for-byte with the
 * CLI's bundle scan (`key_in_client_bundle`).
 */

import { SECRET_PATTERNS } from './secret-patterns.ts'

/** Returns the label of the first secret-shaped match, or null. */
export function scanForSecrets(text: string): string | null {
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(text)) return label
  }
  return null
}
