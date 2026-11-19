# Watchlist alerts (Web Push)

Visitors follow companies, investors, countries and topics on `/v2/watchlist` (the list stays in their browser). If they also press **Turn alerts on**, their browser gets one notification per update naming what changed, even when the site is closed.

**Switched off until you do the steps below.** Without the public key in `config.js` the Watchlist page says alerts are not available and sends nothing anywhere.

## How it works
1. `mockups/v2/watch.js` asks permission, registers `push-sw.js` (scope `/v2/`, shows notifications only) and sends the browser's push address, keys and followed items to the edge function `push-subscribe`.
2. `supabase/functions/push-subscribe` validates and stores them in `push_subscriptions` (RLS on, no public policy). Only real browser push services (Google, Mozilla, Apple, Microsoft) are accepted as addresses.
3. After every data refresh, `.github/workflows/refresh_v2.yml` runs `send_push.py`. It compares each list against the new data, **baselines a new follow silently** (no alert for old news), sends at most one notification per browser per run, retries failures next run and deletes expired subscriptions (404/410).
4. `watch.js` and `send_push.py` must match items identically. `pipeline/site_v2/tests/parity.js` checks that.

## Switching it on (you do these; nothing here changes your project until you do)
1. Generate a VAPID key pair (once): `npx web-push generate-vapid-keys`. Keep the private key secret.
2. Apply `supabase/migrations/20261120_push_subscriptions.sql` to the project.
3. Deploy the function: `supabase functions deploy push-subscribe --no-verify-jwt` (browsers call it with the public key only; the function validates everything itself).
4. GitHub, Settings, Secrets and variables, Actions:
   - Secrets: `VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_KEY` (service_role; already used by the daily email)
   - Variables: `ICT_PUSH_PUBLIC_KEY` (the public key), `VAPID_SUBJECT` (e.g. `mailto:you@example.com`)
5. Run "Refresh the /v2 pages" once by hand. The Watchlist page now offers **Turn alerts on**.
6. **Before step 5, add this to the privacy notice (section 2, "What is collected") and update its date.** It is not added yet because the feature is off, and the wording is yours to approve:
   > **Watchlist alerts (optional):** if you turn alerts on, your browser's push address and keys and the list of companies, investors, countries and topics you follow are stored on our server so we can send you notifications. Turning alerts off deletes them. Your watchlist is otherwise kept only in your browser.

## Tests
```bash
python3 pipeline/alerts/tests/test_send_push.py                 # baseline, one combined message, retry, expiry, address allow-list
npx wrangler dev --port 8790 --local &                           # then:
node pipeline/site_v2/tests/parity.js                            # browser and sender find identical items
```
Not tested here: a real push through Google, Mozilla or Apple (needs your keys and a deployed function). Test it with your own browser first.

## Known limits
- Anyone can create a subscription row (capped at 20,000). There is no login, by design.
- Alias groups confirmed in the database are not applied to investor matching, on the site or here (`aliasSource` is `local` publicly). Change both together if that changes.
- Push works on Chrome, Edge, Firefox and Android; on iPhone only after the site is added to the Home Screen.
