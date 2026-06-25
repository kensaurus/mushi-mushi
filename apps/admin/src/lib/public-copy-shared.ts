/**
 * Copy shared between admin console and docs (connect Skills lane, login hero).
 * Mirror of apps/docs/lib/public-copy.ts — keep CONNECT_SKILLS in sync.
 */
import { MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'

export const CONNECT_SKILLS = {
  intro:
    'Skills are playbooks your editor can read on demand — bug triage, fix-and-ship, QA, security audit, and more.',
  whatAreSkillsTitle: 'What are skills?',
  whatAreSkillsBody:
    'SKILL.md playbooks live in GitHub repos and sync into Mushi so the right playbook surfaces when a report lands. Your agent reads them — nothing runs automatically.',
  learnMoreHref: 'https://kensaur.us/mushi-mushi/docs/sdks/skills',
  learnMoreLabel: 'Learn about skills →',
} as const

export const LOGIN_HERO = {
  cloudTagline: MUSHI_TAGLINE_V2.oneLiner,
  selfHostTagline: 'Sign in to your self-hosted Mushi console.',
} as const
