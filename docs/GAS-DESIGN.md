# การออกแบบใหม่: Google Apps Script (GAS) เป็นหลังบ้าน

ตัดสินใจเมื่อ 2026-11-19: **เปลี่ยนหลังบ้านจาก Supabase เป็น Google Apps Script + Google Sheets + Google Drive** (หน้าบ้านยังเป็น Vite + vanilla JS บน GitHub Pages)
เอกสารนี้แทนที่ส่วนที่พูดถึง Supabase ใน `docs/SPEC.md`, `docs/PROMPTS.md`, `INSTALL.md`, `README.md` — **กติกาธุรกิจ หน้าตา และพฤติกรรมของแต่ละหน้าใน SPEC.md ยังใช้เหมือนเดิมทุกข้อ** เปลี่ยนเฉพาะ "ใครเป็นคนบังคับกติกา"
ไฟล์ใน `supabase/` เก็บไว้เป็นต้นแบบตรรกะเท่านั้น (ห้ามใช้ deploy)

## 1. ภาพรวม

```
เบราว์เซอร์ (GitHub Pages)  ──POST text/plain──▶  GAS Web App (/exec)  ──▶  Google Sheets (ข้อมูล)
        │                                              │                    Google Drive (ไฟล์)
        └── อัปโหลดไฟล์ตรงไป Drive (resumable URL ที่ GAS ออกให้) ◀────────────┘
```

- Web App ตั้งค่า **Execute as: Me**, **Who has access: Anyone** (ผู้ใช้ไม่ต้องล็อกอิน Google) — ความปลอดภัยทั้งหมดมาจากโค้ดใน GAS
- ทุกคำขอเป็น `POST` แบบ `Content-Type: text/plain` (simple request ไม่มี preflight จึงเลี่ยงปัญหา CORS ของ GAS): body = `{"action":"…", …, "session":"…"}` ตอบ `{"ok":true,"data":…}` หรือ `{"ok":false,"reason":"<รหัส>"}`
- รหัส error ชุดเดิม (`rate_limited`, `registration_closed`, `student_id_taken`, `team_name_taken`, `consent_required`, `invalid_*`, `forbidden`, `backup_required`, …) แมปเป็นข้อความไทยใน `src/lib/api.js`
- เขตเวลาของสคริปต์ = `Asia/Bangkok` (`appsscript.json`) ใช้นาฬิกาเซิร์ฟเวอร์ (`new Date()`) ตัดสินการเปิด/ปิดรับสมัคร

## 2. ข้อมูล: Google Spreadsheet 1 ไฟล์ (ส่วนตัว — แชร์เฉพาะเจ้าของ/แอดมิน ห้ามแชร์ลิงก์ให้นักศึกษา)

| แท็บ | หน้าที่ (เทียบของเดิม) |
|---|---|
| `site_settings` | key / value (ค่าทั้งเว็บ) |
| `editions` | หนึ่งแถวต่อปี: year, title, subtitle, intro_text, background_file_id, rules_pdf_file_id, ack_text, pdpa_text, key_dates (JSON), max_members, reg_mode, registration_opens_at, registration_closes_at, ref_prefix, ref_counter, is_current, status, last_backup_at, purged_at, purge_mode |
| `teams` | id, edition_id, ref_no, name_th, name_en, name_en_key, pin_hash, pin_salt, status, members_count_at_purge, created_at |
| `members` / `advisors` / `consents` | เหมือนเดิม (members มี edition_id + student_id) |
| `upload_slots` / `uploads` / `messages` | เหมือนเดิม (uploads เก็บ drive_file_id แทน path) |
| `gallery_albums` / `gallery_photos` | เหมือนเดิม (photo เก็บ drive_file_id) |
| `lookup_attempts` | key, fails, window_start, locked_until (ล็อก PIN) |
| `backup_log` / `audit_log` | เหมือนเดิม |

