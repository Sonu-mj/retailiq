# RetailIQ - git push guide

## Status (20 Oct 2026, latest sync)

The latest fixes are committed in this git pack:

- Folder: `your_files/retailiq-git/` (git repo, branch `main`, commit `bcf234d`)
- Production repo clone: `~/workspace/retailiq-push/` at commit `4e954bd`
  (same fix, on top of production `7e1a24f`)
- Previous commits: `28e72f0` (profit trend/insights, NumPy ML runners),
  `cc64f43` (Settings source & git panel), `8ea1921` (reports/dashboard fixes)

This workspace itself is not a git repo and GitHub CLI is not signed in here,
so the push runs from your PC, where you are logged in to GitHub as Sonu-mj.
No password or token is stored in this app or in the repo.

## Fixed in this sync - forecast timeout on Vercel

"Train & generate forecast" died with a 504 (60s Vercel Hobby limit) and no
forecast was ever produced, while the page kept showing the stale note
"Set RETAILIQ_ML_SERVICE_URL to run demand forecasting on Vercel" from an
older failed run - even though the URL is set and the Render service is live.
Root causes, all inside the one serverless function:

- One run persisted hundreds of forecast and staff-plan rows as individual
  database requests (2 outlets x 168 hours x 2 tables), and the prior-run
  delete did the same per row.
- The ML-service call allowed itself 115 seconds inside a 60-second function,
  so a slow service start ended as a platform kill with nothing recorded.

What changed:

- `server/src/actions.ts` - shared file, copied verbatim. Forecast runs now
  bulk-persist: one operation carries all forecast rows, staff plans upsert
  in chunks of 80 rows, everything lands in one small batch.
  `generateWeeklyStaffPlan` uses the same chunked bulk upsert. A failed run
  now returns (and records) the actual failure message. Settings
  `getSystemHealth` derives ML/Forecast status and detail from the latest
  run row (status, completion time, signal/training counts) - the same state
  the Anomalies and Demand Intelligence pages show - instead of parroting
  stored run notes.
- `server/src/privileged.ts` - **repo-variant file, edited in place** (kept
  the repo variant: no local Python runners, sql.js data bridge): deletes
  use one `in.(...)` request per 200 keys instead of one DELETE per row; the
  remote forecast call to `RETAILIQ_ML_SERVICE_URL` `/forecast/generate`
  gets a 45-second budget that fits the function limit, with distinct honest
  messages for timeout ("did not respond within 45 seconds - it may still be
  starting up"), unreachable service, and HTTP errors; the not-configured
  fallback now states the URL is not set in this deployment. The anomaly
  path is untouched. The Muse artifact copy of this file carries the same
  changes with its local-runner fallback and a 115-second remote budget.
- `server/src/supabaseDb.ts` - repo variant, **unchanged this round** (it
  still carries last sync's ported `onConflictDoNothing({target})` fix).
- `client/src/api.ts`, `client/src/supabaseAuth.ts` - repo variants, unchanged.
- `api/actions.js` - rebuilt bundle from the sources above.

Verified before commit: repo typecheck passes; repo build (`npm run
vercel-build`) passes; the bundle contains the bulk-write path, the
`in.(...)` delete, `FORECAST_REMOTE_TIMEOUT_MS = 45e3` on the forecast call
(the anomaly call keeps its own timeout), and the new error wording; both ML
fixture tests pass (`forecast fixture pipeline: ok`; anomaly demo `PASS`).
Pack consistency: `server/src/actions.ts` matches the artifact source;
`server/src/privileged.ts`, `server/src/supabaseDb.ts`, and `api/actions.js`
match the production repo clone.

## Push steps (on your PC)

1. Copy the `retailiq-git` folder to your PC.
2. Open a terminal inside it.
3. Add your RetailIQ repo and push:

   git remote add origin https://github.com/Sonu-mj/retailiq.git
   git push -u origin main

   If the repo already has commits, first run:
   `git pull --allow-unrelated-histories origin main`
4. Vercel rebuilds from the repo on push (see `vercel.json` buildCommand),
   which regenerates `api/actions.js` from the fixed server source.
