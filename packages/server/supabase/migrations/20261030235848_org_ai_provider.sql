-- Which model family an organization's AI work runs on (ADR 0039 amendment,
-- 2026-10-31). 'anthropic' (default) keeps today's order: Claude first,
-- OpenAI as the fallback. 'openai' hands out no Claude key at all, so every
-- stage uses the organization's OpenAI keys, the PR review included. The owner
-- asked for it when the Claude credits ran low.
alter table public.organizations
  add column if not exists ai_provider text not null default 'anthropic';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_ai_provider_check') then
    alter table public.organizations
      add constraint organizations_ai_provider_check check (ai_provider in ('anthropic', 'openai'));
  end if;
end $$;

comment on column public.organizations.ai_provider is
  'Model family for AI work: anthropic (Claude first, OpenAI fallback) or openai (no Claude key is used, PR review included). ADR 0039 amendment 2026-10-31.';