ข้อกำหนดการเขียนข้อมูล (สำคัญ):
- **ทุกคอลัมน์ที่เป็นข้อความตั้ง number format เป็น Plain text (`@`)** ก่อนเขียน — กัน formula injection (ค่าที่ขึ้นต้นด้วย `= + - @`) และรักษาเลขศูนย์นำหน้าของรหัสนักศึกษา/เบอร์โทร
- การส่งออก CSV ต้องใส่ `'` นำหน้าค่าที่ขึ้นต้นด้วย `= + - @` (กัน formula injection เมื่อเปิดด้วย Excel)
- ID ทุกแถวสร้างด้วย `Utilities.getUuid()`

## 3. กติกาที่ต้อง "บังคับในโค้ด" (แทน constraint/RLS ของ Postgres)

| กติกา | วิธีทำใน GAS |
|---|---|
| รหัสนักศึกษาไม่ซ้ำในรอบเดียวกัน, ชื่อ EN ไม่ซ้ำ, จำนวนสมาชิก ≤ `max_members` | ตรวจและเขียนภายใน `LockService.getScriptLock().waitLock(…)` เดียวกัน (อ่านคอลัมน์ → ตรวจ → เขียนทีม/สมาชิก/ที่ปรึกษา/consent ทีเดียว) ถ้าเขียนไม่ครบให้ลบแถวที่เขียนไปแล้ว (rollback ด้วยมือ) |
| ปิด/เปิดรับสมัคร | ฟังก์ชัน `registrationOpen(edition)` ตรรกะเดียวกับ `_registration_open` เดิม; `submit_team` ตรวจซ้ำ |
| PIN | เก็บ `HMAC-SHA256(pepper, teamId + ":" + pin)`; **pepper เก็บใน Script Properties** (สร้างตอน `setup()`) ไม่อยู่ในชีต — ถ้าชีตรั่วก็ยังเดา PIN 10,000 แบบไม่ได้ |
| ล็อก PIN 5 ครั้ง/15 นาที | แท็บ `lookup_attempts` นับแม้ไม่มีทีมนั้น ข้อความเดียวกันทั้ง "ไม่พบ" และ "PIN ผิด" (เทียบเวลาให้เท่ากัน) |
| จำกัดอัตรา | **ทำต่อ IP ไม่ได้** (GAS ไม่เห็น IP) จึงใช้ตัวนับรวมต่อ action ต่อนาทีใน `CacheService` (เช่น `student_id_taken` ≤ 120/นาทีทั้งระบบ) กันสุ่มกวาดข้อมูลแบบหยาบ — **จุดอ่อนที่ยอมรับ** เทียบกับของเดิม |
| anon อ่านข้อมูลทีมไม่ได้ | ไม่มีทางตรง: Sheet เป็นส่วนตัว เข้าถึงได้ผ่าน action ที่โค้ดเขียนไว้เท่านั้น action สาธารณะคืนเฉพาะ field ที่อนุญาต |
| Audit log | ทุก action ของ admin เขียนลง `audit_log` |

## 4. Admin ล็อกอิน (ID + รหัสผ่าน — ตัดสินใจ 2026-11-19)

