-- Follow-up to 20260923000003: ALTER FUNCTION ... OWNER TO moves the old
-- owner's ACL entry to the new owner, so postgres (owner of the entry point
-- execute_readonly_query) lost EXECUTE on mushi_nl.run. Re-grant it as the
-- new owner.
--
-- SET ROLE, not SET LOCAL ROLE: the Helm migrate job runs each file with
-- `psql -f` and no transaction block, where SET LOCAL only warns and does
-- nothing. The GRANT then ran as postgres, which holds no grant option on a
-- function it does not own, and granted nothing (another warning).
grant usage on schema mushi_nl to postgres, mushi_nl_reader;
set role mushi_nl_reader;
grant execute on function mushi_nl.run(text, uuid) to postgres;
reset role;
