# Hiring Pipeline Tracker

**Live App → [hiringpipeline.vercel.app](https://hiringpipeline.vercel.app/)**

An internal hiring pipeline tracker for the recruiting team at **Computacenter × AgreeYa**. Track every candidate from initial screen to final offer in a single-screen dashboard.

![Status](https://img.shields.io/badge/status-production-green) ![Vercel](https://img.shields.io/badge/hosted-Vercel-black) ![Supabase](https://img.shields.io/badge/backend-Supabase-3ECF8E)

---

## What It Does

- **Single dashboard** — See all candidates, their stage, status, screeners, and interviewers at a glance
- **Pipeline stages** — Internal Screen → Round 1 → Round 2 → Round 3 → Offer → Joined
- **Quick actions** — Advance, reject, decline, add notes, delete — all from a slide-in panel
- **Filters & search** — Filter by client, stage, status, or free-text search (debounced, local)
- **CSV export** — Export filtered candidate data to CSV
- **Activity log** — See who did what, when (last 50 actions)

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Vanilla HTML + CSS + JS (no build step) |
| Backend | [Supabase](https://supabase.com) (Postgres + Auth + RLS) |
| Hosting | [Vercel](https://vercel.com) (free tier) |
| Fonts | [Inter](https://fonts.google.com/specimen/Inter) via Google Fonts |

**No React. No Node. No bundler. No npm packages in production.**
The Supabase JS client is loaded via CDN.

---

## Project Structure

```
├── index.html          # Single-page HTML shell
├── app.js              # All application logic (~1100 lines)
├── style.css           # Complete design system (~1400 lines)
├── supabase-setup.sql  # Database schema + RLS policies
├── vercel.json         # Security headers (HSTS, CSP, etc.)
├── api/
│   └── health.js       # /api/health → { status: "ok" }
├── stress_test.py      # Load testing script (requests + ThreadPoolExecutor)
└── .gitignore
```

---

## Setup Guide

### 1. Clone & Deploy

```bash
git clone https://github.com/avisihvam-eng/hiring-pipeline-tracker.git
cd hiring-pipeline-tracker
npx vercel --prod
```

No `npm install` needed. It's a static site.

### 2. Supabase Setup

1. Create a free Supabase project at [supabase.com](https://supabase.com)
2. Open the **SQL Editor** in the Supabase dashboard
3. Paste the entire contents of `supabase-setup.sql` and click **Run**
4. Update the `SUPABASE_URL` and `SUPABASE_KEY` constants in `app.js` with your project's anon key

### 3. Verify

- Visit your Vercel URL — the dashboard should load with data
- Hit `/api/health` — should return `{"status":"ok"}`

---

## Database Schema

### `hiring_pipeline` — Candidates

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| full_name | text | Candidate name |
| location | text | City |
| role | text | Job title |
| client | text | Client company |
| current_stage | text | Pipeline stage |
| stage_status | text | Pending / Cleared / Rejected |
| screened_by_1 | text | First screener |
| screened_by_2 | text | Second screener |
| interviewed_by_1 | text | First interviewer |
| interviewed_by_2 | text | Second interviewer |
| date | date | Relevant date |
| notes | text | Free-text notes |
| created_at | timestamptz | Auto-set on insert |

### `pipeline_history` — Stage change log

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| candidate_id | uuid | FK → hiring_pipeline |
| stage | text | Stage at this point |
| status | text | Status at this point |
| note | text | Context note |
| timestamp | timestamptz | Auto-set |

### `audit_log` — Who did what

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_email | text | Authenticated user's email |
| action | text | added / updated / deleted |
| candidate_name | text | Affected candidate |
| changed_at | timestamptz | Auto-set |

### `allowed_users` — Email whitelist

| Column | Type | Description |
|--------|------|-------------|
| email | text | Primary key, approved email |

---

## Security

### Row-Level Security (RLS)

All tables have RLS enabled with simple public access. Open to both `anon` and `authenticated` users (the dashboard is publicly readable and writable).

### HTTP Security Headers (vercel.json)

- `Strict-Transport-Security` — Forces HTTPS
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` — Prevents clickjacking
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — Blocks camera, mic, geolocation
- `Content-Security-Policy` — Restricts script/style/connect sources

### Frontend Guards

- **Rate limiting**: Login form limited to 3 attempts per 60 seconds (in-memory)
- **Input validation**: All fields validated before save (required checks, min length, date cannot be future, notes max 500 chars)
- **Sanitization**: HTML tags stripped, whitespace trimmed before any Supabase write
- **Error handling**: All Supabase calls wrapped in try/catch — user-friendly toasts only, never raw errors

---

## Stress Test Results

Run with: `python stress_test.py`

| Test | Concurrency | Requests | Failures | Avg Latency | p95 | Throughput |
|------|:-----------:|:--------:|:--------:|:-----------:|:---:|:----------:|
| Baseline | 1 | 20 | 0 | 419ms | 654ms | 2 req/s |
| Light | 5 | 100 | 0 | 613ms | 760ms | 8 req/s |
| Moderate | 10 | 200 | 0 | 869ms | 1105ms | 11 req/s |
| Stress | 20 | 200 | 0 | 1542ms | 1900ms | 13 req/s |
| Higher | 50 | 200 | 0 | 3742ms | 4484ms | 13 req/s |
| Spike | 100 | 200 | 0 | 7159ms | 8457ms | 12 req/s |
| Health | 10 | 50 | 0 | 1261ms | 1913ms | 8 req/s |

**970/970 requests passed (100% success rate)** across all concurrency levels.

---

## Brand Identity

The app shell reflects the **Computacenter × AgreeYa** co-brand:

- 3px red top bar (`#c8102e`)
- Navy navbar (`#0d1f3c`) with CC logo mark
- "COMPUTACENTER" above "Agree**Ya**" (blue `#4fa3e0`)
- "INTERNAL TOOL" label on the right

---

## Environment & Costs

- **Vercel**: Free tier (no build step, static site)
- **Supabase**: Free tier (500MB storage, 60 max connections)
- **⚠️ Supabase pauses** after 1 week of inactivity on the free tier — first visit after pause takes ~30s to wake up

---

## License

Internal tool. Not open-source.
