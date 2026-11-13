// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/cli/src/template.ts
 * PURPOSE: `npx mushi-mushi --template <vue|svelte|node> [dir]` — copy a
 *          minimal starter app from packages/cli/templates/<id>. Moved here
 *          from create-mushi-mushi (ADR 0060 Phase 1b), which now forwards to
 *          the same code. Dependency-free (plain cpSync): the starter's own
 *          README covers `npm install` and `npx mushi-mushi` for credentials,
 *          so no wizard run happens here.
 */

import { cpSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Starter templates shipped inside the published package (templates/<id>/). */
export const TEMPLATE_IDS = ['vue', 'svelte', 'node'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value)
}

/**
 * The templates folder sits next to `src/` and `dist/`, so this resolves the
 * same from source (tests), the built entry and any tsup chunk in dist/.
 */
function templateDir(id: TemplateId): string {
  return fileURLToPath(new URL(`../templates/${id}`, import.meta.url))
}

/**
 * Copy templates/<id> into `targetArg` (default `mushi-<id>-app`, relative to
 * `cwd`) and return the message to print. Throws when the target exists.
 */
export function scaffoldTemplate(
  id: TemplateId,
  targetArg: string | undefined,
  cwd: string = process.cwd(),
): string {
  const relTarget = targetArg ?? `mushi-${id}-app`
  const targetDir = resolve(cwd, relTarget)
  if (existsSync(targetDir)) {
    throw new Error(`target directory already exists: ${targetDir}`)
  }
  cpSync(templateDir(id), targetDir, { recursive: true })
  // npm strips `.gitignore` from published tarballs, so templates ship it as
  // `gitignore`. Restore the dot so the .env the next step writes is ignored.
  renameSync(join(targetDir, 'gitignore'), join(targetDir, '.gitignore'))
  return (
    `Scaffolded the ${id} starter into ${targetDir}\n\n` +
    'Next steps:\n' +
    `  cd "${relTarget}"\n` +
    '  npm install\n' +
    '  npx mushi-mushi     # browser sign-in, writes your env vars\n' +
    `  ${id === 'node' ? 'npm start' : 'npm run dev'}\n`
  )
}