- หน้า `#/admin` มีช่อง **ID** (เช่นอีเมลองค์กร) + **รหัสผ่าน** → action `admin_login` → GAS เทียบกับ `ADMIN_USERS` ใน Script Properties (เก็บเป็น HMAC ของรหัสผ่าน ไม่เก็บรหัสจริง) แล้วออก **session token** แบบสุ่ม (เก็บใน `CacheService` อายุ 2 ชม.) ส่งไปกับทุก action ของ admin
- ล็อกอินผิด 5 ครั้ง/15 นาทีถูกล็อก (นับรวมทั้งระบบ ไม่ใช่ต่อ IP — ผู้โจมตีอาจทำให้ admin ล็อกอินไม่ได้ชั่วคราวได้ ยอมรับ)
- **ห้ามเก็บ ID/รหัสผ่านจริงในโค้ด เอกสาร หรือ repo** ตั้งรหัสผ่านครั้งแรก (หรือเมื่อลืมรหัส): ใส่ Script Property ชั่วคราว `NEW_ADMIN_ID` และ `NEW_ADMIN_PASSWORD` (Project Settings → Script properties) แล้วเลือกฟังก์ชัน `createAdmin` กด Run ในตัวแก้ไข — ฟังก์ชันแฮชแล้วลบทั้งสอง property ทิ้ง (ลืม TOTP: `resetAdminTotp` กับ `NEW_ADMIN_ID`); หน้า admin มีปุ่มเปลี่ยนรหัสผ่าน; ระบบปฏิเสธรหัสที่สั้นกว่า 12 ตัวอักษร
- **MFA เฉพาะรายการอันตราย (รีเซ็ตข้อมูล):** admin ลงทะเบียน **TOTP** (แอป Authenticator) ครั้งเดียว (secret เก็บใน Script Properties ไม่ใช่ในชีต) การรีเซ็ตต้องกรอกรหัสผ่านซ้ำ + รหัส 6 หลักจากแอป ณ ตอนทำรายการ — ใช้แทน `aal2` เดิม (*ค่าเริ่มต้นที่เสนอ รอผู้ใช้ยืนยันว่าจะบังคับ TOTP ตอนล็อกอินทุกครั้งด้วยหรือไม่*)
- ไม่ต้องใช้ Google Cloud / OAuth

## 5. ไฟล์ (Google Drive)

โฟลเดอร์ที่ `setup()` สร้างให้ (เจ้าของ = บัญชีที่รันสคริปต์):

| โฟลเดอร์ | สิทธิ์ | เก็บอะไร |
|---|---|---|
| `public-assets` | ใครมีลิงก์ดูได้ | โลโก้, ภาพพื้นหลัง, PDF |
| `gallery` | ใครมีลิงก์ดูได้ | ภาพกิจกรรม (ย่อในเบราว์เซอร์ด้านยาว ≤ 2000 px) |
| `team-files` | **ส่วนตัว** | ไฟล์ที่ทีมส่ง |
| `backups` | **ส่วนตัว** | ไฟล์สำรอง |

- **อัปโหลดจากเบราว์เซอร์:** GAS ตรวจสิทธิ์/ชนิด/ขนาดแล้วเรียก Drive API เปิด *resumable upload session* (ด้วย `ScriptApp.getOAuthToken()`) ส่ง URL ให้เบราว์เซอร์ PUT ไฟล์ตรงไป Google แล้วเรียก `confirm_upload` ให้ GAS ตรวจว่าไฟล์อยู่ในโฟลเดอร์ที่ถูกต้องและขนาดตรงก่อนบันทึก (เทียบกับ signed URL เดิม) — **ต้องพิสูจน์ใน Stage G0** ว่า CORS จากโดเมน GitHub Pages ใช้ได้; ถ้าไม่ได้ ถอยไปส่ง base64 ผ่าน GAS (จำกัดไฟล์ ≤ ~5 MB)
- **แสดงผลสาธารณะ:** รูป `https://drive.google.com/thumbnail?id=<id>&sz=w480` (หรือ `w2000`), PDF ใน iframe `https://drive.google.com/file/d/<id>/preview`, ดาวน์โหลด `https://drive.google.com/uc?export=download&id=<id>` — URL เหล่านี้ไม่ใช่ API ทางการ อาจเปลี่ยน/ถูกจำกัดการโหลดซ้ำ (**ตรวจใน G0**) ภาพชุดใหญ่แนะนำใช้ `external_url`
- **ลบจริง:** รีเซ็ตต้องลบไฟล์แบบถาวร (ไม่ใช่แค่ถังขยะ) ด้วย Advanced Drive Service `Drive.Files.remove`

## 6. สำรองและรีเซ็ต (เปลี่ยนจากเดิม)

