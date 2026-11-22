-- Self-host parity (2026-11-19): hosted has these updated_at triggers from outside the
-- migrations, so a fresh install (docker compose / Helm / `mushi selfhost up`) never kept
-- updated_at current on these tables. Create each one only where it is missing and its
-- function exists; definitions copied from hosted (pg_get_triggerdef).
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('public.reports',                'reports_updated_at',                     'set_updated_at()'),
      ('public.reporter_devices',       'trg_reporter_devices_updated_at',        'update_updated_at_column()'),
      ('public.reporter_notifications', 'trg_reporter_notifications_updated_at',  'update_updated_at_column()'),
      ('public.reporter_reputation',    'set_reporter_reputation_updated_at',     'update_updated_at_column()'),
      ('public.support_tickets',        'trg_support_tickets_updated_at',         'set_support_tickets_updated_at()')
    ) as v(tbl, trg, fn)
  loop
    if to_regclass(t.tbl) is not null
       and to_regprocedure('public.' || t.fn) is not null
       and not exists (select 1 from pg_trigger where tgname = t.trg and tgrelid = t.tbl::regclass) then
      execute format('create trigger %I before update on %s for each row execute function public.%s', t.trg, t.tbl, t.fn);
    end if;
  end loop;
end $$;
