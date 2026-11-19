# Sci-Tech Pitching — multi-year registration + event site (starter kit for Claude Code)

> **2026-11-19: the backend moved from Supabase to Google Apps Script + Sheets + Drive.** Read `docs/GAS-DESIGN.md` and `CLAUDE.md`. The `supabase/` folder, the Supabase setup steps below and `INSTALL.md` sections 3–6 are obsolete (kept only as a logic reference).

This folder is a hand-off package: requirements, approved page designs, database/security code and a project skeleton. The remaining app code is meant to be built with Claude Code on your own PC.

> **ขั้นตอนติดตั้งโดยละเอียด (ภาษาไทย): ดู [`INSTALL.md`](INSTALL.md)** — ทำตามนั้นแทนหัวข้อ "One-time setup" ด้านล่าง

## Contents
| Path | What it is |
|---|---|
| `CLAUDE.md` | Instructions Claude Code reads automatically (rules, behaviour, commands) |
| `docs/SPEC.md` | Full design record: pages, fields, data model, security, PDPA, deploy plan, assumptions |
| `docs/PROMPTS.md` | Stage-by-stage prompts to paste into Claude Code |
| `design-reference/` | The 5 approved page mockups (`Main`, `Gallery`, `Apply`, `Status`, `Admin` `.dc.html`) + notes |
| `supabase/*.sql` | Schema, server functions (RPC), RLS, storage, seed — run in this order: `schema` → `functions` → `rls` → `storage` → `seed` |
| `supabase/functions/request-upload/` | Edge Function that issues signed upload URLs after PIN check |
| `supabase/functions/admin-purge/` | Edge Function that resets (anonymises/deletes) one edition's participant data — admin + MFA + backup guards |
| `.github/workflows/deploy.yml` | Build + publish to GitHub Pages on push to `main` |
| `package.json`, `vite.config.js`, `index.html`, `src/` | Vite skeleton with hash router and Supabase client |

## One-time setup on your PC
1. Install **Node.js 20+**, **Git**, and the **GitHub CLI** (`gh`). Optional: **Supabase CLI**.
2. Install Claude Code (see https://docs.claude.com/en/docs/claude-code/overview) and sign in.
3. Create an empty GitHub repo (e.g. `sci-tech-registration`), then in this folder:
   ```
   git init
   git add . && git commit -m "Initial hand-off package"
   git branch -M main
   git remote add origin https://github.com/<you>/sci-tech-registration.git
   git push -u origin main
   ```
4. Create a **Supabase** project (region: Singapore). In the SQL editor run the five `supabase/*.sql` files in order (creates edition 2026, closed until you set the dates).
5. In Supabase Auth, create your admin user, then run the `insert into public.admins …` line at the bottom of `seed.sql` with your email. Turn on 2FA.
6. Deploy both Edge Functions (see `CLAUDE.md` → Commands; `admin-purge` keeps JWT verification ON).
7. Repo → Settings → Pages → Source: **GitHub Actions**. Repo → Settings → Secrets and variables → Actions → **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
8. `npm install`, copy `.env.example` to `.env.local`, fill it in.

## Start building
Open a terminal in this folder, run `claude`, and paste **Stage 1** from `docs/PROMPTS.md`. Continue stage by stage (4b editions, 4c gallery, 4d backup/reset).

## Before launch
- Replace every `[PLACEHOLDER]` text (seed content) and have the PDPA wording approved by the university.
- Decided already: max 7 members; admin sets the registration window per year; backup/reset exists; multi-year + gallery. Answer the remaining open questions at the end of `CLAUDE.md` (data retention, free-tier storage, PDPA text).
- Set the registration window and key dates in admin → ปี/รอบการจัด (registration stays closed until you do).
- Upload the real logo, background image and project PDF from the admin page.
