# Sci-Tech Pitching — เว็บรับสมัครทีม + ภาพกิจกรรม (ใช้ซ้ำได้ทุกปี)

เว็บภาษาไทยสำหรับการประกวดนำเสนอโครงงาน: หน้าหลัก · ภาพกิจกรรม (เก็บถาวรแยกตามปี) · สมัครทีม · ตรวจสอบการสมัคร · ระบบผู้ดูแล
หน้าเว็บเป็น Vite + JavaScript บน **GitHub Pages**; หลังบ้านเป็น **Google Apps Script Web App** ใช้ **Google Sheets** เก็บข้อมูลและ **Google Drive** เก็บไฟล์

- เว็บจริง: https://ncrmutr.github.io/scifairregistration/
- **ดูแลระบบ / งานประจำปี / แก้ปัญหา → [`docs/OPERATIONS.md`](docs/OPERATIONS.md)**
- สถาปัตยกรรมหลังบ้าน → [`docs/GAS-DESIGN.md`](docs/GAS-DESIGN.md) (แทนทุกส่วนที่พูดถึง Supabase)
- ความต้องการและกติกา → [`docs/SPEC.md`](docs/SPEC.md) · กติกาสำหรับ Claude Code → [`CLAUDE.md`](CLAUDE.md)

> ประวัติ: ออกแบบแรกใช้ Supabase; วันที่ 2026-11-19 ย้ายมา Google Apps Script (ผู้ใช้น้อย ดูแลง่าย) โฟลเดอร์ `supabase/`, `INSTALL.md` และ `docs/PROMPTS.md` ถูกลบแล้ว (ยังดูได้จากประวัติ git)

## เริ่มพัฒนา

```
npm install
cp .env.example .env.local     # ใส่ VITE_GAS_URL (URL /exec ของ Web App)
npm run dev
npm test                       # กติกาของ gas/*.gs บนชีต/Drive จำลอง
npm run build
```

## โครงสร้าง

| Path | คืออะไร |
|---|---|
| `src/` | หน้าเว็บ (`pages/`, `lib/`, `styles.css`) — hash router, ไม่มีเฟรมเวิร์ก UI |
| `gas/` | โค้ด Apps Script (`Code.gs` router, `Public.gs`, `Apply.gs`, `Team.gs`, `Admin*.gs`, `Gallery.gs`, `Backup.gs`, `Setup.gs`) |
| `test/` | `validators.test.js` และ `test/gas/` (รันโค้ด `gas/*.gs` ตัวจริงบนตัวจำลอง Sheets/Drive) |
| `design-reference/` | ภาพออกแบบหน้าเว็บที่อนุมัติแล้ว |
| `.github/workflows/deploy.yml` | build + เผยแพร่ GitHub Pages เมื่อ push เข้า `main` |
| `vite.config.js` | build + Content-Security-Policy |

ไม่มีความลับใดอยู่ใน repo หรือบันเดิลหน้าเว็บ — pepper รหัส PIN, แฮชรหัสผ่าน Admin, TOTP และ ID โฟลเดอร์ Drive อยู่ใน Script Properties ของ Apps Script เท่านั้น
