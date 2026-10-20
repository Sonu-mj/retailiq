# RetailIQ - git push guide

## Status (20 Oct 2026)

The Oct 20 fixes are committed in a ready-to-push git repo:

- Folder: `your_files/retailiq-git/` (git repo, branch `main`, commit `8ea1921`)
- Updated deployable source ZIP: `your_files/retailiq-source/retailiq-source.zip`
  (staging pack synced with the fixed files below)

This workspace itself is not a git repo and GitHub CLI is not signed in here,
so the push runs from your PC, where you are logged in to GitHub as Sonu-mj.
No password or token is stored in this app or in the repo.

## Fixed files in the commit

- `client/src/App.tsx` - Customers nav opens the real Customers page; Data Migration dev page removed from the menu
- `client/src/Customers.tsx` - new Customers page
- `client/src/CommandCenter.tsx` - dashboard totals and period filtering fixes
- `client/src/theme.css` - styles for the fixes and this Settings panel
- `server/src/actions.ts` - date-range queries compare timestamps numerically (reports/dashboard/forecast zero-rows fix); alerts deduped per outlet
- `server/src/supabaseDb.ts` - timestamp-safe reads
- `server/src/privileged.ts` - matching server fixes

Commit message: `Fix reports and dashboard date filtering, dedupe alerts, add Customers page`

## Push steps (on your PC)

1. Copy the `retailiq-git` folder to your PC.
2. Open a terminal inside it.
3. Add your RetailIQ repo and push:

   git remote add origin <YOUR_RETAILIQ_REPO_URL>
   git push -u origin main

   If the repo already has commits, first run:
   `git pull --allow-unrelated-histories origin main`
4. Vercel rebuilds from the repo on push (see `vercel.json` buildCommand),
   which regenerates `api/actions.js` from the fixed server source.
