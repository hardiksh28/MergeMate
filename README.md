# MergeMate

Find open source issues that fit your skills, understand the code, prep the fix with an AI mate, and turn merged PRs into a proof-of-work profile.

## Run it

```bash
npm install
cp .env.example .env.local   # add GROQ_API_KEY and GITHUB_TOKEN
npm run dev                  # http://localhost:3000
```

- `GROQ_API_KEY`: free at https://console.groq.com/keys. Powers the explainer, guess check, fix drafting, CONTRIBUTING check, review replies, interview prep and PR summaries. Users can also paste their own key in **Settings**.
- `GITHUB_TOKEN`: any classic token with no scopes. Raises GitHub's limit from 60 to 5000 requests/hour.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `SESSION_SECRET`: **Sign in with GitHub**. Create an OAuth App at https://github.com/settings/developers with callback `http://localhost:3000/api/auth/callback` (add your production URL as a second app when you deploy). Signing in grants `public_repo`, so PRs open from the user's own fork (as drafts by default) and their MergeMate activity graph is tied to the verified account. A personal token in **Settings** still works as a fallback.

## MergeCity

The waitlist is **MergeCity** (https://merge-city.vercel.app, repo `hardiksh28/MergeCity`), a separate app. MergeMate reads its public `public_residents` view (read-only, Supabase anon key) for spot counters, "Resident #N", door names and founder status, and sends every "join" button there. Set `NEXT_PUBLIC_MERGECITY_URL`, `MERGECITY_SUPABASE_URL` and `MERGECITY_SUPABASE_ANON_KEY`.

## Admin dashboard

`/admin` shows accounts, active users, the signup → PR funnel, a people table (CSV export) and a live feed. It needs:
1. `supabase/mergemate.sql` run once in the Supabase SQL editor (tables are prefixed `mm_`, locked behind row-level security).
2. `MERGEMATE_SUPABASE_SERVICE_KEY` (service_role key, server-only) in the environment.
3. Your GitHub login in `ADMIN_GITHUB_LOGINS` (default `hardiksh28`); access goes through GitHub sign-in.

Once the database is connected, the MergeMate activity graph is stored there too instead of a local file.

## Pages

| Route | What |
|---|---|
| `/` | Landing page, live "find my issues" try-out, pricing with real spot counts, MergeCity call to action |
| `/onboarding` | GitHub username, optional resume (PDF/text), confirm stack, level, weekly goal |
| `/app` | Matched issues from active repos, weekly goal, streak |
| `/app/issue/:owner/:repo/:n` | Guided workspace: Understand → Find it → Prep fix → Check → Submit |
| `/app/prs` | PR tracker, review-comment decoder and reply drafts, interview prep |
| `/u/:username` | Public profile: live green map, merged PRs in plain English, proven skills, OG image |
| `/city` | Redirects to MergeCity (keeps `?ref=` codes) |
| `/admin` | Admin dashboard (GitHub sign-in, admins only) |

## MVP shortcuts to replace before launch

- Profile, progress and free-tier usage live in `localStorage`. Accounts and activity go to Supabase once `MERGEMATE_SUPABASE_SERVICE_KEY` is set (otherwise `data/activity.json`). Move them to a database (e.g. Supabase/Postgres) keyed by the GitHub user id from the session.
- No payments yet. The paywall links to pricing. Add Stripe (USD) and Razorpay (INR).
- The free tier (2 issues/month) is enforced client-side only.

Brand assets and usage rules live in `logo/` (see `logo/GUIDELINES.md`).
