// Pure validation helpers for the application form (no DOM, no network) so they can be unit-tested with
// `npm test`. The server (gas/Apply.gs) enforces the same rules again — these only help the user early.

export const isStudentId = (v) => /^\d{13}$/.test(String(v ?? ''));
export const isPhone = (v) => /^0\d{9}$/.test(String(v ?? '')); // 10 digits starting with 0 (same as the server)
export const isPin = (v) => /^\d{4}$/.test(String(v ?? ''));

/** Keep digits only and cut to `max` characters (for numeric inputs, also handles pasted text). */
export const digitsOnly = (v, max) => String(v ?? '').replace(/\D/g, '').slice(0, max);

/** Same key the server uses to keep English team names unique: trimmed, single spaces, lower case. */
export const nameKey = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const filled = (v) => String(v ?? '').trim().length > 0;

/** Student IDs (13 digits) that appear more than once in the list. */
export function duplicateIds(ids) {
  const seen = new Set();
  const dup = new Set();
  for (const id of ids) {
    if (!isStudentId(id)) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return dup;
}

/**
 * validateForm(form, { takenIds, pendingIds })
 *   form = { teamTh, teamEn, members:[{id,name,phone}], advisors:[{name,major,faculty}], pin, pin2, ack, pdpa }
 *   takenIds   : Set of student IDs the server said are already registered
 *   pendingIds : Set of student IDs whose live check is still running
 * Returns { members:[{idMsg, phoneMsg, bad}], advisors:[{bad}], pinMsg, blockMsg, ok }.
 * `blockMsg` is the first reason Submit must stay disabled ('' when the form can be submitted).
 */
export function validateForm(form, { takenIds = new Set(), pendingIds = new Set() } = {}) {
  const dups = duplicateIds(form.members.map((m) => m.id));

  const members = form.members.map((m) => {
    let idMsg = '';
    if (isStudentId(m.id) && takenIds.has(m.id)) idMsg = 'รหัสนี้สมัครแล้ว หากคิดว่าผิดพลาดติดต่อฝ่ายจัดงาน';
    else if (dups.has(m.id)) idMsg = 'รหัสซ้ำกับสมาชิกคนอื่นในทีมนี้';
    else if (m.id && !isStudentId(m.id)) idMsg = `ต้องเป็นตัวเลข 13 หลัก (กรอกแล้ว ${String(m.id).length})`;
    const phoneMsg = m.phone && !isPhone(m.phone) ? 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0' : '';
    const bad = !isStudentId(m.id) || Boolean(idMsg) || !filled(m.name) || !isPhone(m.phone);
    return { idMsg, phoneMsg, bad };
  });

  const advisors = form.advisors.map((a) => ({ bad: !filled(a.name) || !filled(a.major) || !filled(a.faculty) }));

  let pinMsg = '';
  if (form.pin && !isPin(form.pin)) pinMsg = 'PIN ต้องเป็นตัวเลข 4 หลัก';
  else if (isPin(form.pin) && form.pin2 && form.pin !== form.pin2) pinMsg = 'PIN สองช่องไม่ตรงกัน';

  let blockMsg = '';
  if (!filled(form.teamTh) || !filled(form.teamEn)) blockMsg = 'กรอกชื่อทีมทั้งภาษาไทยและอังกฤษ';
  else if (members.some((m) => m.idMsg)) blockMsg = 'รหัสนักศึกษาซ้ำหรือไม่ถูกต้อง';
  else if (members.some((m) => m.bad)) blockMsg = 'กรอกข้อมูลสมาชิกให้ครบ';
  else if (form.members.some((m) => pendingIds.has(m.id))) blockMsg = 'กำลังตรวจรหัสนักศึกษา…';
  else if (advisors.some((a) => a.bad)) blockMsg = 'กรอกข้อมูลอาจารย์ที่ปรึกษาให้ครบ';
  else if (!isPin(form.pin) || form.pin !== form.pin2) blockMsg = 'ตั้ง PIN 4 หลักและยืนยันให้ตรงกัน';
  else if (!form.ack || !form.pdpa) blockMsg = 'ติ๊กรับทราบและยินยอม PDPA';

  return { members, advisors, pinMsg, blockMsg, ok: blockMsg === '' };
}

/** The JSON body for action 'submit_team' (trimmed; keys as the server expects them). */
export function buildSubmitPayload(form) {
  return {
    name_th: form.teamTh.trim(),
    name_en: form.teamEn.trim(),
    pin: form.pin,
    members: form.members.map((m) => ({ student_id: m.id, full_name: m.name.trim(), phone: m.phone })),
    advisors: form.advisors.map((a) => ({ full_name: a.name.trim(), department: a.major.trim(), faculty: a.faculty.trim() })),
    ack: form.ack === true,
    pdpa: form.pdpa === true,
  };
}
