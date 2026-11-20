// Client for the Google Apps Script Web App (docs/GAS-DESIGN.md §1).
// Every call is POST + Content-Type text/plain (a "simple" CORS request: no preflight) with a JSON body
// { action, ...payload }. Replies are { ok:true, data } | { ok:false, reason }.
// Only the Web App URL is configured here — it is public by nature. No secret ever belongs in this bundle.

const url = import.meta.env.VITE_GAS_URL;

export const apiConfigured = Boolean(url);

if (!apiConfigured) {
  console.error('Missing VITE_GAS_URL — copy .env.example to .env.local and paste the Web App /exec URL');
}

/** Error carrying the machine-readable `reason` from the server (or 'network' / 'bad_response' / 'not_configured'). */
export class ApiError extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.name = 'ApiError';
    this.reason = reason;
    this.extra = extra; // small public fields next to `reason`, e.g. { attempts_left: 3 }
  }
}

/**
 * api('public_site') -> data
 * api('submit_team', { ... }) -> data        (throws ApiError on { ok:false })
 * Options: { retry: n } extra attempts for a *failed connection* only (use for read-only actions).
 */
export async function api(action, payload = {}, { retry = 0 } = {}) {
  if (!apiConfigured) throw new ApiError('not_configured');
  let lastError;
  let busyTries = 0;
  for (let attempt = 0; attempt <= retry; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch (err) {
      lastError = new ApiError('network');
      lastError.cause = err;
      continue; // connection failed: safe to try again
    }
    let body;
    try {
      body = await res.json();
    } catch {
      throw new ApiError('bad_response'); // e.g. Google sign-in/HTML error page instead of JSON
    }
    if (body && body.ok === false && body.reason === 'busy' && busyTries < 3) {
      // 'busy' = the server could not get its write lock, so NOTHING was written: always safe to ask again.
      busyTries++;
      attempt--; // does not use up a connection retry
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    if (!body || body.ok !== true) {
      const { ok, reason, ...extra } = body || {};
      throw new ApiError(reason || 'server_error', extra);
    }
    return body.data;
  }
  throw lastError;
}

/** Upload a file to Drive with a URL from prepare_*; resolves with the Drive file id. */
export function putToDrive(uploadUrl, file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const id = JSON.parse(xhr.responseText)?.id;
          if (id) return resolve(id);
        } catch {
          /* fall through */
        }
      }
      reject(new Error(`drive ${xhr.status}`));
    };
    xhr.send(file);
  });
}