- **สำรอง:** GAS สร้างในโฟลเดอร์ `backups` (ส่วนตัว): สำเนา Spreadsheet (`makeCopy`) + CSV ต่อแท็บ + ZIP ไฟล์ที่ทีมส่ง แล้วบันทึก `last_backup_at` + `backup_log` และคืนลิงก์ให้ admin — ข้อมูลไม่ผ่านเครื่อง admin (หน้า admin ยังมีปุ่มส่งออก CSV รายชื่อทีมตามเดิม) ไม่ส่งไปที่ใดอัตโนมัติ
- **รีเซ็ต** (`anonymize` / `delete` เหมือนเดิม) ต้องผ่านครบ: session ของ admin ที่ล็อกอินภายใน 10 นาที · รหัสผ่านซ้ำ + รหัส TOTP · พิมพ์ `PURGE <ปี>` · สำรองภายใน 24 ชม. · ถือ script lock · ลบแถวก่อน แล้วลบไฟล์ใน Drive แบบถาวร และรายงานไฟล์ที่ลบไม่ได้ · เขียน audit_log · ไม่แตะภาพกิจกรรม/ข้อความ/ช่องส่งไฟล์/รอบอื่น

## 7. ข้อจำกัดที่ต้องรู้

- ตอบช้ากว่า Supabase (ประมาณ 1–3 วินาที/คำขอ) และมี cold start; `public_site` แคชใน `CacheService` 60 วินาที (ล้างแคชเมื่อ admin แก้)
- ผู้ใช้พร้อมกันมากๆ ตอนวันปิดรับสมัคร: คำขอเขียนต้องต่อคิวผ่าน lock (หลายสิบทีมพร้อมกันยังไหว) มีโควตาของ Google ต่อวัน — ทดสอบก่อนใช้จริง
- ข้อมูลส่วนบุคคลอยู่ใน Google Sheets/Drive ของบัญชีเจ้าของ → **ต้องให้ฝ่ายกฎหมาย/DPO ยืนยันว่าเก็บบน Google ได้**, ใช้บัญชีองค์กร (Workspace) และมีผู้รับช่วงเมื่อเจ้าของลาออก
- ผู้ที่แก้ Spreadsheet ได้ตรงๆ ข้ามกติกาทั้งหมดได้ → แชร์ชีตให้น้อยที่สุด
- GAS deploy: แก้โค้ดแล้วต้อง **Manage deployments → Edit → New version** (URL เดิม) ไม่ใช่สร้าง deployment ใหม่ ไม่งั้น URL เปลี่ยน

## 8. โครงสร้างโค้ด

