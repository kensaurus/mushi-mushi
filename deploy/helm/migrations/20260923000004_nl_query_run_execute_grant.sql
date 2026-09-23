-- Follow-up to 20260923000003: ALTER FUNCTION ... OWNER TO moves the old
-- owner's ACL entry to the new owner, so postgres (owner of the entry point
-- execute_readonly_query) lost EXECUTE on mushi_nl.run. Re-grant it as the
-- new owner.
grant usage on schema mushi_nl to postgres, mushi_nl_reader;
set local role mushi_nl_reader;
grant execute on function mushi_nl.run(text, uuid) to postgres;
reset role;
