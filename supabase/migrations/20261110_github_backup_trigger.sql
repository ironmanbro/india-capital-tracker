-- Already applied to the live project. GitHub sometimes delays or drops scheduled runs (the 6 pm IST run did not fire on 2 Nov 2026),
-- so Supabase's own scheduler asks GitHub to run the data job 45 minutes after each slot, only when the job has not loaded NSE deals
-- in the last 75 minutes. It does nothing until the secret `github_dispatch_token` (a fine-grained GitHub token with Actions: read and write
-- on this repository only) exists in public.app_secrets.
select cron.schedule(j.name, j.sched, format($job$
  select net.http_post(
    url := 'https://api.github.com/repos/ironmanbro/india-capital-tracker/actions/workflows/cron_sync.yml/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select value from public.app_secrets where name = 'github_dispatch_token'),
      'Accept', 'application/vnd.github+json', 'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'ict-backup'),
    body := '{"ref":"main"}'::jsonb)
  where exists (select 1 from public.app_secrets where name = 'github_dispatch_token')
    and not exists (select 1 from public.feed_records where dataset = 'nse_deals' and loaded_at > now() - interval '75 minutes')
$job$)) from (values ('github-backup-morning', '15 3 * * *'), ('github-backup-evening-1', '15 13 * * 1-5'), ('github-backup-evening-2', '15 16 * * 1-5')) as j(name, sched);
