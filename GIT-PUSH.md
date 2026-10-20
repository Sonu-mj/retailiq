# RetailIQ - git push guide

## Status (20 Oct 2026, latest sync)

The latest fixes are committed in this git pack:

- Folder: `your_files/retailiq-git/` (git repo, branch `main`)
- Production repo clone: `~/workspace/retailiq-push/` (same fix, on top of
  production `c91e035`)

This workspace itself is not a git repo and GitHub CLI is not signed in here,
so the push runs from your PC, where you are logged in to GitHub as Sonu-mj.
No password or token is stored in this app or in the repo.

## Fixed in this sync - forecast generation is now asynchronous

Live proof from the previous build (production c91e035, three Train attempts
20 Oct, 10:30-10:33 pm IST): every attempt ended with "The forecast service
did not respond within 45 seconds" while Render's logs showed
POST /forecast/generate returning 200 OK - the computation finishes on
Render, it just takes ~45s-2min on the free 0.1 CPU instance (a warm instance
still exceeded 45s, so it is compute time, not only cold start). No single
request can wait that long inside Vercel's 60-second function limit.

What changed:

- `ml-service/main.py` - shared file, copied verbatim. New asynchronous job
  endpoints: `POST /forecast/jobs` returns 202 with a job id immediately and
  computes on a background thread; `GET /forecast/jobs/{id}` returns
  running/completed/failed plus the full forecast result when done (404 with
  an honest message if the job expired or the service restarted). The sync
  `POST /forecast/generate` endpoint is unchanged for compatibility.
- `ml-service/forecast_model.py` - shared file, copied verbatim. Bonus
  speedup only: boosting iterations 240 -> 160. Model version unchanged.
- `server/src/actions.ts` - shared file, copied verbatim.
  `generateDemandForecast` now only starts the job (or reports
  `starting` while the service wakes, or completes inline on hosts with a
  local runner) and returns the job id. New `pollDemandForecast` action:
  each poll is one short service request; when the job completes it persists
  the forecasts and staff plans with the same bulk writes as before, under a
  deterministic run id (`FCJ_<job id>`) so a repeated poll cannot write the
  run twice. Failed and insufficient-data jobs record their real state.
- `server/src/privileged.ts` - **repo-variant file, edited in place** (kept
  the repo variant: no local Python runners, sql.js data bridge): new
  `startDemandForecastJob` / `pollDemandForecastJob` contracts (30s each)
  whose remote calls use a 12-second budget. A start that times out, hits a
  5xx, or 404s (old service build still deploying) reads as `starting`, not
  a failure; a poll that times out reads as still `running`. The legacy sync
  forecast contract and the anomaly path are untouched.
  `server/.generated/privileged.contract.ts` regenerated to match (start-job
  timeout 30s in this variant; the Muse artifact copy keeps 120s for its
  local-runner path).
- `client/src/Demand.tsx` - shared file, copied verbatim. Train & generate
  forecast now runs a start-retry loop (up to 40 short attempts while the
  service starts) followed by a poll loop (every 4s, up to ~6 minutes),
  showing progress in a banner: service starting / generating / updated /
  unavailable with the real message. No single page request waits on the
  computation.
- `api/actions.js` - rebuilt bundle from the sources above.

Verified before commit: repo typecheck passes; repo build
(`npm run vercel-build`) passes; the bundle contains `/forecast/jobs`,
`pollDemandForecast`, and the 12s job-request budget; both ML fixture tests
pass; and the job flow was exercised end to end against the real FastAPI
service (fixture payload): POST /forecast/jobs returned in 0.04s, the job
completed after polling with 336 forecasts, and an unknown job id returns
404. Pack consistency: `server/src/actions.ts`, `client/src/Demand.tsx`,
and `ml-service/*` match the artifact source; `server/src/privileged.ts`,
`server/.generated/privileged.contract.ts`, and `api/actions.js` match the
production repo clone.

## Watch after the GitHub push (Render redeploy)

- The `ml-service` changes auto-redeploy on Render when the push lands.
  During that redeploy the service restarts: any forecast job in flight is
  lost (polls then read a clear "job no longer available - start again"
  failure, never a hang), and the first Train click afterwards may spend
  ~a minute in the "service is starting up - retrying" state while the new
  build boots and the free instance wakes. That is expected, not an error.
- Confirm the redeploy picked up the new code before judging a Train run:
  `GET /forecast/jobs/<random>` should return 404 (unknown job) rather than
  the whole route 404ing without the jobs payload shape; a Train run should
  then show "Forecast is generating" and finish with real forecast rows.
- Vercel redeploys the app from the same push; the new `pollDemandForecast`
  action must be live before the new Demand page can finish a run, so judge
  the flow only after both deploys settle.

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
