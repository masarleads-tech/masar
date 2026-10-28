# Masar · مسار

A bilingual (Arabic / English) B2B lead-generation website for the Gulf and Middle East.
Customers sign up (Clerk), confirm their email, get 10 free leads, and can move to a weekly plan of
100 leads. Masar finds businesses, checks them with live public data (contacts, Instagram,
Facebook, LinkedIn decision makers, legitimacy), ranks them by fit % and closing %, and exports
Excel and PDF.

Built with Next.js, TypeScript, Tailwind CSS and PostgreSQL (Supabase), hosted on Vercel.
The look follows the Masar design system (ink, teal and paper colours, Manrope and IBM Plex Sans
Arabic). Every page is in British English and Saudi Arabic (switch with the language button).

Pages: home page for visitors (scroll animations and product mock-ups), log in / sign up, the app
(search, leads, history), PDF report, admin page, and the privacy, terms and refund policies.

**Your data is kept in Supabase**, not in the browser: every search and every checked lead is
saved to the customer's account, with a status per lead (New, Contacted, Meeting, Won, Not now).
Customers can open any old search from **History** on any device. Supabase backs the database up
daily (on the paid plan you can restore to any point in time).

**Phone app:** Masar installs like an app, with its own icon and a bottom tab bar.
- iPhone: open the site in Safari > Share > **Add to Home Screen**.
- Android: open the site in Chrome > menu > **Install app**.

## Stack

| Part | Service |
|---|---|
| Backend (database) | Supabase |
| Auth (sign-up, log in) | Clerk |
| Deploying | Vercel |
| Payments | Stripe / Whop / STC Pay |
| Version control | GitHub |
| Emails | Resend |
| DNS | Cloudflare |
| Analytics | PostHog |
| Error tracking | Sentry |
| Cache (Redis) | Upstash |
| Vector database | Pinecone |

---

## Put Masar online: step by step

You need three free accounts: **Supabase** (logins and the database), **Vercel** (the website)
and **Anthropic** (the Claude API key, paid by usage).

### Step 1: Clerk (logins) and Supabase (database)

Clerk runs sign-up, log in, email confirmation, password reset and Google login.
Supabase stores credits, plans, searches and leads, and trusts Clerk's logins.

**Supabase**
1. Go to https://supabase.com, sign up, click **New project**. Pick the *Frankfurt* region and
   let Supabase generate the database password (save it in a password manager).
   Leave "Enable Data API" and "Automatically expose new tables" ticked.
2. Open **SQL Editor > New query**, paste everything from `supabase/schema.sql`, and click **Run**.
3. Copy from **Project Settings > API**: the *Project URL*, the *anon public* key and the
   *service_role* key (keep the last one secret).

**Clerk**
1. Go to https://clerk.com, sign up, and create an application called **Masar**.
   Sign-in options: **Email** and **Google**.
2. **Configure > Email, phone, username**: make sure email **verification at sign-up** is on
   (customers get a 6-digit code). The 10 free leads are given after this, once per email.
3. **Configure > Sessions > Customize session token**: add this and save. Masar needs the email
   to find customers in the Admin page:
   ```json
   { "email": "{{user.primary_email_address}}" }
   ```
4. Open Clerk's **Supabase integration** page (Integrations > Supabase), click **Activate**, and
   copy the Clerk domain it shows.
5. In Supabase: **Authentication > Sign In / Providers > Third-party auth > Add provider > Clerk**,
   paste that domain, and save.
6. Optional: **Configure > Legal** to require customers to accept your Terms and Privacy policy
   (`https://YOUR-SITE/legal/terms` and `/legal/privacy`).
7. Copy from **Configure > API keys**: the *Publishable key* and the *Secret key*.
8. Going live on your domain: in Clerk, create the **Production** instance, add your domain, and
   add the DNS records it lists in Cloudflare. For Google login in production, Clerk asks for your
   own Google OAuth client (it shows the steps). Use the production keys on Vercel.

### Step 2: Claude API key

1. https://console.anthropic.com > sign up > add credit (Billing).
2. **Settings > Limits**: set a monthly spend limit so costs can never surprise you.
3. **API keys > Create key**. This is your main key (`ANTHROPIC_API_KEY`).

### Step 3: Vercel (the website)

1. Create an account at https://vercel.com.
2. Install Node.js 20+ on your computer, open this folder in a terminal and run:
   ```
   npm install
   npm install -g vercel
   vercel login
   vercel
   ```
