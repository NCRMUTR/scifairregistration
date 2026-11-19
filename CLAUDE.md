# CLAUDE.md — Sci-Tech Pitching · Multi-year team registration + event site

Read `docs/GAS-DESIGN.md` first (the backend architecture — **it replaces every Supabase mention** in the other docs), then `docs/SPEC.md` (requirements and rules; page behaviour and business rules are still valid). Look at `design-reference/` for the approved page mockups.

## What this is
A Thai-language, conference-style website for a student pitching contest that is **reused every year**. Static frontend on **GitHub Pages** + **Google Apps Script (GAS) Web App** backend with **Google Sheets** (data) and **Google Drive** (files). Five hash-routed pages:
`#/` home · `#/gallery` photo gallery (permanent, grouped by year) · `#/apply` application form · `#/status` application check · `#/admin` admin console.

> History: the first design used Supabase. On 2026-11-19 the owner decided to move to GAS (low traffic, easier to maintain, they will rarely look at the system). The `supabase/` folder is kept only as a reference for the logic — **do not deploy it and do not extend it.**

## Core concept: editions (รอบการจัดงาน)
- Each year is an **edition** (row in the `editions` sheet). Exactly one is `is_current`. Teams, members, advisors, uploads, upload slots, ack/PDPA texts, key dates, PDF, background, `max_members` (default **7**) and the registration window all belong to an edition.
- Global content (logo, site name, footer, contact, button labels, gallery intro) lives in the `site_settings` sheet.
- Gallery albums belong to an edition but are **permanent**: resetting participant data never touches them.
- A student ID is unique **within an edition** (so the same student can apply next year). English team name is unique within an edition.
- Registration is open only if: edition `status = 'active'` AND (`reg_mode = 'open'` OR (`reg_mode = 'auto'` AND opens_at ≤ now < closes_at)). **The GAS server clock decides** (`registrationOpen()`). New editions start closed. The browser reads this from the `public_site` action for display only; `submit_team` re-checks.

## Stack and rules
- Frontend: Vite + vanilla JavaScript (ES modules). No UI framework unless asked. Keep dependencies minimal (`html2canvas`; ask before adding anything else — e.g. a test runner).
- Backend: `gas/*.gs` (see `docs/GAS-DESIGN.md` §8). All calls are `POST` with `Content-Type: text/plain` and a JSON body `{action, …, session?}`; replies are `{ok:true,data}` / `{ok:false,reason}`. Reason codes are mapped to Thai text in `src/lib/api.js`.
- UI language: **Thai** (lang="th"), font IBM Plex Sans Thai.
- **No secret may ever appear in this repo or the browser bundle:** the PIN pepper, admin password hashes, TOTP secret and Drive folder IDs live in GAS Script Properties. The browser only knows `VITE_GAS_URL`, which is public by nature. **Never write the admin ID/password into any file.**
- The browser never reads Sheets/Drive directly. The spreadsheet and the `team-files`/`backups` folders stay **private**. Public access = the public actions in `gas/Public.gs` only; admin access = ID + password checked server-side (`admin_login` → random session token in CacheService, 2 h).
- Do not weaken the PIN lock-out, rate limits, the script lock around writes, or the purge guards to make something easier.
- Business rules live in the GAS code, enforced **inside one `LockService` lock** for every write: unique `(edition, student_id)`, unique `(edition, name_en_key)`, max members from `editions.max_members`, PIN stored only as HMAC (pepper in Script Properties). Write text cells as plain text (`@` format) — no formula injection, keep leading zeros.
- Accessibility: real `<button>`/`<a>`/`<label>`, visible focus, contrast ≥ 4.5:1, touch targets ≥ 44 px, works at 360 px width.

## Pages — behaviour that must match the spec
- **Top nav (all public pages):** หน้าหลัก · กำหนดการ (anchor on home) · ภาพกิจกรรม · ตรวจสอบการสมัคร. Footer has a small admin link.
- **Home:** hero (logo + edition title centered over the edition background) → intro → "รายละเอียดโครงการ" button (modal: PDF in iframe + open-in-new-tab + download fallback) → "สมัคร" button with status line ("เปิดรับสมัครถึง …" / grey "ปิดรับสมัครแล้ว") → key-dates cards (from `editions.key_dates`) → latest gallery photos (hide if none) → footer.
- **Gallery:** year tabs (editions that are not draft and have published albums) → album cards (cover, title, date, count) → photo grid (thumbs) → lightbox with prev/next/close/Esc/arrow keys + focus trap. An album with `external_url` shows an "เปิดอัลบั้มภายนอก" link instead of a grid.
- **Apply:** team name TH/EN; 1..`max_members` members (13-digit student ID, full name, 10-digit phone starting 0); ≥1 advisors (full name, department, faculty); 4-digit PIN + confirm; acknowledgement + PDPA checkboxes (edition texts); Submit label from settings. If registration is closed show the closed message and no form.
  - Live duplicate check with action `student_id_taken` once 13 digits are typed; also check duplicates inside the form. Duplicate → red message, Submit disabled. Never reveal which team.
  - Submit → summary modal → **Confirm** calls action `submit_team`. Only on success: render the slip to PNG (html2canvas) and download it; keep a "บันทึกภาพอีกครั้ง" button (iOS Safari). On failure nothing is downloaded and the form stays.
  - Slip shows ref_no (e.g. ST26-0001), date, both team names, members, advisors, PIN (keep-secret warning), status.