// Machine-readable reason codes -> Thai text for the UI.
export const errorText = {
  network: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ โปรดตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง',
  not_configured: 'ยังไม่ได้ตั้งค่า VITE_GAS_URL',
  bad_response: 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ โปรดลองอีกครั้ง',
  server_error: 'ระบบขัดข้อง โปรดลองอีกครั้งภายหลัง',
  not_setup: 'ระบบหลังบ้านยังไม่ได้ติดตั้ง (ต้องรัน setup() ใน Apps Script)',
  unknown_action: 'คำสั่งไม่ถูกต้อง',
  busy: 'ระบบกำลังประมวลผลคำขออื่นอยู่ โปรดลองอีกครั้ง',
  rate_limited: 'ส่งคำขอถี่เกินไป โปรดรอสักครู่แล้วลองใหม่',
  registration_closed: 'ขณะนี้ปิดรับสมัครแล้ว',
  consent_required: 'ต้องติ๊กรับทราบและยินยอม PDPA',
  invalid_pin: 'PIN ต้องเป็นตัวเลข 4 หลัก',
  invalid_members: 'จำนวนสมาชิกไม่ถูกต้อง',
  invalid_advisors: 'ต้องมีอาจารย์ที่ปรึกษาอย่างน้อย 1 ท่าน',
  invalid_input: 'ข้อมูลบางช่องไม่ถูกต้อง',
  student_id_taken: 'มีรหัสนักศึกษาที่สมัครแล้ว หากคิดว่าผิดพลาดติดต่อฝ่ายจัดงาน',
  team_name_taken: 'ชื่อทีมภาษาอังกฤษนี้มีผู้ใช้แล้ว',
  submit_failed: 'บันทึกไม่สำเร็จ โปรดลองอีกครั้ง',
  forbidden: 'ไม่มีสิทธิ์ดำเนินการ',
  unauthorized: 'โปรดเข้าสู่ระบบใหม่',
  no_current_edition: 'ยังไม่มีรอบการจัดงานที่เปิดใช้งาน',
  backup_required: 'ต้องสำรองข้อมูลภายใน 24 ชั่วโมงก่อนรีเซ็ต',
  edition_exists: 'มีรอบการจัดงานของปีนี้อยู่แล้ว',
  invalid_credentials: 'ไม่พบทีมหรือ PIN ไม่ถูกต้อง',
  locked: 'กรอกผิดหลายครั้ง ระบบล็อกชั่วคราว 15 นาที — ลองใหม่ภายหลังหรือติดต่อผู้จัดงาน',
  slot_closed: 'ช่องส่งไฟล์นี้ปิดแล้ว',
  deadline_passed: 'เลยกำหนดส่งไฟล์ของช่องนี้แล้ว',
  file_too_large: 'ไฟล์ใหญ่เกินที่กำหนด',
  file_type_not_allowed: 'ชนิดไฟล์นี้ไม่ได้รับอนุญาตสำหรับช่องนี้',
  origin_not_allowed: 'เว็บนี้ยังไม่ได้รับอนุญาตให้อัปโหลดไฟล์ โปรดแจ้งผู้จัดงาน',
  file_not_found: 'ไม่พบไฟล์ที่อัปโหลด โปรดลองส่งใหม่',
  upload_failed: 'อัปโหลดไม่สำเร็จ โปรดลองอีกครั้ง',
  admin_invalid: 'ID หรือรหัสผ่านไม่ถูกต้อง',
  admin_locked: 'กรอกผิดหลายครั้ง ระบบล็อกการเข้าสู่ระบบชั่วคราว 15 นาที',
  password_too_short: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 12 ตัวอักษร',
  password_same: 'รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม',
  totp_not_registered: 'ยังไม่ได้ลงทะเบียนแอป Authenticator (2FA)',
  totp_invalid: 'รหัส 6 หลักไม่ถูกต้อง หรือถูกใช้ไปแล้ว',
  totp_expired: 'หมดเวลาลงทะเบียน โปรดกดเริ่มใหม่',
  not_found: 'ไม่พบข้อมูลที่ต้องการ (อาจถูกลบไปแล้ว)',
  invalid_window: 'เวลาเปิดรับสมัครต้องมาก่อนเวลาปิดรับสมัคร',
  edition_purged: 'รอบนี้ถูกรีเซ็ตข้อมูลแล้ว แก้ไขข้อมูลทีมไม่ได้',
  slot_has_files: 'ช่องนี้มีไฟล์ที่ทีมส่งแล้ว',
  login_too_old: 'เพื่อความปลอดภัย การรีเซ็ตต้องเข้าสู่ระบบไม่เกิน 10 นาทีก่อนหน้า — ออกจากระบบแล้วเข้าสู่ระบบใหม่',
  confirm_mismatch: 'ข้อความยืนยันไม่ตรง ต้องพิมพ์ให้เหมือนที่กำหนดทุกตัวอักษร',
  backup_outdated: 'มีข้อมูลเปลี่ยนไปหลังการสำรองครั้งล่าสุด — สำรองข้อมูลใหม่ก่อนแล้วรีเซ็ตอีกครั้ง',
  already_purged: 'รอบนี้ถูกรีเซ็ตด้วยวิธีนี้แล้ว',
  backup_failed: 'สำรองข้อมูลไม่สำเร็จ (ไฟล์มากหรือใหญ่เกินเวลาที่ระบบให้) — ยังไม่นับว่าสำรองแล้ว ลองอีกครั้งหรือแจ้งผู้ดูแลระบบ',
  purge_failed: 'รีเซ็ตไม่สำเร็จกลางทาง — ข้อมูลบางส่วนอาจถูกลบไปแล้ว ให้สำรองข้อมูลใหม่แล้วลองรีเซ็ตอีกครั้ง และตรวจ audit_log',
  too_many_documents: 'มีเอกสารครบจำนวนสูงสุดต่อปีแล้ว — ลบเอกสารที่ไม่ใช้ก่อน',
  invalid_url: 'ลิงก์ต้องขึ้นต้นด้วย https:// และเป็นที่อยู่เว็บที่ถูกต้อง',
  album_has_photos: 'อัลบั้มนี้มีรูปอยู่ — ลบรูปออกก่อนจึงจะตั้งเป็นลิงก์ภายนอกได้',
  album_is_external: 'อัลบั้มที่เป็นลิงก์ภายนอกอัปโหลดรูปไม่ได้',
};

/** Thai message for any error thrown by api(). */
export function messageFor(err) {
  return errorText[err?.reason] ?? errorText.server_error;
}
