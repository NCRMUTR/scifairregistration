// #/status  Application check: English team name + PIN -> summary, status, open upload slots, message to the committee.
// The PIN is kept only in this closure (never in storage, URL or DOM) and is re-sent with each action, because the
// server re-verifies (team, PIN) — and counts failures — on every call.
import { h } from '../lib/dom.js';
import { api, messageFor, putToDrive } from '../lib/api.js';
import { loadSite, setting } from '../lib/site.js';
import { mountShell } from '../lib/layout.js';
import { formatThaiDateTime } from '../lib/format.js';
import { digitsOnly, isPin } from '../lib/validators.js';

const STATUS = {
  pending: { text: 'รอ admin ตรวจสอบ', cls: 'badge-pending', hint: 'ใบสมัครถูกบันทึกแล้ว อยู่ระหว่างรอ admin ตรวจสอบข้อมูล' },
  approved: { text: 'การสมัครสำเร็จ', cls: 'badge-approved', hint: 'admin ตรวจสอบเรียบร้อยแล้ว ทีมของคุณมีสิทธิ์เข้าร่วมการประกวด' },
};

const MAX_MESSAGE = 2000;

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileExt(name) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export async function render(root) {
  let site = null;
  try {
    site = await loadSite();
  } catch {
    /* the page still works; footer falls back to defaults */
  }
  document.title = `ตรวจสอบการสมัคร — ${setting(site, 'site_name', 'Sci-Tech Pitching')}`;
  const main = mountShell(root, { site });
  const page = h('div', { class: 'form-page' });
  main.append(page);

  let creds = null; // { name_en, pin } — memory only

  // ───────────── lookup form ─────────────
  function showForm(prefillName = '', note = null, noteClass = 'banner-ok') {
    creds = null;
    const nameInput = h('input', { class: 'inp', id: 'st-name', type: 'text', autocomplete: 'off', maxlength: 120, value: prefillName });
    const pinInput = h('input', { class: 'inp pin', id: 'st-pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 4 });
    pinInput.addEventListener('input', () => {
      const v = digitsOnly(pinInput.value, 4);
      if (v !== pinInput.value) pinInput.value = v;
    });
    const err = h('p', { class: 'msg-err', role: 'alert', hidden: true });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, 'ตรวจสอบ');

    const form = h(
      'form',
      { class: 'panel narrow-panel', novalidate: true },
      h('p', { class: 'panel-hint' }, 'กรอกชื่อทีมภาษาอังกฤษและ PIN 4 หลักที่ตั้งไว้ตอนสมัคร'),
      note ? h('div', { class: noteClass, role: 'alert' }, note) : null,
      h('div', { class: 'field' }, h('label', { for: 'st-name' }, 'ชื่อทีม (ภาษาอังกฤษ)'), nameInput),
      h('div', { class: 'field narrow' }, h('label', { for: 'st-pin' }, 'PIN 4 หลัก'), pinInput),
      err,
      submit,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const pin = pinInput.value;
      const fail = (text) => {
        err.textContent = text;
        err.hidden = false;
      };
      if (!name || !isPin(pin)) return fail('กรอกชื่อทีมภาษาอังกฤษและ PIN 4 หลักให้ครบ');
      err.hidden = true;
      submit.disabled = true;
      submit.textContent = 'กำลังตรวจสอบ…';
      try {
        const data = await api('lookup_team', { name_en: name, pin });
        creds = { name_en: name, pin };
        showResult(data);
      } catch (error) {
        submit.disabled = false;
        submit.textContent = 'ตรวจสอบ';
        pinInput.value = '';
        if (error.reason === 'invalid_credentials') {
          const left = error.extra?.attempts_left;
          fail(`${messageFor(error)}${typeof left === 'number' ? ` (เหลืออีก ${left} ครั้งก่อนล็อกชั่วคราว)` : ''}`);
        } else {
          fail(messageFor(error));
        }
        pinInput.focus();
      }
    });

    page.replaceChildren(h('h1', 'ตรวจสอบการสมัคร'), form);
    nameInput.focus({ preventScroll: true });
  }

  // ───────────── result ─────────────
  function showResult(data) {
    const st = STATUS[data.team.status] ?? STATUS.pending;
    const heading = h('h1', { tabindex: '-1' }, 'ตรวจสอบการสมัคร');

    const summary = h(
      'section',
      { class: 'panel', 'aria-label': 'สรุปใบสมัคร' },
      h(
        'div',
        { class: 'status-top' },
        h('div', null, h('div', { class: 'team-th' }, data.team.name_th), h('div', { class: 'team-en' }, data.team.name_en)),
        h('div', { class: 'status-side' }, h('span', { class: `badge ${st.cls}` }, st.text), h('span', { class: 'slip-small' }, `เลขที่ ${data.team.ref_no}`)),
      ),
      h('p', { class: 'panel-hint' }, st.hint),
      data.team.created_at ? h('p', { class: 'slip-small' }, `สมัครเมื่อ ${formatThaiDateTime(data.team.created_at)}`) : null,
      h('h2', { class: 'sub-h' }, `สมาชิก ${data.members.length} คน`),
      data.members.map((m) =>
        h('div', { class: 'person-line' }, h('strong', `${m.order_no}. ${m.full_name}`), h('span', m.student_id), h('span', m.phone)),
      ),
      h('h2', { class: 'sub-h' }, 'อาจารย์ที่ปรึกษา'),
      data.advisors.map((a) => h('div', { class: 'person-line' }, h('span', `${a.full_name} · ${a.department} · ${a.faculty}`))),
      h('p', { class: 'slip-small' }, 'PIN ไม่แสดงซ้ำในหน้านี้ · หากต้องการแก้ไขข้อมูล โปรดติดต่อผู้จัดงานผ่านช่องทางด้านล่าง'),
    );

    page.replaceChildren(heading, summary, buildUploads(data), buildMessageBox(site), h('div', { class: 'action-row' }, backButton()));
    heading.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function backButton() {
    return h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => showForm() }, 'ออกจากหน้านี้');
  }

  // ───────────── uploads ─────────────
  function buildUploads(data) {
    const panel = h('section', { class: 'panel', 'aria-labelledby': 'up-title' }, h('h2', { id: 'up-title' }, 'ส่งเอกสารเพิ่มเติม'));
    if (!data.slots.length) {
      panel.append(h('p', { class: 'empty-note' }, 'ขณะนี้ยังไม่มีช่องส่งไฟล์ที่เปิดอยู่ หากมีการเปิดช่องส่งไฟล์ ผู้จัดงานจะแจ้งให้ทราบ'));
      return panel;
    }
    data.slots.forEach((slot) => panel.append(buildSlot(slot)));
    return panel;
  }

  function buildSlot(slot) {
    const rule = [`ไฟล์ ${slot.accept.map((x) => x.toUpperCase()).join('/')} ไม่เกิน ${slot.max_mb} MB`];
    if (slot.deadline) rule.push(`${slot.deadline_passed ? 'เลยกำหนดส่ง' : 'ส่งภายใน'} ${formatThaiDateTime(slot.deadline)}`);

    const stateEl = h('div', { class: 'slot-state', role: 'status' });
    const errEl = h('p', { class: 'msg-err', role: 'alert', hidden: true });
    const bar = h('progress', { class: 'slot-progress', max: 1, value: 0, hidden: true, 'aria-label': 'ความคืบหน้าการอัปโหลด' });
    const input = h('input', { type: 'file', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', accept: slot.accept.map((x) => `.${x}`).join(',') });
    const btn = h('button', { type: 'button', class: 'btn btn-outline', disabled: slot.deadline_passed || undefined }, '');
    btn.addEventListener('click', () => input.click());

    function paint() {
      if (slot.uploaded) {
        stateEl.className = 'slot-state ok';
        stateEl.textContent = `ส่งแล้ว: ${slot.uploaded.file_name} (${formatSize(slot.uploaded.size_bytes)}) · ${formatThaiDateTime(slot.uploaded.uploaded_at)}`;
      } else {
        stateEl.className = 'slot-state';
        stateEl.textContent = slot.deadline_passed ? 'ไม่ได้ส่งไฟล์ภายในกำหนด' : 'ยังไม่ได้ส่ง';
      }
      btn.textContent = slot.uploaded ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์';
    }
    paint();

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const fail = (text) => {
        errEl.textContent = text;
        errEl.hidden = false;
      };
      errEl.hidden = true;
      if (!slot.accept.includes(fileExt(file.name))) return fail(`ชนิดไฟล์ไม่ถูกต้อง — ช่องนี้รับเฉพาะ ${slot.accept.map((x) => x.toUpperCase()).join(', ')}`);
      if (file.size <= 0) return fail('ไฟล์ว่างเปล่า');
      if (file.size > slot.max_mb * 1024 * 1024) return fail(`ไฟล์ใหญ่เกิน ${slot.max_mb} MB (ไฟล์นี้ ${formatSize(file.size)})`);

      btn.disabled = true;
      bar.value = 0;
      bar.hidden = false;
      stateEl.className = 'slot-state';
      stateEl.textContent = 'กำลังเตรียมอัปโหลด…';
      try {
        const { upload_url } = await api('prepare_upload', {
          ...creds, slot_id: slot.id, file_name: file.name, size: file.size, mime: file.type || 'application/octet-stream', origin: location.origin,
        });
        stateEl.textContent = 'กำลังอัปโหลด…';
        let fileId;
        try {
          fileId = await putToDrive(upload_url, file, (p) => {
            bar.value = p;
          });
        } catch (e) {
          console.error(e);
          const failure = new Error('upload_failed');
          failure.reason = 'upload_failed';
          throw failure;
        }
        stateEl.textContent = 'กำลังบันทึก…';
        slot.uploaded = await api('confirm_upload', { ...creds, slot_id: slot.id, file_id: fileId, file_name: file.name });
        paint();
      } catch (e) {
        console.error(e);
        paint();
        fail(messageFor(e));
        if (e.reason === 'locked') showForm('', messageFor(e), 'banner-err');
      } finally {
        bar.hidden = true;
        btn.disabled = slot.deadline_passed;
      }
    });

    return h(
      'div',
      { class: 'slot-card' },
      h(
        'div',
        { class: 'slot-main' },
        h('div', { class: 'slot-title' }, slot.title),
        slot.description ? h('div', { class: 'slot-rule' }, slot.description) : null,
        h('div', { class: 'slot-rule' }, rule.join(' · ')),
        stateEl,
        bar,
        errEl,
      ),
      btn,
      input,
    );
  }

  // ───────────── message to the committee ─────────────
  function buildMessageBox(siteData) {
    const area = h('textarea', { class: 'inp msg-area', id: 'st-msg', rows: 4, maxlength: MAX_MESSAGE });
    const count = h('span', { class: 'slip-small' }, `0/${MAX_MESSAGE}`);
    const ok = h('p', { class: 'msg-ok', role: 'status', hidden: true }, 'ส่งข้อความแล้ว — คณะกรรมการจะตอบกลับตามช่องทางติดต่อของทีม');
    const err = h('p', { class: 'msg-err', role: 'alert', hidden: true });
    const send = h('button', { type: 'button', class: 'btn btn-primary' }, 'ส่งข้อความ');
    area.addEventListener('input', () => {
      count.textContent = `${area.value.length}/${MAX_MESSAGE}`;
      ok.hidden = true;
    });
    send.addEventListener('click', async () => {
      const body = area.value.trim();
      err.hidden = true;
      ok.hidden = true;
      if (!body) {
        err.textContent = 'พิมพ์ข้อความก่อนส่ง';
        err.hidden = false;
        return;
      }
      send.disabled = true;
      send.textContent = 'กำลังส่ง…';
      try {
        await api('send_message', { ...creds, body });
        area.value = '';
        count.textContent = `0/${MAX_MESSAGE}`;
        ok.hidden = false;
      } catch (e) {
        err.textContent = e.reason === 'rate_limited' ? 'ส่งข้อความบ่อยเกินไป โปรดรอสักครู่แล้วลองใหม่' : messageFor(e);
        err.hidden = false;
        if (e.reason === 'locked') showForm('', messageFor(e), 'banner-err');
      } finally {
        send.disabled = false;
        send.textContent = 'ส่งข้อความ';
      }
    });
    const contact = setting(siteData, 'contact_info');
    return h(
      'section',
      { class: 'panel', 'aria-labelledby': 'msg-title' },
      h('h2', { id: 'msg-title' }, 'ติดต่อคณะกรรมการ'),
      h('div', { class: 'field' }, h('label', { for: 'st-msg' }, 'ข้อความถึงคณะกรรมการ'), area, count),
      h('div', { class: 'action-row' }, send),
      ok,
      err,
      contact ? h('p', { class: 'panel-hint' }, `ช่องทางติดต่ออื่น: ${contact}`) : null,
    );
  }

  showForm();
}
