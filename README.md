# RetailIQ POS — Vercel deployment

This repository contains the complete RetailIQ React client, the Vercel server-action adapter, the Supabase-backed application services, database migration sources, product-image assets, and the optional Python ML service source.

The deployed web app uses Supabase for authentication, data, Row Level Security, and product-image storage. No local SQLite business database is included in this package.

## What is included

- `client/` — React + TypeScript application and owned product images
- `api/actions.ts` — same-origin Vercel Function used by the browser
- `server/` — typed RetailIQ actions, authorization, reporting, billing, inventory, staffing, and Supabase data adapter
- `supabase/` — go-live, Auth/RLS, and private product-image bucket SQL
- `drizzle/` — the original forward migration history for reference
- `ml-service/` — optional Python anomaly-detection and demand-forecast service
- `vendor/space-sdk/` — the small action-contract/client runtime required to build this repository without private package-registry access
- `vite.config.ts` and `vercel.json` — production build and Vercel configuration
- `.env.example` — environment-variable template with empty values

Generated output, dependencies, logs, audits, local databases, and real `.env` files are intentionally excluded.

## Required environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Public anonymous client key; access remains restricted by Supabase RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-only. Enables one-click employee invitation/provisioning |
| `RETAILIQ_AUTH_REDIRECT_URL` | Recommended | Final Vercel URL with a trailing slash; needed for password recovery/invite callbacks |
| `RETAILIQ_ML_SERVICE_URL` | Optional | Base URL of the separately deployed Python ML service |
| `RETAILIQ_ML_SERVICE_TOKEN` | Optional | Bearer token for the external ML service |
| `RETAILIQ_ANALYTICS_HEALTH_URL` | Optional | Independent analytics health endpoint |
| `RETAILIQ_FORECAST_HEALTH_URL` | Optional | Independent forecast health endpoint |

**Security:** never prefix `SUPABASE_SERVICE_ROLE_KEY` with `VITE_`, never commit it, and never expose it to browser code. The service-role key is unnecessary if employees are created in Supabase Dashboard and then linked in RetailIQ.

## Deploy through GitHub and Vercel

### 1. Create the GitHub repository

1. Extract this zip.
2. Create a new private repository in GitHub.
3. From the extracted folder, run:

```bash
git init
git add .
git commit -m "Initial RetailIQ deployment"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

The included `.gitignore` prevents dependencies, build output, logs, local databases, and `.env` files from being committed.

### 2. Import into Vercel

1. Sign in to Vercel and choose **Add New → Project**.
2. Import the GitHub repository.
3. Leave **Root Directory** as the repository root.
4. Vercel reads `vercel.json`; the build command is `npm run build` and the output directory is `dist`.
5. In **Environment Variables**, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` for Production, Preview, and Development as appropriate.
6. Add `SUPABASE_SERVICE_ROLE_KEY` only if one-click employee provisioning is required.
7. Add any optional RetailIQ service URLs/tokens you use.
8. Click **Deploy**.

### 3. Configure the final Auth callback URL

After the first deployment, copy the final root URL, including the trailing slash. Example:

```text
https://your-retailiq-project.vercel.app/
```

1. Add that exact value to Vercel as `RETAILIQ_AUTH_REDIRECT_URL`.
2. In Supabase Dashboard, open **Authentication → URL Configuration**.
3. Set the production Site URL and add the same URL to Redirect URLs.
4. Redeploy from Vercel so the new environment variable is active.

### 4. Confirm Supabase production setup

The current RetailIQ data already lives in the selected Supabase project. For a different project, apply and review the SQL under `supabase/` in this order:

1. the application's base operational schema for that project;
2. `supabase/phase7_auth_rls.sql`;
3. `supabase/go_live_cutover.sql`;
4. `supabase/product_images_storage.sql`.

In Supabase **Authentication → Providers → Email**:

- keep email/password sign-in enabled;
- turn public sign-up off;
- create the first owner in Supabase Authentication;
- ensure the matching `profiles` row is active with `role = 'owner'`;
- assign the owner to outlets through `user_outlets` if your policies require it.

Do not rerun the old managed-store migration after deployment: this package deliberately excludes `app.db`, and the application's data migration was completed before packaging.

## Verify the deployment

1. Open the Vercel URL and sign in as an active RetailIQ owner.
2. Refresh the page and confirm the session remains active.
3. Open POS and load products/outlets.
4. Create a low-value test bill, then confirm it appears once in Orders and inventory movement history.
5. Open **Management → Users & Employees** and confirm role/outlet assignments load.
6. Open **Management → Reports** and preview/export a report.
7. Upload a small JPG/PNG/WEBP product image after applying `product_images_storage.sql`.
8. Test owner, manager, cashier, inactive, and unassigned accounts against the expected RLS restrictions.

## Local development

Requires Node.js 20 or newer.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Fill `.env.local` with the same Supabase values used in Vercel. Open the local URL printed by Vite. The browser talks to `/api/actions`; for a fully integrated local serverless-function test, use the Vercel CLI (`vercel dev`) rather than plain Vite.

Before pushing changes:

```bash
npm run typecheck
npm run build
```

## Important runtime notes

- The app uses scoped auto-refresh for cross-device updates; it does not use Supabase Realtime push.
- Anomaly detection and demand forecasting need `RETAILIQ_ML_SERVICE_URL` pointing to a separately hosted instance of `ml-service/`. Vercel does not run the bundled Python/scikit-learn service inside the Node function.
- The server validates Supabase access tokens and enforces RetailIQ roles/outlet scope. Supabase RLS remains the final database security boundary.
- Product images live in the private Supabase `product-images` bucket and are displayed through short-lived signed URLs.
