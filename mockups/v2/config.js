/* Where the v2 pages get confirmed aliases from.
     aliasSource: 'local'     your review decisions in this browser (default; works before the migrations are applied)
                  'database'  the confirmed rows in the project (needs migrations 20261114 and 20261115, then the exported SQL)
   The URL and key below are the project's public (publishable) ones, already in the live site; they can only read what
   row-level security allows. Change aliasSource only after pipeline/aliases/ROLLOUT.md step 5. */
window.ICT_CONFIG = {
  aliasSource: 'local',
  supabaseUrl: 'https://urpphqybqmxlwhjghsmf.supabase.co',
  supabaseKey: 'sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB',
  aliasTimeoutMs: 3000          // if the database does not answer in time, the pages fall back to local decisions
};
