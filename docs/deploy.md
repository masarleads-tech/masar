# Putting Masar live on Vercel

The website deploys from `main`. Vercel runs `npm run build`, which also builds the Masar CLI package and serves it at
`/cli/masar-cli.tgz` (the install command on `/cli` points there). If that step fails, the site still deploys and the
`/cli` page shows "coming soon" instead of a broken command.

## Before each deploy

1. The checks on the pull request are green (lint, tests, build, database checks).
2. If `supabase/schema.sql` changed: open Supabase › SQL Editor › New query, paste the whole file, click Run. It is safe
   to run again and keeps existing data. Do this before merging.
3. Merge the pull request. Vercel builds and deploys in about two minutes.
4. Open `/api/health` on the live site. It lists every setting; any that says "missing" still needs adding in Vercel.

## Settings in Vercel

Project › Settings › Environment Variables. `.env.example` lists every name, where to find each value, and which are
secret. The site needs at least:

| What | Names |
|---|---|
| Logins (Clerk) | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |
| Database (Supabase) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Research engine | `ANTHROPIC_API_KEY` |

Without the Clerk and Supabase values the site runs open, with no accounts (for local testing only).
`SUPABASE_SERVICE_ROLE_KEY` is needed for the CLI to sign in and save leads.

Clerk: on a `*.vercel.app` address use the Development keys (`pk_test_…`). Production keys (`pk_live_…`) need your own
domain. In Supabase, Clerk must be added under Authentication › Third-party auth.

## Checking it on your computer

```sh
npm ci
npm run lint && npm test && npm run build
npm start            # http://localhost:3000
```