- **Status:** English team name + PIN → action `lookup_team` (current edition). Same error text for "not found" and "wrong PIN"; lock-out message when `reason = 'locked'`. Summary, status badge (`pending` = "รอ admin ตรวจสอบ", `approved` = "การสมัครสำเร็จ"), open upload slots, contact panel + message box. Read-only for team data.
- **Uploads:** browser → action `prepare_upload` (GAS checks name+PIN/slot/type/size, returns a Drive *resumable upload URL*) → browser PUTs the file straight to Google → action `confirm_upload`. Fallback if CORS blocks this (decided in Stage G0): base64 through GAS, small files only.
- **Admin** (ID + password login with 5-failures/15-min lock-out; **TOTP required for the reset**; see `design-reference/Admin.dc.html` and `docs/GAS-DESIGN.md` §4) — 7 tabs:
  1. ภาพรวม — counts, registration status, last backup.
  2. ปี/รอบการจัด — list editions; "create new year" (copies texts + closed slots, starts draft/closed); "set as current"; reg_mode radio (auto/open/closed) + open/close datetimes (Asia/Bangkok in the UI); key dates editor; max members.
  3. เนื้อหาหน้าเว็บ — global texts/logo (Drive folder `public-assets`) and per-edition title, intro, background, PDF, ack/PDPA text.
  4. รายชื่อทีม — search/filter, detail, change status, edit on behalf, delete, reset PIN, CSV export (UTF-8 BOM, formula-safe).
  5. ช่องส่งไฟล์ — CRUD, open/close, view/download.
  6. ภาพกิจกรรม — create album, multi-file upload with **in-browser resize** (long edge ≤ 2000 px JPEG/WebP) to Drive folder `gallery`, optional https `external_url`, publish/unpublish, reorder, delete.
  7. สำรอง/รีเซ็ต — see below.

## Backup and reset (safety-critical)
- **Backup** (done by GAS into the private Drive folder `backups`): copy of the spreadsheet + one CSV per participant sheet + a ZIP of the uploaded files; then record `last_backup_at` and `backup_log`; return the Drive link. Do NOT send backups anywhere automatically; the repo and Pages are public.
- **Reset** via the `admin_purge` action only. Modes: `anonymize` (keep team name, ref_no, status, member count; delete personal data + files; PIN unusable) and `delete` (remove everything of that edition). Guards, all enforced server-side: valid admin session logged in ≤ 10 min ago · password re-entered + TOTP code · confirm text `PURGE <year>` · backup ≤ 24 h · script lock held. Files are deleted **permanently** (Advanced Drive Service), not just trashed. Gallery, edition settings and slot definitions are never touched. UI must disable the button until the guards look satisfied and show the result (counts, files removed/failed).
- MFA is our own TOTP (secret in Script Properties), since GAS has no `aal2`. Admin passwords must be ≥ 12 characters and are stored only as HMAC.

## Visual design (from the approved mockup)
Ink `#0F172A`, page `#F4F6FA`, navy `#0B1D3F` (hero/footer, dot pattern), primary `#1D4ED8`, amber `#FBBF24`, error `#B42318`, success `#067647`, pending bg `#FEF3C7`/fg `#7A4B00`. White cards, radius 12–16 px, inputs min-height 44 px. Details: `design-reference/*.dc.html` (canvas files, open as text).

## Commands
```
npm install
cp .env.example .env.local     # fill in VITE_GAS_URL
npm run dev
npm run build                  # outputs dist/
```
GAS: code in `gas/`; deploy via `clasp push` (or paste into the Apps Script editor), then **Deploy → Manage deployments → Edit → New version** so the `/exec` URL never changes. Run `setup()` once from the editor. Details in `docs/GAS-DESIGN.md`.
Deploy frontend: push to `main`; `.github/workflows/deploy.yml` publishes to Pages (repo variable `VITE_GAS_URL`).

## Working style
- Build in the order of `docs/GAS-DESIGN.md` §9 (Stages G0–G8), one stage at a time; run `npm run build` after each stage.
- Test the rules against the real deployed Web App: duplicate IDs, two simultaneous submits with the same ID, PIN lock after 5 failures, closed registration, window open/close by time, purge guards (no backup / stale login / wrong TOTP / wrong text / non-admin → refused), another edition untouched after purge.
- Ask before adding a dependency or changing a rule in the spec. The architecture decision (GAS) is made — do not reopen it unless something proves impossible in Stage G0.

## Decisions already made
- Backend = Google Apps Script + Sheets + Drive (decided 2026-11-19). Admin sign-in = ID + password (+ TOTP for the reset), decided 2026-11-19.
- Max team size **7** (editable per edition). Min members 1, min advisors 1.
- Registration open/close is set by the admin per edition (mode + datetimes), reusable every year.
- Backup/reset system exists as described above; reset is two-mode and guarded.
- Site is multi-year, conference-style, with a permanent gallery.

## Still open (assume defaults)
1. Retention period for anonymised data and for backup files — university PDPA policy.
2. Keep the PIN-confirm field and committee message box? Default: keep.
3. PDPA text must be approved by the university's legal/DPO (seed text is a placeholder). Photos of people in the gallery need their own notice/consent at the event. Also confirm that storing participant data in Google Sheets/Drive is acceptable, and which Google account (ideally the university Workspace) owns the project.
4. Drive storage/quota: use external album links for big galleries.
5. Phase 2 (not built): winners/results, judges, schedule, news pages per year.
