# Masar's seven agents

The website and the CLI run one search engine, in `src/core`. The website plugs in its Claude API connector;
the CLI plugs in the member's own AI. Nothing about finding, checking, scoring or saving leads is written twice.

| # | Agent | Code | What it does |
|---|---|---|---|
| 1 | Boss | `src/core/boss.ts` | Picks the eligible collectors, runs them in parallel with a time limit each, keeps partial results, reports progress, hands results to Intelligence. Never throws for a collector failure. |
| 2 | LinkedIn collector | `src/core/collectors/linkedin.ts` | Confirms LinkedIn company pages by vanity name (official Organization Lookup API). |
| 3 | Instagram collector | `src/core/collectors/instagram.ts` | Checks known Instagram handles (official Business Discovery API). |
| 4 | Facebook collector | `src/core/collectors/facebook.ts` | Searches and confirms Facebook Pages (official Pages Search API). |
| 5 | Google & web collector | `src/core/collectors/google-web.ts` | Google Places API, OpenStreetMap, the AI's own web search; then business websites and public search results. |
| 6 | Connector / LLM service | `src/core/llm.ts`, `src/lib/claude.ts`, `cli/src/ai/providers.ts` | One interface (`LlmConnector`) over Claude API, Claude Code, Codex, OpenAI, Ollama and OpenAI-compatible servers, with declared capabilities. |
| 7 | Intelligence | `src/core/intelligence.ts` | Dedupes, merges collector findings, scores (rank = 40% fit + 30% compatibility + 30% verified), saves to Supabase by category. |

Shared contracts (search criteria, options, agent reports, incoming leads, provenance) are zod schemas in `src/core/schemas.ts`.

## How a search flows

**Website.** `src/app/page.tsx` (unchanged flow) posts the criteria to `/api/discover`, which runs `bossDiscover` and saves
every business found to `collected_leads`. The page then sends batches to `/api/enrich`, which runs `bossEnrich`
(Google & web first, then the social collectors in parallel), charges credits and saves through `saveLeads`.
A new search starts from the member's setup answers (`/api/config` returns them as `defaults`).

**CLI.** `masar find` runs the Boss interview (`cli/src/agents/main.ts`), then `bossSearch` with the member's AI,
prints one line per agent report, and posts the ranked leads, everything collected and the reports to `/api/cli/leads`,
which re-ranks them on the server and saves through the same Intelligence functions.

Each agent report has a status: `ok`, `partial` (some work failed; results kept), `empty`, `error`, `timeout`,
`disabled` (credentials not set), `unsupported` (the platform offers no authorized way), `skipped`.

## Data in Supabase

Run `supabase/schema.sql` again in the Supabase SQL editor after pulling this change. It is safe to re-run. It adds:

- `collected_leads`: every business any collector found, one row per search and business, with `category`
  (the searched industry key, or `custom:<your words>`), `business_type` (the business's own category), `city`,
  `sources` (which collectors and APIs it came from), `stage` (`found`, then `checked`) and the full lead in `data`.
  Members can read only their own rows (RLS).
- `leads.category`, `leads.city`, `leads.sources`: the same filing for the checked leads on the dashboard.

## Setting up each provider

All credentials are environment variables: on Vercel for the website, on the member's computer for the CLI.
They are never sent to the browser, printed, logged or saved in the database. Error messages from Meta are
cleaned of tokens before they are reported.

| Variable | Collector | What you need |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Google & web | Google Cloud project with **Places API (New)** enabled. |
| `MASAR_USE_OSM=true` | Google & web | Website only: also search OpenStreetMap. The CLI always does. |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram | A Meta app, an Instagram professional account linked to a Facebook Page, and a token with `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement`. Advanced Access needs Meta App Review. |
| `FACEBOOK_APP_ACCESS_TOKEN` | Facebook | A Meta app approved for the **Page Public Metadata Access** feature (App Review). App access token: `app-id|app-secret`. |
| `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_API_VERSION` | LinkedIn | A LinkedIn app approved for the **Community Management API**, and a 3-legged OAuth token. |
| `META_GRAPH_VERSION` | Instagram, Facebook | Graph API version, default `v26.0`. |

## What the platforms do and don't allow

Checked against each provider's documentation before writing the collectors:

- **Instagram**: Business Discovery returns public data (name, website, followers, media) for another professional
  account when you know its exact username. There is no API to search accounts by keyword or place, so the Instagram
  collector's search step is `unsupported`; it only checks handles found by the other collectors.
- **Facebook**: `GET /pages/search` exists but only for apps granted Page Public Metadata Access. Without it, Meta
  returns a permission error and the collector reports `unsupported`.
- **LinkedIn**: no public API to search companies or people. Organization Lookup by vanity name needs an app approved
  for the Community Management API. Without it the collector reports `unsupported`. Decision makers shown in results
  come from public search results seen by the AI, never from LinkedIn pages.
- **Google**: the Custom Search JSON API is closed to new customers and shuts down on January 1, 2027, so Masar
  doesn't use it. Google results come from the Places API and from the AI provider's own web search tool.
- **AI web search**: the AI is told never to open instagram.com, facebook.com or linkedin.com pages (they need a login),
  and to use only public pages and search results.
- **Ollama**: tool calling exists only for some models. The Boss runs the agents itself and every answer uses
  Ollama's structured `format`, so tool calling isn't needed. The CLI asks Ollama (`/api/show`) and reports it.
  Local models have no web search: they get map and website data plus any official API checks you connect.

No collector scrapes logged-in pages, gets around blocks or captchas, or rotates identities. Rate limits back off
(Retry-After honoured), then stop the collector with its partial results.

## Tests

`npm test` runs the vitest suite in `tests/`: schemas, Boss orchestration (parallel runs, timeouts, partial failures,
disabled and unsupported collectors), deduplication, scoring, Supabase writes, CLI arguments, and provider boundaries
with a fake `fetch` (no live calls to any platform).

`supabase/tests/run.sh` checks `supabase/schema.sql` on a scratch PostgreSQL (never the live database): it installs the
schema twice, then checks the free trial, credits, plans, admin tools and that members, visitors and the server each see
only what they should. `DATABASE_URL=postgres://… supabase/tests/run.sh`. GitHub runs it, with lint, tests and a build,
on every pull request (`.github/workflows/checks.yml`).
