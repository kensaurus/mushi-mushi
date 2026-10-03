/**
 * FILE: packages/server/supabase/functions/_shared/design-rules.ts
 * PURPOSE: The deviance rules in force for a manifest: Mushi's defaults with
 *          the repo's `design.rules` layered on top. recipe-schema.ts
 *          re-exports both, so callers keep importing from there.
 *
 * Engine file: kept byte-identical in packages/cli/src/recipe/engine/
 * (see design-engine-types.ts). It takes the manifest as a loose shape so
 * the CLI, which has no zod, can pass the JSON it read.
 */

import { DESIGN_RULE_IDS, type DesignRuleConfig, type DesignRuleId, type FindingSeverity } from './design-engine-types.ts'

/** One `design.rules.<id>` entry of mushi.recipe.json. */
export interface DesignRuleDecl {
  enabled?: boolean
  severity?: FindingSeverity
  allowValues?: string[]
  allowFiles?: string[]
  primitives?: Record<string, string>
}

/** The part of a manifest the rules read. */
export interface DesignRulesManifest {
  design?: { rules?: Record<string, DesignRuleDecl | undefined> }
}

/** Mushi's defaults. raw_interactive_element is opt-in because it needs primitives. */
export const DEFAULT_DESIGN_RULES: Readonly<Record<DesignRuleId, { enabled: boolean; severity: FindingSeverity; allowValues: string[] }>> = {
  off_token_color: { enabled: true, severity: 'warn', allowValues: [] },
  off_token_font: { enabled: true, severity: 'warn', allowValues: [] },
  off_scale_spacing: { enabled: true, severity: 'info', allowValues: ['0', '0px'] },
  off_scale_radius: { enabled: true, severity: 'info', allowValues: ['0', '0px', '50%', '100%'] },
  contrast_below_aa: { enabled: true, severity: 'error', allowValues: [] },
  raw_interactive_element: { enabled: false, severity: 'info', allowValues: [] },
}

/** Manifest rules layered over the defaults, in DESIGN_RULE_IDS order. */
export function effectiveDesignRules(manifest: DesignRulesManifest | null): DesignRuleConfig[] {
  const declared = manifest?.design?.rules ?? {}
  return DESIGN_RULE_IDS.map((id) => {
    const d = DEFAULT_DESIGN_RULES[id]
    const m = declared[id]
    const cfg: DesignRuleConfig = {
      id,
      enabled: m?.enabled ?? d.enabled,
      severity: m?.severity ?? d.severity,
      allowValues: m?.allowValues ?? d.allowValues,
      allowFiles: m?.allowFiles ?? [],
      fromManifest: m !== undefined,
    }
    if (id === 'raw_interactive_element') cfg.primitives = m?.primitives ?? {}
    return cfg
  })
}
