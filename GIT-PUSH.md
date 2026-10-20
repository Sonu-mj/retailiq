# RetailIQ - git push guide

## Status (20 Oct 2026, latest sync)

The latest fixes are committed in this git pack:

- Folder: `your_files/retailiq-git/` (git repo, branch `main`, commit `28e72f0`)
- Previous commits: `cc64f43` (Settings source & git panel), `8ea1921` (reports/dashboard fixes)

This workspace itself is not a git repo and GitHub CLI is not signed in here,
so the push runs from your PC, where you are logged in to GitHub as Sonu-mj.
No password or token is stored in this app or in the repo.

## Fixed files in commit 28e72f0

- `server/src/actions.ts` - insights re-insert no longer kills getCommandCenter
  (each insert is wrapped so a rejection cannot fail the read, and it now
  conflicts on `dedupe_key`); forecast rows carry the real staff `plan_id`;
  Staff Planner reads/writes real staff plan IDs; forecast day-count fix
- `server/src/supabaseDb.ts` - **repo-variant file, MODIFIED**: the
  `onConflictDoNothing({target})` fix was ported into this repo (sql.js)
  variant, so it passes `on_conflict=dedupe_key` to PostgREST exactly like the
  space variant. If the four deployment files are restored from the repo
  clone before pushing, use the pack's `supabaseDb.ts` (or the equally fixed
  copy in `~/workspace/retailiq-push/`), not an older clone copy without the fix.
- `server/src/privileged.ts` - repo-variant (sql.js) file, restored verbatim,
  unmodified; its insert handler already turns `operation.conflict` into
  `?on_conflict=...` with `resolution=ignore-duplicates`
- `client/src/api.ts`, `client/src/supabaseAuth.ts` - repo variants restored
  (type-only Actions import, endpoint `/api/actions`), unmodified
- `client/src/Profitability.tsx` - "How profit is changing" now shows
  loading / error-with-retry states and dots on short series instead of a
  blank-looking panel
- `client/src/Demand.tsx` - Staff Planner saves scheduled staff against the
  real plan ID and disables rows that have no plan
- `ml-service/analyzer.py`, `ml-service/forecast_model.py` - NumPy-only
  Isolation Forest and histogram gradient boosting runners (no scikit-learn);
  `ml-service/requirements.txt` drops scikit-learn
- `api/actions.js` - rebuilt bundle from the sources above

Verified before commit: repo build (`npm run vercel-build` = vite build +
esbuild bundle) passes with these exact files, typecheck passes, the bundle
contains the `on_conflict` / `dedupe_key` / `ignore-duplicates` chain, and both
ML fixture tests pass (`forecast fixture pipeline: ok`; anomaly demo `PASS`).

Commit message: `Fix profit trend/insights, NumPy ML runners, forecast and Staff Planner IDs`

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