3. In the Vercel dashboard: **Project > Settings > Environment Variables**. Add every value from
   `.env.example` (Clerk keys, Supabase URL and keys, `ANTHROPIC_API_KEY`, your contact email).
4. Run `vercel --prod`. You get a link like `masar.vercel.app`.
5. Your own domain: **Project > Settings > Domains > Add**, then add the DNS records it shows
   in Cloudflare (set to "DNS only"). Then set up Clerk's production instance (Step 1, Clerk 8).

**Plan:** Vercel's free Hobby plan is for non-commercial use. When you take paying customers,
upgrade to Pro ($20 per month), which also allows the longer research calls.

### Step 4: Make yourself the admin

1. Open your site and create an account with your own email (enter the code Clerk emails you).
2. In Supabase **SQL Editor**, run (with your email):
   ```sql
   update public.profiles set is_admin = true where email = 'you@example.com';
   ```
3. Refresh the site. An **Admin** item appears in the sidebar.

### Step 5: Fill in your company details

Edit `src/lib/legal.ts` (company name, trade licence, address, governing law and courts) and
redeploy. Have a lawyer in your country of registration review the policies before launch.

---

## Running the business

**New customer subscribes** (you get paid by bank transfer, STC Pay, payment link, etc.):
Admin > find their email > enter the number of weeks > **Start**. They get 100 leads now, and the
balance resets to 100 every 7 days until the plan ends. **Extend** adds weeks, **End** stops it.

**Give a customer their own Claude key** (so you can see and limit each customer's cost):
1. console.anthropic.com > **Workspaces > Create workspace** named after the customer.
   Set the workspace's monthly spend limit.
2. Create an API key inside that workspace.
3. Admin > the customer's row > paste the key > **Save**. All their searches now use that key.
   Customers never see the key. Needs `SUPABASE_SERVICE_ROLE_KEY` on Vercel.

**Add leads** (a bonus, or a replacement for a wrong lead): Admin > Add leads > enter a number.

**Price on the site:** 100 JOD per month by default. To change it, set
`NEXT_PUBLIC_PRICE_EN` and `NEXT_PUBLIC_PRICE_AR` on Vercel (e.g. `375 SAR` / `375 ريال`) and redeploy.

**Testimonials:** replace the example quotes in `src/lib/landing-copy.ts` with real quotes from
customers (with their permission) and set `example: false`.

---

## How it works

1. **Find** (`/api/discover`): Google Maps Places (with `GOOGLE_MAPS_API_KEY`), otherwise Claude
   web search. Needs at least 1 lead in the balance.
2. **Check** (`/api/enrich`, 5 leads per call, 2 at a time): Claude confirms contacts, checks
   Instagram and Facebook, finds LinkedIn decision makers and gives a legitimacy verdict with
   sources. **One lead is taken from the balance for each checked lead**, after the check succeeds.
3. **Rank**: fit % and closing % with written reasons.

Only public pages are used. Masar never logs in to Instagram, Facebook or LinkedIn.

Cost estimate: about $0.50 of Claude usage per 10 checked leads (about $5 per 100). The results
page shows the searches used, so you can track it.

## Run on your computer

```
npm install
cp .env.example .env.local     (Windows: copy .env.example .env.local)
npm run dev
```

Open http://localhost:3000. Without the Supabase values, the site runs without accounts
(handy for testing).

## Files

- `src/app/page.tsx`: home page (visitors) and the app (search + leads with status)
- `src/app/history/page.tsx`: saved searches; `src/lib/saved.ts`: reads and updates them
- `src/app/manifest.ts`, `public/icon-*.png`, `src/app/apple-icon.png`: installable phone app
- `src/components/Landing.tsx`: the visitor home page; `src/lib/landing-copy.ts`: its words
- `src/components/site.tsx`: logo, desktop sidebar, phone tab bar, account balance, language
- `src/app/globals.css`: design system colours, type scale and animations
- `src/lib/i18n.ts`: every app word in British English and Saudi Arabic
- `src/app/login`: sign-up and log in (Clerk); `src/middleware.ts`: Clerk session check
- `src/app/admin/page.tsx`: admin page
- `src/app/legal/[doc]/page.tsx` and `src/lib/legal.ts`: privacy, terms, refund policies
- `src/app/report/page.tsx`: printable PDF report
- `src/app/api/*`: discover, enrich, export (Excel), config
- `src/lib/claude.ts`: the research agent; `src/lib/places.ts`: Google Maps; `src/lib/lead.ts`: scoring
- `supabase/schema.sql`: database (accounts, searches, leads), trial, weekly plan, admin functions
