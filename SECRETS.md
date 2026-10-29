# Secrets inventory (names only, never values)

| Name | Purpose | Where it lives | Public? | Last changed |
|---|---|---|---|---|
| Supabase publishable key (`sb_publishable_…`) | Read-only access for the website | In `site/index.html` | Yes, by design; RLS limits it to reads | Never needed |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge functions write to the database | Supabase edge function environment | No | Not exposed |
| `ingest_key` | Authorises cron calls to edge functions | Table `app_secrets` (no public policy); read inside SQL by cron | No | Not exposed |
| `owner_key_hash` | SHA-256 of the owner's key; the key itself is never stored on the server | Table `app_secrets` | No (a hash) | 2026-10-29: locked after the old key appeared in a chat; waiting for the owner to install a new one |
| Owner key | Unlocks Sources tab, CSV download, shareholding saves | Held only by the owner (password manager) | No | To be created by the owner |
| `ANTHROPIC_API_KEY` (optional) | LLM step in `ingest` | Supabase edge function environment | No | Not exposed |

Rules: never paste these into a chat or commit them; refer to them by name; rotate by deploying the new value before revoking the old one.
