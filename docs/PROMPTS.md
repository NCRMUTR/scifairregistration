# Prompts for Claude Code — paste one stage at a time

> **Obsolete since 2026-11-19 (backend moved to Google Apps Script).** Use the new stage list G0–G8 in `docs/GAS-DESIGN.md` §9. The prompts below remain useful only for the *frontend behaviour* of each page; replace every Supabase/RPC/Edge Function/RLS mention with the GAS actions described in `docs/GAS-DESIGN.md`.

(The site is multi-year: every stage must respect the *current edition* concept in CLAUDE.md.)

Run `claude` in the project root. `CLAUDE.md` is loaded automatically. After each stage: `npm run build`, try it in the browser, commit.

---
## Stage 0 — Orientation (no code changes)
```
Read CLAUDE.md, docs/SPEC.md, supabase/*.sql and the files in design-reference/. Summarise in 10 lines what you will build,
list anything in the spec that is ambiguous or conflicts with the SQL, and propose the file structure under src/.
Do not write code yet.
```

## Stage 1 — Shared foundation + Home page
```
Build the shared foundation and the Home page (#/):
- src/lib: supabase client (exists), settings loader (reads public site_settings once, caches), tiny DOM helpers, modal component with focus trap + Esc to close.
- src/styles.css using the design tokens in CLAUDE.md (mobile-first, works at 360px).
- Home page exactly as described in CLAUDE.md and shown in design-reference/Main.dc.html: hero, intro, details button -> PDF modal (iframe + open-in-new-tab + download), apply button (disabled/grey when registration_open is false), footer. Public asset URLs come from the `public-assets` bucket.
- Top nav (หน้าหลัก, กำหนดการ, ภาพกิจกรรม, ตรวจสอบการสมัคร); footer link to #/admin.
- Read everything public from rpc('public_site'): settings, current edition (title, intro, background, PDF, key_dates, registration_open, max_members) and the years list. Apply button shows "เปิดรับสมัครถึง …" or grey "ปิดรับสมัครแล้ว". Key-dates cards and a latest-photos strip (hidden when there are no published photos).
Show me how to test it against my Supabase project.
```

## Stage 2 — Apply page
```
Build #/apply per CLAUDE.md and design-reference/Apply.dc.html:
- Dynamic members (1..max_members of the current edition) and advisors (>=1, unlimited), validation rules from docs/SPEC.md.
- Live duplicate check via rpc('student_id_taken') (debounced) plus duplicates inside the form; Submit disabled while any error remains.
- Submit -> summary modal -> Confirm -> rpc('submit_team'). Map error messages with errorText in src/lib/supabase.js.
- After success: render the slip with html2canvas and download it immediately; success view with a "save image again" button.
- Do not download anything if Confirm fails; keep the form data.
Write unit tests for the pure validators (student ID, phone, PIN, English-name key).
```

## Stage 3 — Status page + uploads + contact
```
Build #/status per CLAUDE.md and design-reference/Status.dc.html: lookup via rpc('lookup_team'), lock-out message, summary, status badge,
open upload slots (request-upload Edge Function -> uploadToSignedUrl -> rpc('confirm_upload')), contact panel and message box (rpc('send_message')).
Client-side check file size/extension before requesting the signed URL (the server re-checks).
```

## Stage 4 — Admin
```
Build #/admin per CLAUDE.md and design-reference/Admin.dc.html using Supabase Auth (email+password), guarded by public.is_admin().
Build the tabs overview, site content (global site_settings + per-edition fields; upload logo/background/PDF to public-assets),
teams (search/filter, detail, change status, edit on behalf, delete, reset PIN via admin_reset_pin, CSV export with UTF-8 BOM),
upload slots (CRUD, open/close, view/download via signed URLs). The editions, gallery and backup/reset tabs come in Stages 4b–4d.
Include an MFA enrolment/verify screen (Supabase auth.mfa) — purge needs aal2.
Admin page must not be linked from public pages except the small footer link.
```

## Stage 4b — Editions (multi-year + registration window)
```
Add the "ปี/รอบการจัด" admin tab per design-reference/Admin.dc.html: list editions with status chips; create new year via rpc('admin_create_edition', {p_year, p_copy_from});
set current via rpc('admin_set_current_edition'); per-edition form: reg_mode radio (auto/open/closed), opens/closes datetime-local (interpret as Asia/Bangkok, store timestamptz),
key dates editor (editions.key_dates json), max_members (1..20). Wire the Home apply button and #/apply closed state to public_site().registration_open.
Explain how to test: auto window before/inside/after, open and closed overrides, new edition starts closed, same student ID allowed in a new edition.
```

## Stage 4c — Gallery
```
Build #/gallery (year tabs, album cards, photo grid, accessible lightbox with focus trap/Esc/arrow keys, external_url albums) and the admin "ภาพกิจกรรม" tab:
create/edit/delete album, multi-file upload with in-browser resize (canvas; long edge <= 2000px, thumb 480px, JPEG/WebP quality ~0.82) to bucket `gallery`
under <edition year>/<album id>/, publish toggle, reorder, cover photo. Also the latest-photos strip on Home. Show upload progress and per-file errors.
Test: anon sees only published albums of non-draft editions; unpublished/draft are invisible.
```

## Stage 4d — Backup and reset
```
Build the admin "สำรอง/รีเซ็ต" tab per CLAUDE.md and design-reference/Admin.dc.html.
1. Backup: using admin RLS selects, build a ZIP in the browser (CSV with UTF-8 BOM + data.json + files/ via signed URLs), trigger the download, then call rpc('admin_mark_backup').
2. Reset: call the Edge Function admin-purge with the admin access token, {edition_id, mode, confirm: 'PURGE <year>'}. Disable the button until backup <= 24h and the confirm text matches; show counts and files_failed.
Never delete participant data from the browser directly. Test every refusal: no backup, no MFA (aal1), wrong confirm text, non-admin token; and that other editions and the gallery are untouched.
```

## Stage 5 — Hardening and tests
```
1. Write a script or manual checklist that proves: two simultaneous Confirm calls with the same student ID -> exactly one succeeds;
   5 wrong PINs -> locked 15 minutes; wrong name and wrong PIN give the same message; anon cannot select from teams/members/advisors/uploads;
   anon cannot call _prepare_upload or admin_reset_pin; closed registration blocks submit_team; registration auto-opens/closes by server time; purge refuses without backup/MFA/confirm; anon cannot call admin_create_edition or _purge_edition; anon cannot see unpublished albums.
2. Fix anything that fails. Do not loosen RLS.
3. Test on iPhone Safari and Android Chrome: slip download fallback, PDF modal fallback, form usability at 360px.
```

## Stage 6 — Deploy
```
Walk me through first deployment: GitHub Pages source, repo variables, both Edge Functions (request-upload with --no-verify-jwt, admin-purge with JWT verification on) and secrets (ALLOWED_ORIGIN),
and a post-deploy smoke test list. Update README.md with the final URLs and any steps that changed.
```
