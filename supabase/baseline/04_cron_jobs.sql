-- Baseline snapshot of production pg_cron jobs (normalised formatting; behaviour identical to what was read on 2026-11-20).
-- Every job authenticates with the shared `ingest_key` read from public.app_secrets inside SQL; no literal secret appears here.
-- Reference only: do not run against production (cron.schedule with an existing name would replace the job).

-- ccil-fpi-daily
select cron.schedule('ccil-fpi-daily', '0 13 * * 1-5', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/ccil-fpi', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key')), timeout_milliseconds := 120000);$job$);
-- directory-ifsca
select cron.schedule('directory-ifsca', '50 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/directory?only=ifsca', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'x-region', 'ap-south-1', 'content-type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 180000);$job$);
-- directory-nsdl
select cron.schedule('directory-nsdl', '40 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/directory?only=nsdl', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'x-region', 'ap-south-1', 'content-type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 180000);$job$);
-- flows-nsdl
select cron.schedule('flows-nsdl', '30 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/flows?only=nsdl', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type', 'application/json', 'x-region', 'ap-south-1'), body := '{}'::jsonb, timeout_milliseconds := 150000);$job$);
-- flows-rbi
select cron.schedule('flows-rbi', '10 6 * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/flows?only=rbi', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type', 'application/json', 'x-region', 'ap-south-1'), body := '{}'::jsonb, timeout_milliseconds := 150000);$job$);
-- fx-daily
select cron.schedule('fx-daily', '20 12 * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/fx', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key')), timeout_milliseconds := 120000);$job$);
-- ifsca-regs-hourly
select cron.schedule('ifsca-regs-hourly', '20 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/ifsca-regs', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000);$job$);
-- ingest-every-30-min  [named 30-min, runs hourly]
select cron.schedule('ingest-every-30-min', '15 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/ingest', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 150000);$job$);
-- nsdl-limits-daily
select cron.schedule('nsdl-limits-daily', '50 13 * * 1-5', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/nsdl-limits', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key')), timeout_milliseconds := 180000);$job$);
-- nse-calendar-daily
select cron.schedule('nse-calendar-daily', '40 1 * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/desk', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key')), timeout_milliseconds := 180000);$job$);
-- odi-monthly  [INACTIVE in production]
select cron.schedule('odi-monthly', '30 6 * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/odi', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 300000);$job$);
-- private-deals-hourly
select cron.schedule('private-deals-hourly', '45 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/private', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000);$job$);
-- rbi-reserves-weekly
select cron.schedule('rbi-reserves-weekly', '30 13 * * 5,6', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/reserves', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key')), timeout_milliseconds := 300000);$job$);
-- registry-collect-hourly
select cron.schedule('registry-collect-hourly', '55 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/registry?collect=1', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000);$job$);
-- regs-archive-daily
select cron.schedule('regs-archive-daily', '35 1 * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/regs?archive=1', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key')), body := '{}'::jsonb, timeout_milliseconds := 120000);$job$);
-- regs-hourly
select cron.schedule('regs-hourly', '5 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/regs', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000);$job$);
-- shp-every-5-min
select cron.schedule('shp-every-5-min', '*/5 * * * *', $job$select net.http_post(url := 'https://urpphqybqmxlwhjghsmf.supabase.co/functions/v1/shp', headers := jsonb_build_object('x-ingest-key', (select value from public.app_secrets where name='ingest_key'), 'content-type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000);$job$);

-- purge-user-activity (daily 03:00 UTC; deletes activity older than 12 months)
select cron.schedule('purge-user-activity', '0 3 * * *', $job$select public.purge_old_activity()$job$);

-- github-backup-morning / -evening-1 / -evening-2: ask GitHub to run cron_sync.yml when no NSE deals loaded in the last 75 minutes.
-- INERT today: they need app_secrets.github_dispatch_token, which does not exist (verified 2026-11-20). See supabase/migrations/20261110_github_backup_trigger.sql.
-- ('github-backup-morning', '15 3 * * *'), ('github-backup-evening-1', '15 13 * * 1-5'), ('github-backup-evening-2', '15 16 * * 1-5')
