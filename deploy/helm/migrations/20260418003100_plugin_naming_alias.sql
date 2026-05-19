-- =============================================================================
-- Naming alias view: `plugin_marketplace` over `plugin_registry`.
--
-- The DB ships `plugin_registry` (see 20260418001700_plugin_marketplace.sql), but
-- product copy and several historical references call this surface
-- "plugin_marketplace". Renaming the table is a breaking change for installed
-- catalogs, so we expose a read-through alias view instead.
--
-- The view inherits RLS from the base table.
-- =============================================================================

create or replace view plugin_marketplace as
  select
    slug,
    name,
    short_description,
    long_description,
    publisher,
    homepage_url,
    source_url,
    manifest,
    required_scopes,
    install_count,
    category,
    is_official,
    is_listed,
    created_at,
    updated_at
  from plugin_registry;

comment on view plugin_marketplace is
  'Read-through alias for plugin_registry. Use the base table for writes.';

-- Optional: revoke direct anon writes (the underlying table policies still apply).
revoke insert, update, delete on plugin_marketplace from anon, authenticated;
grant select on plugin_marketplace to anon, authenticated;
