# Daily email

`send_digest.py` builds one short summary from the public tables (latest FPI flow in US$ and ₹, biggest deals of the week, new SEBI/RBI rules, and optionally news on firms the reader follows) and emails it to accounts that switched on **Daily email** (header, once signed in).

- The choice is stored on the account (`user_metadata.digest = "daily"`, plus consent time). Nothing is sent to anyone who has not switched it on.
- **Dry run by default**: without secrets the script only writes `digest_preview.html` (git-ignored).
- To go live, add two repository secrets (Settings, Secrets and variables, Actions): `SUPABASE_SERVICE_KEY` (Supabase, Project settings, API, service_role; used only to list opted-in accounts) and `RESEND_API_KEY` (free plan at resend.com). Optional `DIGEST_FROM` once a sending domain is verified; until then Resend only delivers to the account owner's own address, so test with `python3 pipeline/digest/send_digest.py --to you@example.com`.
- `.github/workflows/daily_digest.yml` runs it at 9:30 am IST.
- Not built: one-click unsubscribe links in the email (the footer says how to stop it on the site); alerts for a single firm the moment it files a deal.
