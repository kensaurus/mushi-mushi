-- ============================================================================
-- 20260922000017_inventory_drift_watch_timeout
--
-- The HTTP watchdog (20260922000010) showed mushi-inventory-drift-watch hitting
-- its 30 s pg_net timeout: inventory-propose's drift_watch pass runs longer,
-- so the job's outcome was never known. Wait up to the edge runtime's 150 s
-- wall clock instead, so the watchdog records the real status code.
-- ============================================================================

select cron.schedule('mushi-inventory-drift-watch', '24 * * * *',
  $$select mushi.cron_http_post('inventory-propose', jsonb_build_object('mode', 'drift_watch'), 150000);$$);
