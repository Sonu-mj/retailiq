# Push RetailIQ to GitHub

This folder is a git repo with the Oct 20 fixes already committed on `main`.
GitHub sign-in only exists on your PC, so the push itself is one step there:

1. Copy this `retailiq-git` folder to your PC.
2. Open a terminal inside it.
3. Point it at your RetailIQ repo and push:

   git remote add origin <YOUR_RETAILIQ_REPO_URL>
   git push -u origin main

If the repo already has history, run `git pull --allow-unrelated-histories origin main` first, resolve nothing else, then push.
Once pushed, Vercel rebuilds from the repo (buildCommand in vercel.json) and the fixes go live.