```
gas/                      โค้ดฝั่ง GAS (push ด้วย clasp หรือวางในตัวแก้ไข)
  appsscript.json         timezone, scopes, webapp config
  Code.gs                 doPost router + ตัวห่อ error/lock/rate limit
  Setup.gs                setup(): สร้างแท็บ โฟลเดอร์ pepper ข้อมูลเริ่มต้น
  Public.gs               public_site (+ Drive URL helpers, registrationOpen_)
  Apply.gs                student_id_taken, submit_team
  Team.gs                 lookup_team, send_message, prepare_upload, confirm_upload (all via verifyTeam_ = name+PIN, lock-out, inside the lock)
                          uploads go to team-files/<year>/<ref_no>_<team id prefix>/ so a whole edition can be removed by folder
  Admin.gs                ล็อกอิน/session/TOTP/audit/overview
  AdminData.gs            action ของ admin: ปี/เนื้อหา/ทีม/ช่องส่งไฟล์ (backup/purge จะเพิ่มใน G6)
  Gallery.gs              ภาพกิจกรรม: public_gallery, public_album (สาธารณะ) + admin_albums/admin_album/admin_save_album/
                          admin_reorder_albums/admin_delete_album/admin_prepare_photo/admin_confirm_photo/admin_update_photo/
                          admin_set_cover/admin_reorder_photos/admin_delete_photo — รูปเก็บในโฟลเดอร์ gallery (สาธารณะ) ย่อในเบราว์เซอร์
                          (src/lib/image.js) ก่อนส่ง; อัลบั้มที่ยังไม่มีรูปและไม่มีลิงก์ภายนอกจะไม่แสดงบนเว็บ
  Db.gs                   helper อ่าน/เขียนชีต (plain-text, index, rollback)
src/lib/api.js            เรียก GAS + errorText (แทน supabase.js)
```
**Script Properties ที่ `setup()` สร้าง (Stage G1):** `SHEET_ID`, `FOLDER_ROOT`, `FOLDER_PUBLIC_ASSETS`, `FOLDER_GALLERY`, `FOLDER_TEAM_FILES`, `FOLDER_BACKUPS`, `PEPPER`, `ALLOWED_ORIGINS` (ใช้ตรวจ origin ตอนออก upload URL — เพิ่มโดเมน GitHub Pages ใน G8) · `site_settings` เก็บเฉพาะข้อความ (คีย์สาธารณะ: `site_name`, `details_button_label`, `apply_button_label`, `submit_label`, `footer_text`, `contact_info`, `gallery_intro`; ไฟล์โลโก้ใช้ `logo_file_id`) · `public_site` ตอบ URL ของ Drive ที่พร้อมใช้ (`logo_url`, `background_url`, `rules_pdf.{preview,view,download}_url`, `latest_photos[].thumb_url`) และแคชข้อมูลจากชีต 60 วินาที ส่วน `server_time`/`registration_open` คำนวณใหม่ทุกครั้ง

Frontend env: `VITE_GAS_URL` (ลิงก์ `/exec`) เท่านั้น — ไม่มีความลับใดอยู่ใน repo/เบราว์เซอร์ (pepper, แฮชรหัสผ่าน admin, TOTP secret, ID โฟลเดอร์ อยู่ใน Script Properties)

## 9. ลำดับการสร้างใหม่ (แทน `docs/PROMPTS.md`)

| Stage | งาน | สิ่งที่ผู้ใช้ต้องทำ |
|---|---|---|
| G0 | **Spike พิสูจน์ 4 เรื่อง:** POST จาก GitHub Pages/localhost ได้, resumable upload ตรงจากเบราว์เซอร์ได้, URL รูป/PDF จาก Drive แสดงได้, ล็อกอิน admin + session ใน CacheService ทำงานได้ | สร้าง GAS project + deploy Web App (ผมให้โค้ดและขั้นตอน) |
| G1 | `Setup.gs` + `public_site` + `src/lib/api.js`; ปรับหน้าหลัก (Stage 1 เดิม) ให้ใช้ API ใหม่; เอา `@supabase/supabase-js` ออก | รัน `setup()` 1 ครั้ง ใส่ `VITE_GAS_URL` |
| G2 | หน้าสมัคร (`student_id_taken`, `submit_team` + lock) + ใบสรุป PNG | ทดสอบสมัครซ้ำ/พร้อมกัน |
| G3 | หน้าตรวจสอบ + ล็อก PIN + อัปโหลด + ข้อความถึงกรรมการ | — |
| G4 | Admin: ล็อกอิน ID + รหัสผ่าน (+TOTP สำหรับรีเซ็ต) + แท็บภาพรวม/ปี/เนื้อหา/ทีม/ช่องส่งไฟล์ | ตั้งรหัสผ่าน admin ตามข้อ 4 (ใหม่ ยาว ≥ 12 ตัว), ลงทะเบียน TOTP |
| G5 | ภาพกิจกรรม (หน้า gallery + แท็บ admin) | — |
| G6 | สำรอง/รีเซ็ต | ทดสอบกับรอบทดลอง |
| G7 | ทดสอบความปลอดภัย (สมัครพร้อมกัน, ล็อก PIN, ปิดรับสมัคร, guard รีเซ็ต, สิทธิ์) | ทดสอบมือถือ |
| G8 | Deploy (GitHub Pages variables, ตรวจ URL `/exec`) | ตั้งค่า repo |
